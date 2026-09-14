# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------
# Builder: compile dependencies into an isolated prefix.
# ---------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY pyproject.toml README.md ./
COPY src/ src/

RUN python -m pip install --upgrade pip \
    && pip install --prefix=/install .

# ---------------------------------------------------------------------
# Runtime: minimal image, no compilers, no secrets, non-root.
# ---------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="cnpj-data-publisher" \
      org.opencontainers.image.description="Publishes Brazilian CNPJ open-data company events to NATS JetStream" \
      org.opencontainers.image.source="https://github.com/alvaropaco/codename-sales-intel/tree/main/services/cnpj-data-publisher" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="cnpj-data-publisher"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/usr/local/bin:${PATH}" \
    STORAGE_LOCAL_PATH=/data

# Upgrade OS packages to current security patches: o scan de CVEs do CI
# falha em CVE HIGH/CRITICAL de pacotes do base image sem isso.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends tini libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home /app --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app migrations/ migrations/
COPY --chown=app:app contracts/ contracts/

RUN mkdir -p /data && chown -R app:app /data /app

# Pre-install the DuckDB postgres extension into a shared, world-readable dir so
# the sink never needs network access or a writable $HOME at runtime (the pod
# runs with readOnlyRootFilesystem). DUCKDB_EXTENSION_DIRECTORY points the sink
# here; loading a pre-installed extension does not require write access.
ENV DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions
RUN mkdir -p /opt/duckdb/extensions \
    && python -c "import duckdb; c=duckdb.connect(); c.execute(\"SET extension_directory='/opt/duckdb/extensions'\"); c.execute('INSTALL postgres')" \
    && chmod -R a+rX /opt/duckdb

USER app:app

VOLUME ["/data"]
EXPOSE 8080 9090

# The publisher exposes /healthz; other commands are short-lived jobs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz', timeout=3).status == 200 else 1)" || exit 0

# tini reaps zombies and forwards signals for clean shutdowns.
ENTRYPOINT ["/usr/bin/tini", "--", "cnpj-data-publisher"]
CMD ["--help"]
