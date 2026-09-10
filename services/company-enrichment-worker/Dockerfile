# syntax=docker/dockerfile:1
# Multi-stage build: builder (pip install) -> runtime (slim)
#
# Optional OSINT recon engines (BBOT + SpiderFoot) are installed only when
# `--build-arg BUILD_WITH_OSINT=true`. The legacy `core` worker does not need
# them; the `bbot` and `spiderfoot` worker types do.
FROM python:3.12-slim AS builder

ARG BUILD_WITH_OSINT=false

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml ./
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./

RUN pip install --upgrade pip && \
    if [ "$BUILD_WITH_OSINT" = "true" ]; then \
      pip install --no-cache-dir --prefix=/install ".[osint]"; \
    else \
      pip install --no-cache-dir --prefix=/install .; \
    fi

# SpiderFoot is not published on PyPI under a usable name; clone its source and
# install its pinned requirements into the same /install prefix. `git` is only
# needed here (removed implicitly by the multi-stage boundary).
RUN mkdir -p /opt/spiderfoot && \
    if [ "$BUILD_WITH_OSINT" = "true" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends git ca-certificates && \
      rm -rf /var/lib/apt/lists/* && \
      git clone --depth 1 https://github.com/smicallef/spiderfoot.git /opt/spiderfoot && \
      pip install --no-cache-dir --prefix=/install -r /opt/spiderfoot/requirements.txt; \
    fi

# Obscura headless JS renderer (fallback for blocked/JS-heavy public pages).
# Installed in every image: the graph worker (the primary consumer of the
# web-fetch/crawler fallback) runs on the default image, not the OSINT one.
RUN mkdir -p /opt/obscura && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL -o /opt/obscura/obscura.tar.gz \
      https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux.tar.gz && \
    tar -xzf /opt/obscura/obscura.tar.gz -C /opt/obscura && \
    ls -la /opt/obscura

FROM python:3.12-slim AS runtime

ARG BUILD_WITH_OSINT=false
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PORT=8080 \
    BBOT_BIN=bbot \
    SPIDERFOOT_BIN=/opt/spiderfoot/sf.py \
    OBSCURA_BIN=/opt/obscura/obscura \
    OBSCURA_ENABLED=true

WORKDIR /app
COPY --from=builder /install /usr/local
COPY --from=builder /build/src /app/src
COPY --from=builder /build/migrations /app/migrations
COPY --from=builder /build/alembic.ini /app/alembic.ini
COPY --from=builder /opt/spiderfoot /opt/spiderfoot
COPY --from=builder /opt/obscura /opt/obscura

# BBOT's module dependency installer needs root/sudo. Pre-install its deps as
# root during the OSINT build so the runtime non-root user never hits the
# `ensure_root` failure. Only runs when BBOT is actually present.
RUN if [ "$BUILD_WITH_OSINT" = "true" ]; then \
      bbot --install-all-deps --force --ignore-failed-deps || true; \
    fi

# Non-root user for container security.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8080

# /tmp is writable; the Helm chart mounts an emptyDir for mutable temp state.
ENTRYPOINT ["python", "-m", "company_enrichment"]
