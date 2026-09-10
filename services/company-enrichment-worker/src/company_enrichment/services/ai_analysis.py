"""AI business analysis: business classification, product/service extraction, B2B/B2C, summary.

LLM is used only where it adds value (per plan §30). Input is truncated/cleaned
relevant text, never full HTML. Output is JSON validated by Pydantic.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, Field, ValidationError

from company_enrichment.ai.llm import AIGatewayClient, LLMError
from company_enrichment.models.outputs.results import AIBusinessAnalysis
from company_enrichment.providers.base import ProviderError

_SYSTEM_PROMPT = (
    'You are a business-intelligence analyst. Given public web content about a company, '
    'return a JSON object with exactly these keys: '
    '"classification" (string), "products_services" (array of strings), '
    '"b2b_b2c" (one of "B2B","B2C","BOTH","UNKNOWN"), "summary" (string, <=200 words), '
    '"intent_reasoning" (string, <=150 words). Only use evidence present in the text. '
    'If information is missing, omit it or use empty defaults. Do not invent revenue or facts.'
)


class _LLMOutput(BaseModel):
    classification: str | None = None
    products_services: list[str] = Field(default_factory=list)
    b2b_b2c: str | None = None
    summary: str | None = None
    intent_reasoning: str | None = None


class AIAnalysisService:
    def __init__(self, llm: AIGatewayClient, max_input_chars: int = 30_000) -> None:
        self._llm = llm
        self._max_input_chars = max_input_chars

    async def analyze(self, *, company_name: str, text: str) -> AIBusinessAnalysis:
        truncated = self._truncate(text)
        user_prompt = (
            f"Company name: {company_name}\n\n"
            f"Public web content:\n{truncated}\n\n"
            "Return the JSON object as specified."
        )
        try:
            llm_resp = await self._llm.complete(system=_SYSTEM_PROMPT, user=user_prompt)
            parsed = self._parse_json(llm_resp.content)
            out = _LLMOutput.model_validate(parsed)
            return AIBusinessAnalysis(
                classification=out.classification,
                products_services=out.products_services,
                b2b_b2c=out.b2b_b2c,
                summary=out.summary,
                intent_reasoning=out.intent_reasoning,
                model=llm_resp.model,
                confidence=0.8,
            )
        except (LLMError, ProviderError):
            # Fall back to a partial result; never let free text break the pipeline.
            return AIBusinessAnalysis(
                classification=None,
                products_services=[],
                b2b_b2c=None,
                summary=None,
                intent_reasoning=None,
                confidence=0.0,
            )
        except (ValidationError, json.JSONDecodeError, TypeError):
            return AIBusinessAnalysis(confidence=0.0)

    def _truncate(self, text: str) -> str:
        if len(text) <= self._max_input_chars:
            return text
        return text[: self._max_input_chars]

    @staticmethod
    def _parse_json(content: str) -> dict:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(content[start : end + 1])
            raise
