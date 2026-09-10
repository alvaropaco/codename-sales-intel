.DEFAULT_GOAL := help
SHELL := /bin/bash

VENV        ?= .venv
PYTHON      ?= $(VENV)/bin/python
PIP         ?= $(VENV)/bin/pip
PYTEST      ?= $(VENV)/bin/pytest
RUFF        ?= $(VENV)/bin/ruff
MYPY        ?= $(VENV)/bin/mypy
BASE_PYTHON ?= python3.12

IMAGE     ?= cnpj-data-publisher
TAG       ?= latest
NAMESPACE ?= cnpj-data
RELEASE   ?= cnpj-data-publisher
CHART     := helm/cnpj-data-publisher

SNAPSHOT   ?= latest
YEAR       ?= 2025
RATE       ?= 0
BATCH_SIZE ?= 1000

# Ports published by docker-compose.yml.
TEST_DATABASE_URL ?= postgresql+psycopg://cnpj:cnpj@localhost:55432/cnpj
TEST_NATS_URL     ?= nats://localhost:54222

export TEST_DATABASE_URL
export TEST_NATS_URL

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- setup -----------------------------------------------------------
.PHONY: setup
setup: ## Create the virtualenv and install dev dependencies
	$(BASE_PYTHON) -m venv $(VENV)
	$(PIP) install --quiet --upgrade pip
	$(PIP) install --quiet -e ".[dev]"
	@echo "environment ready: $(VENV)"

# --- quality ---------------------------------------------------------
.PHONY: lint
lint: ## Run ruff
	$(RUFF) check src tests

.PHONY: format
format: ## Format with ruff
	$(RUFF) format src tests
	$(RUFF) check --fix src tests

.PHONY: format-check
format-check: ## Verify formatting without writing
	$(RUFF) format --check src tests

.PHONY: typecheck
typecheck: ## Run mypy
	$(MYPY) src

# --- tests -----------------------------------------------------------
.PHONY: test
test: test-unit ## Alias for test-unit

.PHONY: test-unit
test-unit: ## Fast isolated tests
	$(PYTEST) tests/unit -q

.PHONY: test-integration
test-integration: ## Tests requiring PostgreSQL and NATS
	$(PYTEST) tests/integration -q

.PHONY: test-e2e
test-e2e: ## Full pipeline test
	$(PYTEST) tests/e2e -q

.PHONY: test-performance
test-performance: ## Synthetic dataset benchmarks
	$(PYTEST) tests/performance -q -m performance

.PHONY: test-all
test-all: ## Every test suite
	$(PYTEST) tests -q

.PHONY: coverage
coverage: ## Unit tests with coverage report
	$(PYTEST) tests/unit --cov --cov-report=term-missing --cov-report=html

# --- application ------------------------------------------------------
.PHONY: migrate
migrate: ## Apply database migrations
	$(VENV)/bin/cnpj-data-publisher migrate

.PHONY: ingest
ingest: ## Run ingestion (SNAPSHOT=2026-07)
	$(VENV)/bin/cnpj-data-publisher ingest --snapshot $(SNAPSHOT)

.PHONY: ingest-year
ingest-year: ## Ingest every monthly snapshot of a year (YEAR=2025)
	$(VENV)/bin/cnpj-data-publisher ingest-year $(YEAR)

.PHONY: publish-outbox
publish-outbox: ## Run the outbox publisher
	$(VENV)/bin/cnpj-data-publisher publish-outbox

.PHONY: backfill
backfill: ## Run a backfill (SNAPSHOT=2026-07 RATE=100)
	$(VENV)/bin/cnpj-data-publisher backfill --snapshot $(SNAPSHOT) --rate $(RATE) --batch-size $(BATCH_SIZE)

.PHONY: cleanup
cleanup: ## Apply retention policies
	$(VENV)/bin/cnpj-data-publisher cleanup

.PHONY: status
status: ## Show snapshots and outbox backlog
	$(VENV)/bin/cnpj-data-publisher status

# --- docker -----------------------------------------------------------
.PHONY: build
build: ## Build the container image
	docker build -t $(IMAGE):$(TAG) .

.PHONY: up
up: ## Start PostgreSQL and NATS
	docker compose up -d postgres nats

.PHONY: up-all
up-all: ## Start the full stack including the publisher
	docker compose up -d

.PHONY: down
down: ## Stop the stack and remove volumes
	docker compose down -v

.PHONY: logs
logs: ## Follow the publisher logs
	docker compose logs -f outbox-publisher

# --- helm --------------------------------------------------------------
.PHONY: helm-deps
helm-deps: ## Fetch chart dependencies
	helm dependency update $(CHART)

.PHONY: helm-lint
helm-lint: ## Lint the chart with both value files
	helm lint $(CHART)
	helm lint $(CHART) -f $(CHART)/values-k3s.yaml

.PHONY: helm-template
helm-template: ## Render the chart for K3s
	helm template $(RELEASE) $(CHART) -f $(CHART)/values-k3s.yaml

.PHONY: k3s-install
k3s-install: ## Install into K3s (NAMESPACE=cnpj-data)
	helm upgrade --install $(RELEASE) $(CHART) \
		-f $(CHART)/values-k3s.yaml \
		--namespace $(NAMESPACE) --create-namespace --wait

.PHONY: k3s-upgrade
k3s-upgrade: ## Upgrade the K3s release
	helm upgrade $(RELEASE) $(CHART) \
		-f $(CHART)/values-k3s.yaml \
		--namespace $(NAMESPACE) --wait

.PHONY: k3s-uninstall
k3s-uninstall: ## Uninstall the K3s release
	helm uninstall $(RELEASE) --namespace $(NAMESPACE)

# --- contracts ---------------------------------------------------------
.PHONY: validate-contracts
validate-contracts: ## Validate every JSON Schema compiles
	$(PYTHON) -c "import json,pathlib;from jsonschema import Draft202012Validator as V;\
[V.check_schema(json.loads(p.read_text())) or print('ok', p.name) for p in sorted(pathlib.Path('contracts').glob('*.schema.json'))]"

# --- housekeeping --------------------------------------------------------
.PHONY: clean
clean: ## Remove caches and build artifacts
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage dist build
