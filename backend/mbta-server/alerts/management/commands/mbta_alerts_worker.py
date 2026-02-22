import asyncio
import json
from typing import Any, Dict

from django.core.management.base import BaseCommand
import httpx

from alerts.const import ALERTS_CHANNEL, MBTA_KEY, MBTA_STREAMING_ALERTS_URL
from alerts.health_state import get_health_state
from alerts.logging_utils import log_worker_event
from alerts.mbta_event_streamer import mbta_event_streamer
from alerts.mbta_message_codec import encode_broker_message
from alerts.redis_client import get_redis_client
from streaming.worker import run_with_backoff


def _iter_alert_events(payload: Dict[str, Any]):
    """Yield canonical alert objects from MBTA payload variants."""

    data = payload.get("data")
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if isinstance(data, dict):
        yield data
        return
    yield payload


async def _publish_initial_snapshot(redis_client) -> None:
    """Publish current alerts once so subscribers receive immediate data."""

    headers = {"Authorization": f"Bearer {MBTA_KEY}"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(MBTA_STREAMING_ALERTS_URL, headers=headers)
        response.raise_for_status()
        payload = response.json()

    count = 0
    for event in _iter_alert_events(payload):
        if not event.get("id"):
            continue
        encoded = encode_broker_message(event)
        await redis_client.publish(ALERTS_CHANNEL, encoded)
        count += 1

    log_worker_event("snapshot_published", count=count)


async def _publish_stream() -> None:
    """Connect to MBTA SSE and publish events into Redis.

    This coroutine assumes a single long-lived upstream connection and
    publishes each parsed alert event into the ALERTS_CHANNEL.
    """

    health = get_health_state()
    redis_client = get_redis_client()
    try:
        try:
            await _publish_initial_snapshot(redis_client)
        except Exception as exc:
            log_worker_event("snapshot_failed", error=str(exc))

        async for raw_bytes in mbta_event_streamer():
            text = raw_bytes.decode("utf-8")
            if not text.startswith("data:"):
                continue
            raw = text.replace("data:", "", 1).strip()
            try:
                upstream_event: Dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                continue

            published_count = 0
            for event in _iter_alert_events(upstream_event):
                if not event.get("id"):
                    continue
                encoded = encode_broker_message(event)
                await redis_client.publish(ALERTS_CHANNEL, encoded)
                published_count += 1

            if published_count:
                health.mark_connected()
                health.record_event()
    finally:
        await redis_client.close()


async def _run_worker_loop() -> None:
    """Run the worker with shared capped backoff helper."""

    def on_start() -> None:
        log_worker_event("connect_start")

    def on_end() -> None:
        log_worker_event("stream_ended")

    def on_error(exc: Exception) -> None:
        health = get_health_state()
        health.mark_disconnected(str(exc))
        log_worker_event("stream_error", error=str(exc))

    await run_with_backoff(
        run_once=_publish_stream,
        on_start=on_start,
        on_end=on_end,
        on_error=on_error,
        base_delay=1.0,
        max_delay=30.0,
    )


class Command(BaseCommand):
    help = "Run the MBTA alerts background worker (single upstream SSE to Redis pub/sub)."

    def handle(self, *args: Any, **options: Any) -> None:  # type: ignore[override]
        asyncio.run(_run_worker_loop())
