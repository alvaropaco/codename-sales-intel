"""Base abstractions for external providers with metrics/circuit-breaker wiring."""
from __future__ import annotations

import time
from abc import ABC, abstractmethod

from company_enrichment.metrics.metrics import (
    ENRICHMENT_PROVIDER_FAILURES,
    ENRICHMENT_PROVIDER_LATENCY,
    ENRICHMENT_PROVIDER_REQUESTS,
)
from company_enrichment.providers.circuit_breaker import CircuitBreaker, CircuitOpenError
from company_enrichment.providers.ssrf import SSRFBlockedError


class ProviderError(Exception):
    """Generic provider failure."""

    def __init__(self, code: str, message: str, transient: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.transient = transient
        self.message = message


class Provider(ABC):
    name: str = "provider"

    def __init__(self, circuit: CircuitBreaker | None = None) -> None:
        self.circuit = circuit

    @abstractmethod
    async def close(self) -> None:
        ...

    async def _execute(self, fn, *args, **kwargs):
        """Wrap a provider call with metrics + circuit breaker."""
        if self.circuit is not None and not self.circuit.can_proceed():
            raise CircuitOpenError(f"circuit open for {self.name}")
        ENRICHMENT_PROVIDER_REQUESTS.labels(provider=self.name).inc()
        start = time.monotonic()
        try:
            result = await fn(*args, **kwargs)
        except SSRFBlockedError:
            # Security failure; never wrap or retry. Propagate as-is.
            raise
        except ProviderError as exc:
            ENRICHMENT_PROVIDER_LATENCY.labels(provider=self.name).observe(time.monotonic() - start)
            ENRICHMENT_PROVIDER_FAILURES.labels(provider=self.name, error_code=exc.code).inc()
            if self.circuit is not None and not exc.transient:
                self.circuit.record_failure()
            raise
        except Exception as exc:  # noqa: BLE001 - treat unknown as transient failure
            ENRICHMENT_PROVIDER_LATENCY.labels(provider=self.name).observe(time.monotonic() - start)
            ENRICHMENT_PROVIDER_FAILURES.labels(provider=self.name, error_code="UNKNOWN").inc()
            if self.circuit is not None:
                self.circuit.record_failure()
            raise ProviderError("UNKNOWN", f"{self.name}: {exc}") from exc
        else:
            ENRICHMENT_PROVIDER_LATENCY.labels(provider=self.name).observe(time.monotonic() - start)
            if self.circuit is not None:
                self.circuit.record_success()
            return result
