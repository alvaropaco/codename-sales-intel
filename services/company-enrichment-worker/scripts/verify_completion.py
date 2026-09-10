#!/usr/bin/env python3
"""Verify completion of enrichment events by watching NATS output subjects.

Waits until `--expect` completed events are seen (or timeout). Exits non-zero
if the expected count is not reached.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time

import nats


async def main(args: argparse.Namespace) -> None:
    nc = await nats.connect(args.nats_url)

    subjects = [
        "enrichment.company.completed.v1",
        "enrichment.company.failed.v1",
        "enrichment.company.discarded.v1",
        "enrichment.company.partial.v1",
    ]
    results: dict[str, int] = {s: 0 for s in subjects}
    deadline = time.monotonic() + args.timeout
    completed_target = args.expect

    for subj in subjects:
        async def _handler(msg, _subj=subj):
            try:
                data = json.loads(msg.data)
            except Exception:
                data = {}
            results[_subj] += 1
            status = data.get("status")
            print(f"EVENT {_subj} status={status} cnpj={data.get('cnpj')}", flush=True)
            await msg.ack()

        await nc.subscribe(subj, cb=_handler)

    while time.monotonic() < deadline:
        if results["enrichment.company.completed.v1"] >= completed_target:
            print(f"OK completed={results} reached target {completed_target}")
            await nc.close()
            return
        await asyncio.sleep(0.5)

    print(f"TIMEOUT completed={results} target={completed_target}")
    await nc.close()
    raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--nats-url", default=os.getenv("NATS_URL", "nats://localhost:4222"))
    p.add_argument("--expect", type=int, default=1)
    p.add_argument("--timeout", type=float, default=120.0)
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
