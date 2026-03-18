use std::fmt;

use chrono::Local;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone, Copy, Default)]
struct LocalChronoTimer;

impl FormatTime for LocalChronoTimer {
    fn format_time(&self, writer: &mut Writer<'_>) -> fmt::Result {
        write!(
            writer,
            "{}",
            Local::now().format("%Y-%m-%d %H:%M:%S%.3f %:z")
        )
    }
}

pub fn init_local_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_timer(LocalChronoTimer)
        .init();
}
