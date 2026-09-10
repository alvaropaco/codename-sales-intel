"""Circuit breaker unit tests."""
import time

from company_enrichment.providers.circuit_breaker import (
    CircuitBreaker,
    CircuitState,
)


def test_closed_by_default():
    cb = CircuitBreaker("test")
    assert cb.state == CircuitState.CLOSED
    assert cb.can_proceed()


def test_opens_after_threshold():
    cb = CircuitBreaker("test", failure_threshold=3, reset_timeout_seconds=60)
    assert cb.can_proceed()
    cb.record_failure()
    cb.record_failure()
    assert cb.can_proceed()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    assert not cb.can_proceed()


def test_half_open_after_reset_timeout():
    cb = CircuitBreaker("test", failure_threshold=2, reset_timeout_seconds=0.05)
    cb.record_failure()
    cb.record_failure()
    assert not cb.can_proceed()
    time.sleep(0.1)
    assert cb.state == CircuitState.HALF_OPEN
    assert cb.can_proceed()
    # Half-open only allows limited calls.
    assert not cb.can_proceed()  # half_open_max_calls = 1 default


def test_success_recloses():
    cb = CircuitBreaker("test", failure_threshold=1, reset_timeout_seconds=0.05)
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    time.sleep(0.1)
    assert cb.can_proceed()  # half open
    cb.record_success()
    assert cb.state == CircuitState.CLOSED


def test_failure_in_half_open_reopens():
    cb = CircuitBreaker("test", failure_threshold=1, reset_timeout_seconds=0.05)
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    time.sleep(0.1)
    assert cb.state == CircuitState.HALF_OPEN
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
