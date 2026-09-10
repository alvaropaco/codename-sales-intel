# AI Policy

## Gateway only

All LLM calls go through the existing LiteLLM gateway
(`litellm-gateway.ai-gateway.svc.cluster.local:4000`). Never call an upstream
provider directly when the gateway exists.

## Model preference (configurable, not hardcoded)

1. `gpt-4.1-mini`
2. `deepseek-v4-flash-0731`
3. `kimi-k2.6`

Routed by the gateway for cost/latency/availability; the worker retries across
the model chain on failure.

## When to use an LLM

Only for:

- business classification
- website understanding
- product/service extraction
- B2B/B2C classification
- company summary
- intent reasoning
- ambiguous evidence reconciliation

## When NOT to use an LLM

DNS, HTTP status, regex, email parsing, MX, dates, hashing, deterministic
scoring, technology fingerprints.

## Input discipline

- Never send full HTML. Extract, dedupe, remove nav/boilerplate, truncate
  (`LLM_MAX_INPUT_CHARS`).
- Prefer homepage, about, services/products, contact.

## Output discipline

- JSON structured output, validated with Pydantic.
- On invalid output: structured retry, then partial result. Free text never
  breaks the pipeline.
