"""AI Gateway (LiteLLM) client with model fallback and structured output.

Calls the existing `litellm-gateway` OpenAI-compatible endpoint. Never calls an
upstream provider directly.
"""
from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel

from company_enrichment.metrics.metrics import (
    ENRICHMENT_AI_FAILURES,
    ENRICHMENT_AI_REQUESTS,
    ENRICHMENT_AI_TOKENS,
)
from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.circuit_breaker import CircuitBreaker
from company_enrichment.providers.rate_limit import TokenBucket


class LLMError(ProviderError):
    pass


class LLMResponse(BaseModel):
    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


class AIGatewayClient(Provider):
    name = "ai_gateway"

    def __init__(
        self,
        url: str,
        api_key: str | None,
        models: list[str],
        circuit: CircuitBreaker | None = None,
        timeout: float = 60.0,
        rate_per_sec: float = 4.0,
    ) -> None:
        super().__init__(circuit)
        self._url = url.rstrip("/")
        self._api_key = api_key
        self._models = models or ["gpt-4.1-mini"]
        self._client = httpx.AsyncClient(timeout=timeout)
        self._bucket = TokenBucket(rate_per_sec, int(max(1, rate_per_sec * 2)))

    async def complete(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 1024,
        temperature: float = 0.2,
    ) -> LLMResponse:
        await self._bucket.acquire()
        last_error: Exception | None = None
        for model in self._models:
            try:
                resp = await self._execute(
                    self._call, model, system, user, max_tokens, temperature
                )
                return resp
            except (LLMError, ProviderError) as exc:
                last_error = exc
                ENRICHMENT_AI_FAILURES.labels(model=model, error_code=exc.code).inc()
        raise LLMError("ALL_MODELS_FAILED", f"all models failed: {last_error}", transient=True)

    async def _call(
        self, model: str, system: str, user: str, max_tokens: int, temperature: float
    ) -> LLMResponse:
        ENRICHMENT_AI_REQUESTS.labels(model=model).inc()
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = await self._client.post(f"{self._url}/v1/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            raise LLMError("HTTP_ERROR", f"AI gateway {exc.response.status_code}", transient=True) from exc
        except httpx.HTTPError as exc:
            raise LLMError("NETWORK", f"AI gateway error: {exc}", transient=True) from exc
        choices = data.get("choices", [])
        if not choices:
            raise LLMError("EMPTY", "no choices returned", transient=True)
        content = choices[0].get("message", {}).get("content", "")
        usage = data.get("usage", {})
        in_tok = int(usage.get("prompt_tokens", 0))
        out_tok = int(usage.get("completion_tokens", 0))
        ENRICHMENT_AI_TOKENS.labels(model=model).inc(in_tok + out_tok)
        return LLMResponse(
            content=content,
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
        )

    async def close(self) -> None:
        await self._client.aclose()
