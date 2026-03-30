use std::collections::BTreeSet;

use futures_util::StreamExt;
use scraper::{ElementRef, Html, Selector};

pub(crate) const OPENAI_MODELS_INDEX_URL: &str = "https://developers.openai.com/api/docs/models";
pub(crate) const OPENAI_MODELS_ALL_URL: &str = "https://developers.openai.com/api/docs/models/all";
pub(crate) const OPENAI_MODEL_ICON_ASSET_PREFIX: &str = "/api/v1/admin/assets/openai-model-icons";
const OPENAI_DOCS_ORIGIN: &str = "https://developers.openai.com";
const OPENAI_MODEL_ICON_RUNTIME_DIR: &str = "runtime-assets/openai-model-icons";

fn strip_html_to_text(raw_html: &str) -> String {
    let mut text = raw_html.to_string();
    for (start, end) in [("<script", "</script>"), ("<style", "</style>")] {
        loop {
            let Some(start_idx) = text.find(start) else { break; };
            let Some(rel_end_idx) = text[start_idx..].find(end) else {
                text.truncate(start_idx);
                break;
            };
            let end_idx = start_idx + rel_end_idx + end.len();
            text.replace_range(start_idx..end_idx, " ");
        }
    }
    let mut stripped = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                stripped.push(' ');
            }
            _ if !in_tag => stripped.push(ch),
            _ => {}
        }
    }
    stripped
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_meta_description(raw_html: &str) -> Option<String> {
    let marker = "name=\"description\" content=\"";
    let start = raw_html.find(marker)? + marker.len();
    let rest = &raw_html[start..];
    let end = rest.find('"')?;
    let value = rest[..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn extract_title(raw_html: &str, fallback_model_id: &str) -> String {
    if let Some(start) = raw_html.find("<title>") {
        let rest = &raw_html[start + "<title>".len()..];
        if let Some(end) = rest.find("</title>") {
            let title = rest[..end]
                .trim()
                .trim_end_matches("| OpenAI API")
                .trim()
                .to_string();
            if !title.is_empty() {
                return title;
            }
        }
    }
    fallback_model_id.to_string()
}

fn parse_money_to_microcredits(raw: &str) -> Option<i64> {
    let numeric = raw.trim().trim_start_matches('$').replace(',', "");
    if numeric.is_empty() {
        return None;
    }
    let value: f64 = numeric.parse().ok()?;
    Some((value * 1_000_000.0).round() as i64)
}

fn parse_optional_i64_from_capture(raw: Option<&str>) -> Option<i64> {
    raw.map(|value| value.replace(',', "")).and_then(|value| value.parse::<i64>().ok())
}

fn parse_modalities(section: &str) -> (Vec<String>, Vec<String>) {
    let mut input = Vec::new();
    let mut output = Vec::new();
    for (label, key) in [("Text", "text"), ("Image", "image"), ("Audio", "audio"), ("Video", "video")] {
        let lower = section.to_ascii_lowercase();
        let label_pos = lower.find(&label.to_ascii_lowercase());
        let Some(label_pos) = label_pos else { continue; };
        let tail = &section[label_pos + label.len()..];
        let status = if tail.starts_with(" Input and output") {
            "input_output"
        } else if tail.starts_with(" Input only") {
            "input_only"
        } else if tail.starts_with(" Output only") {
            "output_only"
        } else {
            "unsupported"
        };
        match status {
            "input_output" => {
                input.push(key.to_string());
                output.push(key.to_string());
            }
            "input_only" => input.push(key.to_string()),
            "output_only" => output.push(key.to_string()),
            _ => {}
        }
    }
    (input, output)
}

fn parse_endpoints(text: &str) -> Vec<String> {
    let Some(start) = text.find("Endpoints ") else { return Vec::new(); };
    let tail = &text[start + "Endpoints ".len()..];
    let end = ["Pricing tier", "Snapshots", "Latest model alias", "Use cases", "Strengths", "Limitations"]
        .iter()
        .filter_map(|marker| tail.find(marker))
        .min()
        .unwrap_or(tail.len());
    let section = &tail[..end];
    let regex = regex::Regex::new(r"v1/[A-Za-z0-9_./-]+").expect("valid endpoint regex");
    let mut endpoints = regex
        .find_iter(section)
        .map(|m| m.as_str().to_string())
        .collect::<Vec<_>>();
    endpoints.sort();
    endpoints.dedup();
    endpoints
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenAiModelOverviewEntry {
    model_id: String,
    display_name: String,
    tagline: Option<String>,
    family: Option<String>,
    family_label: Option<String>,
    avatar_remote_url: Option<String>,
    deprecated: bool,
}

fn normalize_text(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn element_text(element: ElementRef<'_>) -> String {
    normalize_text(&element.text().collect::<Vec<_>>().join(" "))
}

fn class_contains(element: &ElementRef<'_>, needle: &str) -> bool {
    element
        .value()
        .attr("class")
        .map(|value| value.contains(needle))
        .unwrap_or(false)
}

fn first_descendant_with_class<'a>(
    root: ElementRef<'a>,
    needle: &str,
) -> Option<ElementRef<'a>> {
    root.descendants()
        .filter_map(ElementRef::wrap)
        .find(|element| class_contains(element, needle))
}

fn selector(selector: &str) -> Selector {
    Selector::parse(selector).expect("valid selector")
}

fn normalize_openai_docs_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    if trimmed.starts_with('/') {
        return Some(format!("{OPENAI_DOCS_ORIGIN}{trimmed}"));
    }
    Some(format!(
        "{OPENAI_DOCS_ORIGIN}/{}",
        trimmed.trim_start_matches("./")
    ))
}

fn slugify_key(raw: &str) -> String {
    let mut key = String::with_capacity(raw.len());
    let mut previous_was_separator = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            key.push(ch.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !previous_was_separator {
            key.push('_');
            previous_was_separator = true;
        }
    }
    key.trim_matches('_').to_string()
}

fn normalize_detail_status(detail: Option<&str>) -> Option<String> {
    let normalized = detail?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized == "input and output" {
        return Some("input_output".to_string());
    }
    if normalized == "input only" {
        return Some("input_only".to_string());
    }
    if normalized == "output only" {
        return Some("output_only".to_string());
    }
    if normalized == "supported" {
        return Some("supported".to_string());
    }
    if normalized == "not supported" {
        return Some("not_supported".to_string());
    }
    if normalized.starts_with("v1/") {
        return Some("supported".to_string());
    }
    None
}

fn extract_first_svg_html(root: ElementRef<'_>) -> Option<String> {
    root.select(&selector("svg")).next().map(|element| element.html())
}

fn parse_model_page_avatar_remote_url(document: &Html) -> Option<String> {
    document
        .select(&selector("img"))
        .filter_map(|image| image.value().attr("src"))
        .find(|src| src.contains("/images/api/models/icons/"))
        .and_then(normalize_openai_docs_url)
}

fn parse_model_overview_entries_from_all_models_page(
    raw_html: &str,
) -> HashMap<String, OpenAiModelOverviewEntry> {
    let document = Html::parse_document(raw_html);
    let section_selector = selector("div[id]");
    let link_selector = selector("a[href]");
    let image_selector = selector("img");
    let mut entries = HashMap::new();

    for section in document.select(&section_selector) {
        let Some(section_id) = section.value().attr("id") else {
            continue;
        };
        if !class_contains(&section, "scroll-mt-24 flex flex-col gap-8") {
            continue;
        }
        let family_label = first_descendant_with_class(section, "text-lg font-semibold")
            .map(element_text)
            .filter(|value| !value.is_empty());

        for anchor in section.select(&link_selector) {
            let Some(href) = anchor.value().attr("href") else {
                continue;
            };
            let Some(model_id) = href.strip_prefix("/api/docs/models/") else {
                continue;
            };
            if model_id.is_empty() || model_id.contains('/') {
                continue;
            }
            let display_name = first_descendant_with_class(anchor, "font-semibold")
                .map(element_text)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| model_id.to_string());
            let tagline = anchor
                .select(&selector("div"))
                .find_map(|element| {
                    if class_contains(&element, "text-sm text-secondary") {
                        let text = element_text(element);
                        (!text.is_empty()).then_some(text)
                    } else {
                        None
                    }
                });
            let avatar_remote_url = anchor
                .select(&image_selector)
                .next()
                .and_then(|image| image.value().attr("src"))
                .and_then(normalize_openai_docs_url);
            let deprecated = anchor
                .text()
                .map(str::trim)
                .any(|value| value.eq_ignore_ascii_case("deprecated"));

            entries.insert(
                model_id.to_string(),
                OpenAiModelOverviewEntry {
                    model_id: model_id.to_string(),
                    display_name,
                    tagline,
                    family: Some(section_id.to_string()),
                    family_label: family_label.clone(),
                    avatar_remote_url,
                    deprecated,
                },
            );
        }
    }

    entries
}

fn find_model_page_section<'a>(document: &'a Html, heading: &str) -> Option<ElementRef<'a>> {
    for wrapper in document.select(&selector("div")) {
        if !class_contains(&wrapper, "flex flex-col gap-4 lg:flex-row") {
            continue;
        }
        let Some(label) = wrapper
            .children()
            .filter_map(ElementRef::wrap)
            .find(|child| class_contains(child, "flex w-[200px]"))
            .map(element_text)
        else {
            continue;
        };
        if label == heading {
            return Some(wrapper);
        }
    }
    None
}

fn parse_model_page_section_items(
    document: &Html,
    heading: &str,
) -> Vec<OpenAiModelSectionItem> {
    let Some(section) = find_model_page_section(document, heading) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    let mut seen = BTreeSet::new();

    for candidate in section.select(&selector("div")) {
        if !class_contains(&candidate, "flex flex-row gap-2") {
            continue;
        }
        let Some(label) = candidate
            .select(&selector("div"))
            .find_map(|element| {
                if class_contains(&element, "text-sm font-semibold") {
                    let text = element_text(element);
                    (!text.is_empty()).then_some(text)
                } else {
                    None
                }
            })
        else {
            continue;
        };
        let detail = candidate
            .select(&selector("div"))
            .find_map(|element| {
                if class_contains(&element, "text-xs text-tertiary") {
                    let text = element_text(element);
                    (!text.is_empty()).then_some(text)
                } else {
                    None
                }
            });
        let key_source = detail
            .as_deref()
            .filter(|value| value.starts_with("v1/"))
            .unwrap_or(&label);
        let dedupe_key = format!("{label}|{}", detail.clone().unwrap_or_default());
        if !seen.insert(dedupe_key) {
            continue;
        }
        items.push(OpenAiModelSectionItem {
            key: slugify_key(key_source),
            label,
            detail: detail.clone(),
            status: normalize_detail_status(detail.as_deref()),
            icon_svg: extract_first_svg_html(candidate),
        });
    }

    items
}

fn parse_model_page_pricing_note_items(document: &Html) -> Vec<String> {
    let Some(section) = find_model_page_section(document, "Pricing") else {
        return Vec::new();
    };
    let mut notes = Vec::new();
    let mut seen = BTreeSet::new();
    for paragraph in section.select(&selector("p")) {
        let text = element_text(paragraph);
        if text.is_empty() || !seen.insert(text.clone()) {
            continue;
        }
        notes.push(text);
    }
    notes
}

fn parse_model_page_snapshot_items(document: &Html) -> Vec<OpenAiModelSnapshotItem> {
    let Some(section) = find_model_page_section(document, "Snapshots") else {
        return Vec::new();
    };
    let snapshot_regex = regex::Regex::new(r"\b[A-Za-z0-9_.-]+-\d{4}-\d{2}-\d{2}\b")
        .expect("valid snapshot regex");
    let mut items = Vec::new();
    let mut seen_aliases = BTreeSet::new();

    for candidate in section.select(&selector("div")) {
        if !class_contains(&candidate, "flex flex-col gap-4") {
            continue;
        }
        if candidate.select(&selector("img")).next().is_none() {
            continue;
        }
        let Some(alias) = candidate
            .select(&selector("div"))
            .find_map(|element| {
                if class_contains(&element, "text-sm font-semibold") {
                    let text = element_text(element);
                    (!text.is_empty()).then_some(text)
                } else {
                    None
                }
            })
        else {
            continue;
        };
        if !seen_aliases.insert(alias.clone()) {
            continue;
        }

        let mut versions = Vec::new();
        let mut seen_versions = BTreeSet::new();
        for capture in snapshot_regex.find_iter(&candidate.html()) {
            let version = capture.as_str().to_string();
            if seen_versions.insert(version.clone()) {
                versions.push(version);
            }
        }

        items.push(OpenAiModelSnapshotItem {
            alias: alias.clone(),
            label: alias,
            latest_snapshot: versions.first().cloned(),
            versions,
        });
    }

    items
}

fn summarize_modalities(
    items: &[OpenAiModelSectionItem],
) -> (Vec<String>, Vec<String>) {
    let mut input = Vec::new();
    let mut output = Vec::new();
    for item in items {
        let key = item.key.clone();
        match item.status.as_deref() {
            Some("input_output") => {
                input.push(key.clone());
                output.push(key);
            }
            Some("input_only") => input.push(key),
            Some("output_only") => output.push(key),
            _ => {}
        }
    }
    (input, output)
}

fn summarize_supported_section_items(items: &[OpenAiModelSectionItem]) -> Vec<String> {
    let mut values = Vec::new();
    let mut seen = BTreeSet::new();
    for item in items {
        let is_supported = matches!(item.status.as_deref(), Some("supported"))
            || item
                .detail
                .as_deref()
                .map(|value| value.starts_with("v1/"))
                .unwrap_or(false);
        if !is_supported {
            continue;
        }
        let value = item
            .detail
            .as_deref()
            .filter(|detail| detail.starts_with("v1/"))
            .unwrap_or(&item.key)
            .to_string();
        if seen.insert(value.clone()) {
            values.push(value);
        }
    }
    values
}

fn summarize_snapshot_versions(items: &[OpenAiModelSnapshotItem]) -> Vec<String> {
    let mut versions = Vec::new();
    let mut seen = BTreeSet::new();
    for item in items {
        for version in &item.versions {
            if seen.insert(version.clone()) {
                versions.push(version.clone());
            }
        }
    }
    versions
}

fn apply_model_overview(
    item: &mut OpenAiModelCatalogItem,
    overview: &OpenAiModelOverviewEntry,
) {
    item.display_name = Some(overview.display_name.clone());
    item.tagline = overview.tagline.clone();
    item.family = overview.family.clone();
    item.family_label = overview.family_label.clone();
    if overview.avatar_remote_url.is_some() {
        item.avatar_remote_url = overview.avatar_remote_url.clone();
    }
    item.deprecated = Some(overview.deprecated);
}

pub(crate) fn openai_model_icon_runtime_dir() -> Result<std::path::PathBuf> {
    Ok(std::env::current_dir()
        .context("failed to resolve current working directory for runtime assets")?
        .join(OPENAI_MODEL_ICON_RUNTIME_DIR))
}

fn openai_model_icon_file_name(remote_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(remote_url).ok()?;
    let file_name = url.path_segments()?.next_back()?.trim();
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
        || !file_name.to_ascii_lowercase().ends_with(".png")
    {
        return None;
    }
    Some(file_name.to_string())
}

async fn sync_openai_model_icons(
    client: &reqwest::Client,
    synced_at: DateTime<Utc>,
    items: &mut [OpenAiModelCatalogItem],
) -> Result<()> {
    let assets_dir = openai_model_icon_runtime_dir()?;
    tokio::fs::create_dir_all(&assets_dir)
        .await
        .with_context(|| format!("failed to create runtime asset dir {}", assets_dir.display()))?;

    let mut keep = BTreeSet::new();
    for item in items {
        let Some(remote_url) = item.avatar_remote_url.clone() else {
            item.avatar_local_path = None;
            item.avatar_synced_at = None;
            continue;
        };
        let Some(file_name) = openai_model_icon_file_name(&remote_url) else {
            continue;
        };
        let download_result = async {
            let response = client
                .get(&remote_url)
                .header(reqwest::header::USER_AGENT, "Mozilla/5.0 Codex-Pool/1.0")
                .send()
                .await
                .with_context(|| format!("failed to fetch {remote_url}"))?
                .error_for_status()
                .with_context(|| format!("upstream returned non-success for {remote_url}"))?;
            response
                .bytes()
                .await
                .with_context(|| format!("failed to download bytes from {remote_url}"))
        }
        .await;
        match download_result {
            Ok(bytes) => {
                tokio::fs::write(assets_dir.join(&file_name), &bytes)
                    .await
                    .with_context(|| {
                        format!(
                            "failed to write runtime asset {}",
                            assets_dir.join(&file_name).display()
                        )
                    })?;
                item.avatar_local_path = Some(file_name.clone());
                item.avatar_synced_at = Some(synced_at);
                keep.insert(file_name);
            }
            Err(error) => {
                tracing::warn!(
                    model_id = %item.model_id,
                    remote_url = %remote_url,
                    error = %error,
                    "failed to sync openai model icon"
                );
            }
        }
    }

    let mut read_dir = tokio::fs::read_dir(&assets_dir)
        .await
        .with_context(|| format!("failed to list runtime asset dir {}", assets_dir.display()))?;
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .with_context(|| format!("failed to read runtime asset dir {}", assets_dir.display()))?
    {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy().to_string();
        if keep.contains(&file_name) {
            continue;
        }
        let path = entry.path();
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("png"))
            .unwrap_or(false)
        {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    Ok(())
}

pub(crate) fn build_catalog_item_from_model_page(
    model_id: &str,
    raw_html: &str,
    synced_at: DateTime<Utc>,
) -> Result<OpenAiModelCatalogItem> {
    let text = strip_html_to_text(raw_html);
    let document = Html::parse_document(raw_html);
    let price_regex = regex::Regex::new(
        r"Input \$([0-9][0-9.,]*) Cached input \$([0-9][0-9.,]*) Output \$([0-9][0-9.,]*)"
    )
    .expect("valid price regex");
    let context_regex =
        regex::Regex::new(r"([0-9,]+) context window").expect("valid context regex");
    let max_output_regex =
        regex::Regex::new(r"([0-9,]+) max output tokens").expect("valid max output regex");
    let cutoff_regex = regex::Regex::new(r"([A-Z][a-z]{2} \d{1,2}, \d{4}) knowledge cutoff")
        .expect("valid cutoff regex");
    let price_match = price_regex.captures(&text);
    let modalities_section = text
        .split("Modalities ")
        .nth(1)
        .and_then(|tail| tail.split(" Endpoints ").next())
        .unwrap_or_default();
    let modality_items = parse_model_page_section_items(&document, "Modalities");
    let (input_modalities, output_modalities) = if modality_items.is_empty() {
        parse_modalities(modalities_section)
    } else {
        summarize_modalities(&modality_items)
    };
    let endpoint_items = parse_model_page_section_items(&document, "Endpoints");
    let feature_items = parse_model_page_section_items(&document, "Features");
    let tool_items = parse_model_page_section_items(&document, "Tools");
    let snapshot_items = parse_model_page_snapshot_items(&document);
    let pricing_note_items = parse_model_page_pricing_note_items(&document);
    let reasoning_token_support = if text.contains("Reasoning token support") {
        Some(true)
    } else {
        None
    };
    let endpoints = if endpoint_items.is_empty() {
        parse_endpoints(&text)
    } else {
        summarize_supported_section_items(&endpoint_items)
    };
    let supported_features = summarize_supported_section_items(&feature_items);
    let supported_tools = summarize_supported_section_items(&tool_items);
    let snapshots = summarize_snapshot_versions(&snapshot_items);
    let pricing_notes = if !pricing_note_items.is_empty() {
        Some(pricing_note_items.join("\n\n"))
    } else {
        text.split("Pricing ")
            .nth(1)
            .and_then(|tail| tail.split(" Text tokens ").next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    };

    Ok(OpenAiModelCatalogItem {
        model_id: model_id.to_string(),
        owned_by: "openai".to_string(),
        title: extract_title(raw_html, model_id),
        display_name: None,
        tagline: None,
        family: None,
        family_label: None,
        description: extract_meta_description(raw_html),
        avatar_remote_url: parse_model_page_avatar_remote_url(&document),
        avatar_local_path: None,
        avatar_synced_at: None,
        deprecated: None,
        context_window_tokens: parse_optional_i64_from_capture(
            context_regex.captures(&text).and_then(|caps| caps.get(1)).map(|m| m.as_str()),
        ),
        max_input_tokens: None,
        max_output_tokens: parse_optional_i64_from_capture(
            max_output_regex.captures(&text).and_then(|caps| caps.get(1)).map(|m| m.as_str()),
        ),
        knowledge_cutoff: cutoff_regex
            .captures(&text)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string()),
        reasoning_token_support,
        input_price_microcredits: price_match
            .as_ref()
            .and_then(|caps| caps.get(1))
            .and_then(|m| parse_money_to_microcredits(m.as_str())),
        cached_input_price_microcredits: price_match
            .as_ref()
            .and_then(|caps| caps.get(2))
            .and_then(|m| parse_money_to_microcredits(m.as_str())),
        output_price_microcredits: price_match
            .as_ref()
            .and_then(|caps| caps.get(3))
            .and_then(|m| parse_money_to_microcredits(m.as_str())),
        pricing_notes,
        pricing_note_items,
        input_modalities,
        output_modalities,
        endpoints,
        supported_features,
        supported_tools,
        snapshots,
        modality_items,
        endpoint_items,
        feature_items,
        tool_items,
        snapshot_items,
        source_url: format!("{OPENAI_MODELS_INDEX_URL}/{model_id}"),
        raw_text: Some(text),
        synced_at,
    })
}

pub(crate) fn parse_model_ids_from_models_index(raw_html: &str) -> Vec<String> {
    let regex = regex::Regex::new(r#"/api/docs/models/([A-Za-z0-9_.-]+)"#)
        .expect("valid model link regex");
    let mut ids = regex
        .captures_iter(raw_html)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

pub(crate) fn parse_model_overview_bundle_urls(raw_html: &str) -> Vec<String> {
    let regex = regex::Regex::new(r#"component-url="([^"]*ModelOverview[^"]+\.js)""#)
        .expect("valid model overview bundle regex");
    let mut urls = regex
        .captures_iter(raw_html)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .collect::<Vec<_>>();
    urls.sort();
    urls.dedup();
    urls
}

pub(crate) fn parse_models_page_data_bundle_urls(raw_js: &str) -> Vec<String> {
    let regex = regex::Regex::new(r#"\./models-page-data\.react\.[A-Za-z0-9_-]+\.js"#)
        .expect("valid models page data bundle regex");
    let mut urls = regex
        .find_iter(raw_js)
        .map(|m| m.as_str().to_string())
        .collect::<Vec<_>>();
    urls.sort();
    urls.dedup();
    urls
}

pub(crate) fn parse_model_ids_from_models_page_data_bundle(raw_js: &str) -> Vec<String> {
    let family_regex = regex::Regex::new(
        r#"(?s)name:"all",label:"All models".*?models:\[(.*?)\],features:"#,
    )
    .expect("valid all models family regex");
    let item_regex =
        regex::Regex::new(r#""([A-Za-z0-9_.-]+)""#).expect("valid all models item regex");
    let Some(models_section) = family_regex
        .captures(raw_js)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str())
    else {
        return Vec::new();
    };
    let mut ids = item_regex
        .captures_iter(models_section)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

async fn fetch_openai_model_ids_from_page_data_bundle(
    client: &reqwest::Client,
    index_html: &str,
) -> Result<Vec<String>> {
    let index_url =
        reqwest::Url::parse(OPENAI_MODELS_INDEX_URL).context("invalid openai models index url")?;
    let overview_bundle_urls = parse_model_overview_bundle_urls(index_html);
    if overview_bundle_urls.is_empty() {
        return Err(anyhow!("openai models page did not expose a model overview bundle"));
    }

    let mut model_ids = Vec::new();
    for overview_bundle_url in overview_bundle_urls {
        let overview_url = index_url
            .join(&overview_bundle_url)
            .with_context(|| format!("failed to resolve overview bundle url {overview_bundle_url}"))?;
        let overview_js = fetch_openai_docs_html(client, overview_url.as_str()).await?;
        let data_bundle_urls = parse_models_page_data_bundle_urls(&overview_js);
        if data_bundle_urls.is_empty() {
            continue;
        }
        for data_bundle_url in data_bundle_urls {
            let data_url = overview_url
                .join(&data_bundle_url)
                .with_context(|| format!("failed to resolve model data bundle url {data_bundle_url}"))?;
            let data_js = fetch_openai_docs_html(client, data_url.as_str()).await?;
            model_ids.extend(parse_model_ids_from_models_page_data_bundle(&data_js));
        }
    }

    model_ids.sort();
    model_ids.dedup();
    if model_ids.is_empty() {
        return Err(anyhow!(
            "openai models page data bundle did not expose any full-catalog model ids"
        ));
    }
    Ok(model_ids)
}

async fn fetch_openai_docs_html(client: &reqwest::Client, url: &str) -> Result<String> {
    client
        .get(url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 Codex-Pool/1.0")
        .send()
        .await
        .with_context(|| format!("failed to fetch {url}"))?
        .error_for_status()
        .with_context(|| format!("upstream returned non-success for {url}"))?
        .text()
        .await
        .with_context(|| format!("failed to decode html from {url}"))
}

pub(crate) async fn fetch_openai_model_catalog_items_with_client(
    client: reqwest::Client,
) -> Result<(DateTime<Utc>, Vec<OpenAiModelCatalogItem>)> {
    let synced_at = Utc::now();
    let index_html = fetch_openai_docs_html(&client, OPENAI_MODELS_INDEX_URL).await?;
    let all_models_html = match fetch_openai_docs_html(&client, OPENAI_MODELS_ALL_URL).await {
        Ok(html) => Some(html),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "failed to fetch openai all-models page; proceeding without grouped overview metadata"
            );
            None
        }
    };
    let overview_entries = all_models_html
        .as_deref()
        .map(parse_model_overview_entries_from_all_models_page)
        .unwrap_or_default();
    let mut model_ids = parse_model_ids_from_models_index(&index_html);
    match fetch_openai_model_ids_from_page_data_bundle(&client, &index_html).await {
        Ok(bundle_model_ids) => model_ids.extend(bundle_model_ids),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "failed to augment openai model catalog with page-data bundle; falling back to static index links"
            );
        }
    }
    model_ids.extend(overview_entries.keys().cloned());
    model_ids.sort();
    model_ids.dedup();
    if model_ids.is_empty() {
        return Err(anyhow!("official models index returned no model ids"));
    }

    let pages = futures_util::stream::iter(model_ids.into_iter().map(|model_id| {
        let client = client.clone();
        async move {
            let url = format!("{OPENAI_MODELS_INDEX_URL}/{model_id}");
            let html = fetch_openai_docs_html(&client, &url).await?;
            build_catalog_item_from_model_page(&model_id, &html, synced_at)
        }
    }))
    .buffer_unordered(8)
    .collect::<Vec<_>>()
    .await;

    let mut items = Vec::new();
    for page in pages {
        items.push(page?);
    }
    for item in &mut items {
        if let Some(overview) = overview_entries.get(&item.model_id) {
            apply_model_overview(item, overview);
        }
    }
    if let Err(err) = sync_openai_model_icons(&client, synced_at, &mut items).await {
        tracing::warn!(
            error = %err,
            "failed to sync local openai model icons; continuing with remote avatar urls"
        );
    }
    items.sort_by(|left, right| left.model_id.cmp(&right.model_id));
    Ok((synced_at, items))
}

pub(crate) async fn fetch_openai_model_catalog_items(
) -> Result<(DateTime<Utc>, Vec<OpenAiModelCatalogItem>)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .context("failed to build openai catalog sync client")?;
    fetch_openai_model_catalog_items_with_client(client).await
}

#[cfg(feature = "postgres-backend")]
impl TenantAuthService {
    async fn apply_openai_model_catalog_items(
        &self,
        synced_at: DateTime<Utc>,
        items: &[OpenAiModelCatalogItem],
    ) -> Result<OpenAiModelsSyncResponse> {
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start openai catalog sync transaction")?;

        for item in items {
            sqlx::query(
                r#"
                INSERT INTO openai_models_catalog (
                    model_id,
                    owned_by,
                    title,
                    display_name,
                    tagline,
                    family,
                    family_label,
                    description,
                    avatar_remote_url,
                    avatar_local_path,
                    avatar_synced_at,
                    deprecated,
                    context_window_tokens,
                    max_input_tokens,
                    max_output_tokens,
                    knowledge_cutoff,
                    reasoning_token_support,
                    input_price_microcredits,
                    cached_input_price_microcredits,
                    output_price_microcredits,
                    pricing_notes,
                    pricing_note_items_json,
                    input_modalities_json,
                    output_modalities_json,
                    endpoints_json,
                    supported_features_json,
                    supported_tools_json,
                    snapshots_json,
                    modality_items_json,
                    endpoint_items_json,
                    feature_items_json,
                    tool_items_json,
                    snapshot_items_json,
                    source_url,
                    raw_text,
                    synced_at
                )
                VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
                )
                ON CONFLICT (model_id) DO UPDATE SET
                    owned_by = EXCLUDED.owned_by,
                    title = EXCLUDED.title,
                    display_name = EXCLUDED.display_name,
                    tagline = EXCLUDED.tagline,
                    family = EXCLUDED.family,
                    family_label = EXCLUDED.family_label,
                    description = EXCLUDED.description,
                    avatar_remote_url = EXCLUDED.avatar_remote_url,
                    avatar_local_path = EXCLUDED.avatar_local_path,
                    avatar_synced_at = EXCLUDED.avatar_synced_at,
                    deprecated = EXCLUDED.deprecated,
                    context_window_tokens = EXCLUDED.context_window_tokens,
                    max_input_tokens = EXCLUDED.max_input_tokens,
                    max_output_tokens = EXCLUDED.max_output_tokens,
                    knowledge_cutoff = EXCLUDED.knowledge_cutoff,
                    reasoning_token_support = EXCLUDED.reasoning_token_support,
                    input_price_microcredits = EXCLUDED.input_price_microcredits,
                    cached_input_price_microcredits = EXCLUDED.cached_input_price_microcredits,
                    output_price_microcredits = EXCLUDED.output_price_microcredits,
                    pricing_notes = EXCLUDED.pricing_notes,
                    pricing_note_items_json = EXCLUDED.pricing_note_items_json,
                    input_modalities_json = EXCLUDED.input_modalities_json,
                    output_modalities_json = EXCLUDED.output_modalities_json,
                    endpoints_json = EXCLUDED.endpoints_json,
                    supported_features_json = EXCLUDED.supported_features_json,
                    supported_tools_json = EXCLUDED.supported_tools_json,
                    snapshots_json = EXCLUDED.snapshots_json,
                    modality_items_json = EXCLUDED.modality_items_json,
                    endpoint_items_json = EXCLUDED.endpoint_items_json,
                    feature_items_json = EXCLUDED.feature_items_json,
                    tool_items_json = EXCLUDED.tool_items_json,
                    snapshot_items_json = EXCLUDED.snapshot_items_json,
                    source_url = EXCLUDED.source_url,
                    raw_text = EXCLUDED.raw_text,
                    synced_at = EXCLUDED.synced_at
                "#,
            )
            .bind(&item.model_id)
            .bind(&item.owned_by)
            .bind(&item.title)
            .bind(&item.display_name)
            .bind(&item.tagline)
            .bind(&item.family)
            .bind(&item.family_label)
            .bind(&item.description)
            .bind(&item.avatar_remote_url)
            .bind(&item.avatar_local_path)
            .bind(item.avatar_synced_at)
            .bind(item.deprecated)
            .bind(item.context_window_tokens)
            .bind(item.max_input_tokens)
            .bind(item.max_output_tokens)
            .bind(&item.knowledge_cutoff)
            .bind(item.reasoning_token_support)
            .bind(item.input_price_microcredits)
            .bind(item.cached_input_price_microcredits)
            .bind(item.output_price_microcredits)
            .bind(&item.pricing_notes)
            .bind(sqlx_core::types::Json(&item.pricing_note_items))
            .bind(sqlx_core::types::Json(&item.input_modalities))
            .bind(sqlx_core::types::Json(&item.output_modalities))
            .bind(sqlx_core::types::Json(&item.endpoints))
            .bind(sqlx_core::types::Json(&item.supported_features))
            .bind(sqlx_core::types::Json(&item.supported_tools))
            .bind(sqlx_core::types::Json(&item.snapshots))
            .bind(sqlx_core::types::Json(&item.modality_items))
            .bind(sqlx_core::types::Json(&item.endpoint_items))
            .bind(sqlx_core::types::Json(&item.feature_items))
            .bind(sqlx_core::types::Json(&item.tool_items))
            .bind(sqlx_core::types::Json(&item.snapshot_items))
            .bind(&item.source_url)
            .bind(&item.raw_text)
            .bind(item.synced_at)
            .execute(tx.as_mut())
            .await
            .with_context(|| format!("failed to upsert official model {}", item.model_id))?;
        }

        let model_ids_array = items.iter().map(|item| item.model_id.clone()).collect::<Vec<_>>();
        let deleted_catalog_rows = sqlx::query(
            r#"DELETE FROM openai_models_catalog WHERE NOT (model_id = ANY($1))"#,
        )
        .bind(&model_ids_array)
        .execute(tx.as_mut())
        .await
        .context("failed to delete removed official catalog rows")?
        .rows_affected() as usize;

        let cleared_custom_entities = sqlx::query("DELETE FROM admin_model_entities")
            .execute(tx.as_mut())
            .await
            .context("failed to clear admin_model_entities during official sync")?
            .rows_affected();

        let cleared_billing_rules = sqlx::query("DELETE FROM billing_pricing_rules")
            .execute(tx.as_mut())
            .await
            .context("failed to clear billing_pricing_rules during official sync")?
            .rows_affected();

        let deleted_legacy_pricing_rows = sqlx::query(
            r#"
            DELETE FROM model_pricing
            WHERE model LIKE '%*'
               OR NOT (model = ANY($1))
            "#,
        )
        .bind(&model_ids_array)
        .execute(tx.as_mut())
        .await
        .context("failed to clean legacy non-official pricing rows")?
        .rows_affected();

        tx.commit()
            .await
            .context("failed to commit openai catalog sync transaction")?;

        Ok(OpenAiModelsSyncResponse {
            models_total: items.len(),
            created_or_updated: items.len(),
            deleted_catalog_rows,
            cleared_custom_entities,
            cleared_billing_rules,
            deleted_legacy_pricing_rows,
            synced_at,
        })
    }

    pub async fn admin_list_openai_model_catalog(&self) -> Result<Vec<OpenAiModelCatalogItem>> {
        let rows = sqlx::query(
            r#"
            SELECT
                model_id,
                owned_by,
                title,
                display_name,
                tagline,
                family,
                family_label,
                description,
                avatar_remote_url,
                avatar_local_path,
                avatar_synced_at,
                deprecated,
                context_window_tokens,
                max_input_tokens,
                max_output_tokens,
                knowledge_cutoff,
                reasoning_token_support,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                pricing_notes,
                pricing_note_items_json,
                input_modalities_json,
                output_modalities_json,
                endpoints_json,
                supported_features_json,
                supported_tools_json,
                snapshots_json,
                modality_items_json,
                endpoint_items_json,
                feature_items_json,
                tool_items_json,
                snapshot_items_json,
                source_url,
                raw_text,
                synced_at
            FROM openai_models_catalog
            ORDER BY model_id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list openai models catalog")?;

        rows.into_iter()
            .map(|row| -> Result<OpenAiModelCatalogItem> {
                Ok(OpenAiModelCatalogItem {
                    model_id: row.try_get("model_id")?,
                    owned_by: row.try_get("owned_by")?,
                    title: row.try_get("title")?,
                    display_name: row.try_get("display_name")?,
                    tagline: row.try_get("tagline")?,
                    family: row.try_get("family")?,
                    family_label: row.try_get("family_label")?,
                    description: row.try_get("description")?,
                    avatar_remote_url: row.try_get("avatar_remote_url")?,
                    avatar_local_path: row.try_get("avatar_local_path")?,
                    avatar_synced_at: row.try_get("avatar_synced_at")?,
                    deprecated: row.try_get("deprecated")?,
                    context_window_tokens: row.try_get("context_window_tokens")?,
                    max_input_tokens: row.try_get("max_input_tokens")?,
                    max_output_tokens: row.try_get("max_output_tokens")?,
                    knowledge_cutoff: row.try_get("knowledge_cutoff")?,
                    reasoning_token_support: row.try_get("reasoning_token_support")?,
                    input_price_microcredits: row.try_get("input_price_microcredits")?,
                    cached_input_price_microcredits: row.try_get("cached_input_price_microcredits")?,
                    output_price_microcredits: row.try_get("output_price_microcredits")?,
                    pricing_notes: row.try_get("pricing_notes")?,
                    pricing_note_items: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("pricing_note_items_json")?
                        .0,
                    input_modalities: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("input_modalities_json")?
                        .0,
                    output_modalities: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("output_modalities_json")?
                        .0,
                    endpoints: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("endpoints_json")?
                        .0,
                    supported_features: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("supported_features_json")?
                        .0,
                    supported_tools: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("supported_tools_json")?
                        .0,
                    snapshots: row
                        .try_get::<sqlx_core::types::Json<Vec<String>>, _>("snapshots_json")?
                        .0,
                    modality_items: row
                        .try_get::<sqlx_core::types::Json<Vec<crate::tenant::OpenAiModelSectionItem>>, _>("modality_items_json")?
                        .0,
                    endpoint_items: row
                        .try_get::<sqlx_core::types::Json<Vec<crate::tenant::OpenAiModelSectionItem>>, _>("endpoint_items_json")?
                        .0,
                    feature_items: row
                        .try_get::<sqlx_core::types::Json<Vec<crate::tenant::OpenAiModelSectionItem>>, _>("feature_items_json")?
                        .0,
                    tool_items: row
                        .try_get::<sqlx_core::types::Json<Vec<crate::tenant::OpenAiModelSectionItem>>, _>("tool_items_json")?
                        .0,
                    snapshot_items: row
                        .try_get::<sqlx_core::types::Json<Vec<crate::tenant::OpenAiModelSnapshotItem>>, _>("snapshot_items_json")?
                        .0,
                    source_url: row.try_get("source_url")?,
                    raw_text: row.try_get("raw_text")?,
                    synced_at: row.try_get("synced_at")?,
                })
            })
            .collect()
    }

    pub async fn admin_sync_openai_models_catalog(&self) -> Result<OpenAiModelsSyncResponse> {
        self.admin_sync_openai_models_catalog_with_client(None).await
    }

    pub async fn admin_sync_openai_models_catalog_with_client(
        &self,
        client: Option<reqwest::Client>,
    ) -> Result<OpenAiModelsSyncResponse> {
        let (synced_at, items) = match client {
            Some(client) => fetch_openai_model_catalog_items_with_client(client).await?,
            None => fetch_openai_model_catalog_items().await?,
        };
        self.apply_openai_model_catalog_items(synced_at, &items).await
    }
}

#[cfg(test)]
mod openai_catalog_sync_tests {
    use super::{
        build_catalog_item_from_model_page, parse_model_ids_from_models_index,
        parse_model_ids_from_models_page_data_bundle, parse_model_overview_bundle_urls,
        parse_model_overview_entries_from_all_models_page, parse_models_page_data_bundle_urls,
    };
    use chrono::Utc;

    #[test]
    fn parses_model_ids_from_index_html() {
        let html = r#"<a href="/api/docs/models/gpt-5.1">GPT-5.1</a><a href="/api/docs/models/gpt-4.1">GPT-4.1</a>"#;
        let ids = parse_model_ids_from_models_index(html);
        assert_eq!(ids, vec!["gpt-4.1".to_string(), "gpt-5.1".to_string()]);
    }

    #[test]
    fn parses_model_page_visible_text_fields() {
        let html = r#"
        <html>
            <head>
                <title>GPT-5.1 Model | OpenAI API</title>
                <meta name="description" content="Great for coding.">
            </head>
            <body>
                <div>400,000 context window</div>
                <div>128,000 max output tokens</div>
                <div>Sep 30, 2024 knowledge cutoff</div>
                <div>Reasoning token support</div>
                <div>Pricing Pricing is based on tokens. Text tokens Per 1M tokens Input $1.25 Cached input $0.125 Output $10.00</div>
                <div>Modalities Text Input and output Image Input only Audio Not supported Video Not supported Endpoints Chat Completions v1/chat/completions Responses v1/responses</div>
            </body>
        </html>
        "#;
        let item = build_catalog_item_from_model_page("gpt-5.1", html, Utc::now()).expect("parse model page");
        assert_eq!(item.model_id, "gpt-5.1");
        assert_eq!(item.title, "GPT-5.1 Model");
        assert_eq!(item.description.as_deref(), Some("Great for coding."));
        assert_eq!(item.context_window_tokens, Some(400_000));
        assert_eq!(item.max_output_tokens, Some(128_000));
        assert_eq!(item.knowledge_cutoff.as_deref(), Some("Sep 30, 2024"));
        assert_eq!(item.reasoning_token_support, Some(true));
        assert_eq!(item.input_price_microcredits, Some(1_250_000));
        assert_eq!(item.cached_input_price_microcredits, Some(125_000));
        assert_eq!(item.output_price_microcredits, Some(10_000_000));
        assert_eq!(item.input_modalities, vec!["text".to_string(), "image".to_string()]);
        assert_eq!(item.output_modalities, vec!["text".to_string()]);
        assert_eq!(item.endpoints, vec!["v1/chat/completions".to_string(), "v1/responses".to_string()]);
    }

    #[test]
    fn parses_model_overview_bundle_urls_from_index_html() {
        let html = r#"
        <astro-island
            component-url="/_astro/ModelOverview.C5Y0GYx7.js"
            renderer-url="/_astro/client.Btr3teR5.js"
        ></astro-island>
        "#;

        let urls = parse_model_overview_bundle_urls(html);

        assert_eq!(urls, vec!["/_astro/ModelOverview.C5Y0GYx7.js".to_string()]);
    }

    #[test]
    fn parses_models_page_data_bundle_urls_from_wrapper_js() {
        let js = r#"
        import{M as I}from"./ModelOverview.C4qDweyp.js";
        import"./models-page-data.react.DzpptwQO.js";
        export{I as ModelOverview};
        "#;

        let urls = parse_models_page_data_bundle_urls(js);

        assert_eq!(
            urls,
            vec!["./models-page-data.react.DzpptwQO.js".to_string()]
        );
    }

    #[test]
    fn parses_grouped_model_overview_entries_from_all_models_page() {
        let html = r#"
        <div id="frontier" class="scroll-mt-24 flex flex-col gap-8">
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
                <div class="text-lg font-semibold whitespace-nowrap">Frontier models</div>
            </div>
            <div class="-mx-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                <a href="/api/docs/models/gpt-5.4" class="flex h-full flex-col gap-4 text-emphasis hover:text-emphasis">
                    <div class="group flex h-full w-full cursor-pointer flex-row items-center gap-4 rounded-lg p-2 hover:bg-primary-soft">
                        <div class="flex shrink-0 overflow-hidden rounded-lg w-12 h-12">
                            <img src="/images/api/models/icons/gpt-5.4.png" alt="gpt-5.4" />
                        </div>
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <div class="font-semibold">GPT-5.4</div>
                            </div>
                            <div class="text-sm text-secondary">Best intelligence at scale</div>
                        </div>
                    </div>
                </a>
            </div>
        </div>
        <div id="image" class="scroll-mt-24 flex flex-col gap-8">
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
                <div class="text-lg font-semibold whitespace-nowrap">Image</div>
            </div>
            <div class="-mx-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                <a href="/api/docs/models/dall-e-3" class="flex h-full flex-col gap-4 text-emphasis hover:text-emphasis">
                    <div class="group flex h-full w-full cursor-pointer flex-row items-center gap-4 rounded-lg p-2 hover:bg-primary-soft">
                        <div class="flex shrink-0 overflow-hidden rounded-lg w-12 h-12">
                            <img src="/images/api/models/icons/dall-e-3.png" alt="dall-e-3" />
                        </div>
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <div class="font-semibold">DALL·E 3</div>
                                <div class="rounded-full border border-default px-1.5 py-0.5 text-xs text-tertiary">Deprecated</div>
                            </div>
                            <div class="text-sm text-secondary">Previous generation image generation model</div>
                        </div>
                    </div>
                </a>
            </div>
        </div>
        "#;

        let entries = parse_model_overview_entries_from_all_models_page(html);

        assert_eq!(entries.get("gpt-5.4").and_then(|entry| entry.family.as_deref()), Some("frontier"));
        assert_eq!(
            entries
                .get("gpt-5.4")
                .and_then(|entry| entry.family_label.as_deref()),
            Some("Frontier models")
        );
        assert_eq!(
            entries
                .get("gpt-5.4")
                .and_then(|entry| entry.avatar_remote_url.as_deref()),
            Some("https://developers.openai.com/images/api/models/icons/gpt-5.4.png")
        );
        assert_eq!(
            entries
                .get("dall-e-3")
                .map(|entry| entry.deprecated),
            Some(true)
        );
    }

    #[test]
    fn parses_model_ids_from_models_page_data_bundle_all_family() {
        let js = r#"
        var GG={
            recommended_models:["gpt-5.4","gpt-5.4-mini","gpt-5.4-nano"],
            model_families:[
                {name:"frontier",label:"Frontier models",models:["gpt-5.4"]},
                {name:"all",label:"All models",tagline:"Diverse models for a variety of tasks.",models:[
                    "gpt-5.4",
                    "gpt-5.2",
                    "gpt-4o",
                    "gpt-4o-transcribe-diarize",
                    "gpt-oss-120b",
                    "whisper-1"
                ],features:["streaming","function_calling"]}
            ]
        };
        "#;

        let ids = parse_model_ids_from_models_page_data_bundle(js);

        assert_eq!(
            ids,
            vec![
                "gpt-4o".to_string(),
                "gpt-4o-transcribe-diarize".to_string(),
                "gpt-5.2".to_string(),
                "gpt-5.4".to_string(),
                "gpt-oss-120b".to_string(),
                "whisper-1".to_string(),
            ]
        );
    }

    #[test]
    fn parses_structured_model_page_sections() {
        let html = r#"
        <html>
            <head>
                <title>GPT-5.4 Model | OpenAI API</title>
                <meta name="description" content="Best intelligence at scale.">
            </head>
            <body>
                <img src="/images/api/models/icons/gpt-5.4.png" alt="gpt-5.4" />
                <div>1,050,000 context window</div>
                <div>128,000 max output tokens</div>
                <div>Aug 31, 2025 knowledge cutoff</div>
                <div>Reasoning token support</div>
                <div>Pricing Pricing is based on tokens. Text tokens Per 1M tokens Input $2.50 Cached input $0.25 Output $15.00</div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Pricing</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <p>Regional processing endpoints are charged a 10% uplift.</p>
                    </div>
                </div>
                <div class="h-px w-full bg-primary-soft"></div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Modalities</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <div class="flex flex-row gap-2">
                            <div><svg><path d="m1 1" /></svg></div>
                            <div class="flex flex-col justify-center">
                                <div class="text-sm font-semibold">Text</div>
                                <div class="text-xs text-tertiary">Input and output</div>
                            </div>
                        </div>
                        <div class="flex flex-row gap-2">
                            <div><svg><path d="m2 2" /></svg></div>
                            <div class="flex flex-col justify-center">
                                <div class="text-sm font-semibold">Image</div>
                                <div class="text-xs text-tertiary">Input only</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="h-px w-full bg-primary-soft"></div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Endpoints</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <div class="flex flex-row gap-2">
                            <div><svg><path d="m3 3" /></svg></div>
                            <div class="flex flex-col justify-center">
                                <div class="text-sm font-semibold">Responses</div>
                                <div class="text-xs text-tertiary">v1/responses</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="h-px w-full bg-primary-soft"></div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Features</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <div class="flex flex-row gap-2">
                            <div><svg><path d="m4 4" /></svg></div>
                            <div class="flex flex-col justify-center">
                                <div class="text-sm font-semibold">Streaming</div>
                                <div class="text-xs text-tertiary">Supported</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="h-px w-full bg-primary-soft"></div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Tools</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <div class="flex flex-row gap-2">
                            <div><svg><path d="m5 5" /></svg></div>
                            <div class="flex flex-col justify-center">
                                <div class="text-sm font-semibold">Web search</div>
                                <div class="text-xs text-tertiary">Supported</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="h-px w-full bg-primary-soft"></div>

                <div class="flex flex-col gap-4 lg:flex-row">
                    <div class="flex w-[200px]">Snapshots</div>
                    <div class="flex flex-1 flex-col gap-4">
                        <div class="flex flex-col gap-4">
                            <div class="flex flex-row gap-2">
                                <div class="h-10 w-10"><img src="/images/api/models/icons/gpt-5.4.png" alt="gpt-5.4"/></div>
                                <div class="flex items-start gap-3">
                                    <div class="flex flex-col font-mono">
                                        <div class="text-sm font-semibold">gpt-5.4</div>
                                        <div class="flex flex-row items-center gap-2 text-xs text-tertiary">
                                            <div>gpt-5.4-2026-03-05</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex flex-1 flex-col gap-2">
                                <div class="flex flex-row items-center gap-2 text-sm">gpt-5.4-2026-03-05</div>
                                <div class="flex flex-row items-center gap-2 text-sm">gpt-5.4-2026-01-15</div>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
        </html>
        "#;

        let item = build_catalog_item_from_model_page("gpt-5.4", html, Utc::now())
            .expect("parse structured model page");

        assert_eq!(
            item.avatar_remote_url.as_deref(),
            Some("https://developers.openai.com/images/api/models/icons/gpt-5.4.png")
        );
        assert_eq!(item.context_window_tokens, Some(1_050_000));
        assert_eq!(item.max_output_tokens, Some(128_000));
        assert_eq!(item.knowledge_cutoff.as_deref(), Some("Aug 31, 2025"));
        assert_eq!(item.pricing_note_items, vec!["Regional processing endpoints are charged a 10% uplift.".to_string()]);
        assert_eq!(item.input_modalities, vec!["text".to_string(), "image".to_string()]);
        assert_eq!(item.output_modalities, vec!["text".to_string()]);
        assert_eq!(item.endpoints, vec!["v1/responses".to_string()]);
        assert_eq!(item.supported_features, vec!["streaming".to_string()]);
        assert_eq!(item.supported_tools, vec!["web_search".to_string()]);
        assert_eq!(
            item.snapshots,
            vec![
                "gpt-5.4-2026-03-05".to_string(),
                "gpt-5.4-2026-01-15".to_string()
            ]
        );
        assert_eq!(item.modality_items.len(), 2);
        assert_eq!(item.endpoint_items.len(), 1);
        assert_eq!(item.feature_items.len(), 1);
        assert_eq!(item.tool_items.len(), 1);
        assert_eq!(item.snapshot_items.len(), 1);
        assert!(item
            .modality_items
            .first()
            .and_then(|entry| entry.icon_svg.as_deref())
            .map(|svg| svg.starts_with("<svg"))
            .unwrap_or(false));
    }
}
