#!/usr/bin/env python3
"""Multi-replica durability verification (plan §47/§48).

Spawns two real graph-mode worker processes against live NATS + PostgreSQL,
publishes N company requests, kills one worker mid-flight, and asserts:
  - all N requests complete (at-least-once redelivery + idempotency)
  - N cases COMPLETED
  - N versioned enrichments, zero duplicates

Usage:
  NATS_TEST_URL=nats://localhost:4222 \
  DATABASE_TEST_URL=postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test \
  python scripts/verify_durability.py --count 12

Exits non-zero on any assertion failure.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid

import asyncpg
import nats

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NATS_URL = os.getenv("NATS_TEST_URL", "nats://localhost:4222")
DATABASE_URL = os.getenv(
    "DATABASE_TEST_URL",
    "postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test",
)
STREAM = "ENRICHMENT"
WORKER_TYPES = "orchestrator,registry,domain,contacts,tech,financial"


def _env_for(worker_id: str, port: int) -> dict:
    e = dict(os.environ)
    e.update({
        "PYTHONUNBUFFERED": "1",
        "NATS_URL": NATS_URL,
        "DATABASE_URL": DATABASE_URL,
        "NATS_STREAM": STREAM,
        "STREAM_SUBJECTS": "enrichment.>",
        "WORKER_TYPES": WORKER_TYPES,
        "WORKER_CONCURRENCY": "3",
        "WORKER_LEASE_SECONDS": "30",
        "GRAPH_MAX_DEPTH": "2",
        "SEARXNG_URL": "",
        "CNPJ_DATABASE_URL": "",
        "AI_GATEWAY_API_KEY": "",
        "LOG_LEVEL": "INFO",
        "WORKER_ID": worker_id,
        "PORT": str(port),
    })
    return e


async def _reset_state(nc: nats.NATS) -> None:
    js = nc.jetstream()
    for s in (await js.streams_info()):
        try:
            await js.delete_stream(s.config.name)
        except Exception:  # noqa: BLE001
            pass


async def _wait_ready(procs: list[subprocess.Popen], timeout: float = 60.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if any(p.poll() is not None for p in procs):
            return False
        for port in (8080, 8081):
            try:
                urllib.request.urlopen(f"http://localhost:{port}/readyz", timeout=1)
                return True
            except Exception:  # noqa: BLE001
                pass
        await asyncio.sleep(0.4)
    return False


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=12)
    args = parser.parse_args()
    count = args.count

    nc = await nats.connect(NATS_URL)
    await _reset_state(nc)

    logs = [open(f"/tmp/durability_worker_{i}.log", "w") for i in range(2)]
    procs = [
        subprocess.Popen(
            [sys.executable, "-u", "-m", "company_enrichment"],
            env=_env_for(f"durability-{i}", 8080 + i),
            cwd=ROOT,
            stdout=logs[i],
            stderr=subprocess.STDOUT,
        )
        for i in range(2)
    ]

    if not await _wait_ready(procs):
        print("FAIL: workers did not become ready", flush=True)
        for p in procs:
            p.kill()
        return 1

    completed: list[dict] = []
    js = nc.jetstream()

    async def on_msg(msg) -> None:
        completed.append(json.loads(msg.data))

    sub = await js.subscribe("enrichment.company.completed.v1", cb=on_msg)
    for _ in range(count):
        req = {
            "version": "1",
            "event_id": str(uuid.uuid4()),
            "company_id": str(uuid.uuid4()),
            "cnpj": "12345678000199",
            "company_name": f"Durability Co {uuid.uuid4().hex[:6]}",
            "published_at": "2026-08-16T00:00:00Z",
        }
        await js.publish("enrichment.company.requested.v1", json.dumps(req).encode())

    print(f"published {count} requests; killing worker 0 mid-flight", flush=True)
    await asyncio.sleep(4)
    procs[0].kill()
    procs[0].wait(timeout=10)

    end = time.time() + 120
    while time.time() < end and len(completed) < count:
        await asyncio.sleep(0.5)

    await sub.unsubscribe()
    procs[1].terminate()
    try:
        procs[1].wait(timeout=10)
    except Exception:  # noqa: BLE001
        procs[1].kill()
    for lf in logs:
        lf.flush()
        lf.close()

    conn = await asyncpg.connect(DATABASE_URL.replace("+asyncpg", ""))
    try:
        n_cases = await conn.fetchval(
            "SELECT count(*) FROM company_enrichment.enrichment_cases WHERE status='COMPLETED'"
        )
        n_enr = await conn.fetchval(
            "SELECT count(*) FROM company_enrichment.company_enrichments"
        )
        n_dup = await conn.fetchval(
            "SELECT count(*) FROM (SELECT company_id FROM company_enrichment.company_enrichments "
            "GROUP BY company_id HAVING count(*)>1) x"
        )
    finally:
        await conn.close()
    await nc.close()

    print(
        json.dumps({
            "published": count,
            "completed": len(completed),
            "cases_completed": n_cases,
            "enrichments": n_enr,
            "duplicate_enrichments": n_dup,
        }),
        flush=True,
    )
    if len(completed) != count or n_cases != count or n_enr != count or n_dup != 0:
        print("FAIL: durability invariant violated", flush=True)
        return 1
    print("PASS: no lost events, no duplicate final enrichments", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
