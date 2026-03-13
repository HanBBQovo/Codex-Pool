use std::collections::VecDeque;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use codex_pool_core::api::ProductEdition;
use control_plane::edition_migration::{
    build_postgres_package, build_sqlite_package, import_package_into_postgres,
    import_package_into_sqlite, inspect_archive_manifest, preflight_package,
    read_archive_manifest_from_file, read_package_from_file, write_package_to_file,
};
use control_plane::store::postgres::PostgresStore;
use control_plane::store::SqliteBackedStore;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Command {
    Export {
        source_edition: ProductEdition,
        source_database_url: String,
        output: PathBuf,
    },
    Preflight {
        input: PathBuf,
        target_edition: ProductEdition,
    },
    Import {
        input: PathBuf,
        target_edition: ProductEdition,
        target_database_url: String,
    },
    ArchiveInspect {
        input: PathBuf,
    },
    Help,
}

fn parse_product_edition(raw: &str, flag: &str) -> Result<ProductEdition> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "personal" => Ok(ProductEdition::Personal),
        "team" => Ok(ProductEdition::Team),
        "business" => Ok(ProductEdition::Business),
        _ => bail!("invalid {flag} value: {raw}"),
    }
}

fn pop_flag(args: &mut VecDeque<String>, flag: &str) -> Result<String> {
    match (args.pop_front().as_deref(), args.pop_front()) {
        (Some(found), Some(value)) if found == flag => Ok(value),
        (Some(found), _) => bail!("expected {flag}, got {found}"),
        _ => bail!("missing required flag {flag}"),
    }
}

fn parse_command(mut args: VecDeque<String>) -> Result<Command> {
    let Some(command) = args.pop_front() else {
        return Ok(Command::Help);
    };

    if command == "-h" || command == "--help" {
        return Ok(Command::Help);
    }

    match command.as_str() {
        "export" => {
            let source_edition =
                parse_product_edition(&pop_flag(&mut args, "--source-edition")?, "--source-edition")?;
            let source_database_url = pop_flag(&mut args, "--source-database-url")?;
            let output = PathBuf::from(pop_flag(&mut args, "--output")?);
            Ok(Command::Export {
                source_edition,
                source_database_url,
                output,
            })
        }
        "preflight" => {
            let input = PathBuf::from(pop_flag(&mut args, "--input")?);
            let target_edition =
                parse_product_edition(&pop_flag(&mut args, "--target-edition")?, "--target-edition")?;
            Ok(Command::Preflight {
                input,
                target_edition,
            })
        }
        "import" => {
            let input = PathBuf::from(pop_flag(&mut args, "--input")?);
            let target_edition =
                parse_product_edition(&pop_flag(&mut args, "--target-edition")?, "--target-edition")?;
            let target_database_url = pop_flag(&mut args, "--target-database-url")?;
            Ok(Command::Import {
                input,
                target_edition,
                target_database_url,
            })
        }
        "archive" => {
            let Some(subcommand) = args.pop_front() else {
                bail!("archive requires a subcommand");
            };
            if subcommand != "inspect" {
                bail!("unsupported archive subcommand: {subcommand}");
            }
            let input = PathBuf::from(pop_flag(&mut args, "--input")?);
            Ok(Command::ArchiveInspect { input })
        }
        _ => bail!("unsupported command: {command}"),
    }
}

fn help_text() -> &'static str {
    r#"edition-migrate commands:
  export --source-edition <personal|team|business> --source-database-url <url> --output <path>
  preflight --input <package.json> --target-edition <personal|team|business>
  import --input <package.json> --target-edition <personal|team|business> --target-database-url <url>
  archive inspect --input <package.json|archive.json>
"#
}

#[tokio::main]
async fn main() -> Result<()> {
    codex_pool_core::logging::init_local_tracing();

    match parse_command(std::env::args().skip(1).collect())? {
        Command::Help => {
            println!("{}", help_text());
            Ok(())
        }
        Command::Export {
            source_edition,
            source_database_url,
            output,
        } => {
            let package = match source_edition {
                ProductEdition::Personal => {
                    let store = SqliteBackedStore::connect(&source_database_url).await?;
                    build_sqlite_package(source_edition, &store).await?
                }
                ProductEdition::Team | ProductEdition::Business => {
                    let _store = PostgresStore::connect(&source_database_url).await?;
                    build_postgres_package(source_edition, &source_database_url).await?
                }
            };
            write_package_to_file(&output, &package)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "output": output,
                    "source_edition": source_edition,
                    "tenant_count": package.control_plane.tenants.len(),
                    "api_key_count": package.control_plane.api_keys.len(),
                    "account_count": package.control_plane.accounts.len(),
                    "request_log_count": package.usage.request_logs.len(),
                    "archive_item_count": package.archive.non_empty_items().len()
                }))
                .context("failed to encode export summary")?
            );
            Ok(())
        }
        Command::Preflight {
            input,
            target_edition,
        } => {
            let package = read_package_from_file(&input)?;
            let report = preflight_package(&package, target_edition);
            println!(
                "{}",
                serde_json::to_string_pretty(&report)
                    .context("failed to encode preflight report")?
            );
            Ok(())
        }
        Command::Import {
            input,
            target_edition,
            target_database_url,
        } => {
            let package = read_package_from_file(&input)?;
            match target_edition {
                ProductEdition::Personal => {
                    import_package_into_sqlite(&target_database_url, &package).await?
                }
                ProductEdition::Team | ProductEdition::Business => {
                    import_package_into_postgres(target_edition, &target_database_url, &package)
                        .await?
                }
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "input": input,
                    "target_edition": target_edition,
                    "target_database_url": target_database_url
                }))
                .context("failed to encode import summary")?
            );
            Ok(())
        }
        Command::ArchiveInspect { input } => {
            let archive = match read_package_from_file(&input) {
                Ok(package) => package.archive,
                Err(_) => read_archive_manifest_from_file(&input)?,
            };
            let items = inspect_archive_manifest(&archive);
            println!(
                "{}",
                serde_json::to_string_pretty(&items)
                    .context("failed to encode archive inspection result")?
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_command, Command};
    use std::collections::VecDeque;

    #[test]
    fn parse_export_command() {
        let command = parse_command(
            vec![
                "export".to_string(),
                "--source-edition".to_string(),
                "personal".to_string(),
                "--source-database-url".to_string(),
                "sqlite://./personal.sqlite".to_string(),
                "--output".to_string(),
                "/tmp/personal.json".to_string(),
            ]
            .into(),
        )
        .expect("parse export command");

        assert!(matches!(command, Command::Export { .. }));
    }

    #[test]
    fn parse_archive_inspect_command() {
        let command = parse_command(
            VecDeque::from(vec![
                "archive".to_string(),
                "inspect".to_string(),
                "--input".to_string(),
                "/tmp/archive.json".to_string(),
            ]),
        )
        .expect("parse archive inspect command");

        assert!(matches!(command, Command::ArchiveInspect { .. }));
    }
}
