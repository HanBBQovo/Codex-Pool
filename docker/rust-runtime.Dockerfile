FROM rust:1.93.1-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY frontend ./frontend
COPY services ./services

RUN cargo build --release -p control-plane --bin control-plane --bin usage-worker \
    && cargo build --release -p data-plane --bin data-plane

FROM debian:12.13-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/control-plane /usr/local/bin/control-plane
COPY --from=builder /app/target/release/data-plane /usr/local/bin/data-plane
COPY --from=builder /app/target/release/usage-worker /usr/local/bin/usage-worker

ENV RUST_LOG=info

CMD ["control-plane"]
