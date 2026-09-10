"""Bounded concurrency and token-bucket rate limiting for providers."""
from __future__ import annotations

import asyncio
import time


class TokenBucket:
    """Simple in-process token bucket rate limiter."""

    def __init__(self, rate_per_sec: float, capacity: int) -> None:
        self.rate = rate_per_sec
        self.capacity = capacity
        self._tokens = float(capacity)
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
                self._updated = now
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                wait = (1.0 - self._tokens) / self.rate
                await asyncio.sleep(max(wait, 0.01))


class ConcurrencyLimiter:
    """Limits how many concurrent calls can be in flight (e.g. FlareSolverr)."""

    def __init__(self, max_concurrency: int) -> None:
        self._sem = asyncio.Semaphore(max_concurrency)

    async def __aenter__(self) -> ConcurrencyLimiter:
        await self._sem.acquire()
        return self

    async def __aexit__(self, *exc) -> None:
        self._sem.release()
