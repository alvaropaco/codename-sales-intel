#!/usr/bin/env python3
"""Publish synthetic enrichment.requested events to NATS JetStream for testing.

Usage: publish_request.py [--count N] [--cnpj X]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import uuid

import nats

from company_enrichment.events.contracts import EnrichmentRequestedV1


async def main(args: argparse.Namespace) -> None:
    nc = await nats.connect(args.nats_url)
    js = nc.jetstream()
    for i in range(args.count):
        ev = EnrichmentRequestedV1(
            company_id=uuid.uuid4(),
            cnpj=args.cnpj or f"00.000.000/{10000 + i:04d}-00",
            company_name=f"Empresa Teste {i}",
            trade_name=f"Teste {i}",
            address_city="São Paulo",
            address_state="SP",
        )
        await js.publish(
            args.subject,
            json.dumps(ev.model_dump(mode="json"), default=str).encode(),
        )
        print(f"published {ev.event_id} {ev.cnpj} -> {args.subject}")
    await nc.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--nats-url", default=os.getenv("NATS_URL", "nats://localhost:4222"))
    p.add_argument("--subject", default="enrichment.company.requested.v1")
    p.add_argument("--count", type=int, default=1)
    p.add_argument("--cnpj", default=None)
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
