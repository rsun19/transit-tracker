import asyncio
import json
from typing import Any, Dict

from django.core.management.base import BaseCommand

from alerts.const import ALERTS_CHANNEL, ALERTS_LATEST_SNAPSHOT_KEY
from alerts.health_state import get_health_state
from alerts.logging_utils import log_worker_event
from alerts.mbta_event_streamer import mbta_stream_events
from alerts.mbta_message_codec import encode_broker_message
from alerts.redis_client import get_redis_client
from streaming.worker import run_with_backoff


ACTIVE_ALERTS_HASH_KEY = "mbta:alerts:active"


async def _apply_message_fallback(redis_client, payload: Any) -> tuple[bool, str]:
    """Handle unlabeled/message events from MBTA streams.

    Some streams may omit explicit event types and emit payload-only messages.
    We infer behavior using payload shape:
    - list[resource] => reset
    - dict with `data` list/dict => reset or upsert
    - dict resource with attributes => upsert
    - dict identifier (`id` + `type` only) => remove
    """

    if isinstance(payload, list):
        alerts = [item for item in payload if isinstance(item, dict)]
        await _replace_active_state(redis_client, alerts)
        return True, "message_reset"

    if isinstance(payload, dict) and "data" in payload:
        data = payload.get("data")
        if isinstance(data, list):
            alerts = [item for item in data if isinstance(item, dict)]
            await _replace_active_state(redis_client, alerts)
            return True, "message_reset"
        if isinstance(data, dict):
            changed = await _upsert_active_alert(redis_client, data)
            return changed, "message_update"

    if isinstance(payload, dict):
        has_attributes = isinstance(payload.get("attributes"), dict)
        if has_attributes:
            changed = await _upsert_active_alert(redis_client, payload)
            return changed, "message_update"

        has_identifier = payload.get("id") is not None and payload.get("type") is not None
        if has_identifier:
            removed = await _remove_active_alert(redis_client, payload)
            return removed, "message_remove"

    return False, "message_ignored"


async def _publish_full_snapshot(redis_client) -> int:
    """Publish the full active alerts snapshot to downstream subscribers."""

    values = await redis_client.hvals(ACTIVE_ALERTS_HASH_KEY)
    alerts: list[Dict[str, Any]] = []
    for value in values:
        raw = value.decode("utf-8") if isinstance(value, bytes) else value
        try:
            alert = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(alert, dict):
            alerts.append(alert)

    alerts.sort(key=lambda item: str(item.get("id", "")))
    snapshot_json = json.dumps(alerts)
    await redis_client.set(ALERTS_LATEST_SNAPSHOT_KEY, snapshot_json)
    encoded = encode_broker_message(alerts)
    await redis_client.publish(ALERTS_CHANNEL, encoded)
    return len(alerts)


async def _replace_active_state(redis_client, alerts: list[Dict[str, Any]]) -> int:
    """Replace active-state store from a reset event payload."""

    await redis_client.delete(ACTIVE_ALERTS_HASH_KEY)
    mapping: dict[str, str] = {}
    for event in alerts:
        alert_id = event.get("id")
        if not alert_id:
            continue
        mapping[str(alert_id)] = json.dumps(event, separators=(",", ":"), sort_keys=True)

    if mapping:
        await redis_client.hset(ACTIVE_ALERTS_HASH_KEY, mapping=mapping)
    return len(mapping)


async def _upsert_active_alert(redis_client, event: Dict[str, Any]) -> bool:
    """Upsert one active alert; returns True if state changed."""

    alert_id = event.get("id")
    if not alert_id:
        return False

    key = str(alert_id)
    serialized = json.dumps(event, separators=(",", ":"), sort_keys=True)
    existing = await redis_client.hget(ACTIVE_ALERTS_HASH_KEY, key)
    if isinstance(existing, bytes):
        existing = existing.decode("utf-8")

    await redis_client.hset(ACTIVE_ALERTS_HASH_KEY, key, serialized)
    return existing != serialized


async def _remove_active_alert(redis_client, identifier: Dict[str, Any]) -> bool:
    """Remove one active alert by JSON:API resource identifier."""

    alert_id = identifier.get("id") if isinstance(identifier, dict) else None
    if not alert_id:
        return False
    deleted = await redis_client.hdel(ACTIVE_ALERTS_HASH_KEY, str(alert_id))
    return bool(deleted)


async def _publish_stream() -> None:
    """Connect to MBTA SSE and publish events into Redis.

    This coroutine assumes a single long-lived upstream connection and
    publishes each parsed alert event into the ALERTS_CHANNEL.
    """

    redis_client = get_redis_client()
    try:
        health = get_health_state()

        async for event_type, payload in mbta_stream_events():
            event_type = (event_type or "").lower()
            state_changed = False
            source_event = event_type

            if event_type == "reset":
                alerts = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
                count = await _replace_active_state(redis_client, alerts)
                log_worker_event("stream_reset", count=count)
                state_changed = True
            elif event_type in {"add", "update"}:
                if isinstance(payload, dict):
                    state_changed = await _upsert_active_alert(redis_client, payload)
            elif event_type == "remove":
                if isinstance(payload, dict):
                    removed = await _remove_active_alert(redis_client, payload)
                    if removed:
                        log_worker_event("stream_remove", id=payload.get("id"))
                    state_changed = removed
            elif event_type in {"message", ""}:
                state_changed, source_event = await _apply_message_fallback(
                    redis_client, payload
                )
            else:
                # Ignore unknown events, but keep the stream running.
                log_worker_event("stream_event_ignored", event_type=event_type)
                continue

            if state_changed:
                active_count = await _publish_full_snapshot(redis_client)
                health.mark_connected()
                health.record_event()
                log_worker_event(
                    "snapshot_published",
                    active_count=active_count,
                    source_event=source_event,
                )
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
