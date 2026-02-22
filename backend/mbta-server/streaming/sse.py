import asyncio
import json
import time
from typing import Any, AsyncIterator, Callable

from .broker import get_redis_client_from_url
from .codec import decode_broker_message


async def redis_channel_sse_stream(
    *,
    redis_url: str,
    channel: str,
    heartbeat_interval: float = 25.0,
    payload_transform: Callable[[Any], Any] | None = None,
    latest_snapshot_key: str | None = None,
) -> AsyncIterator[bytes]:
    """Stream broker channel messages as SSE bytes with periodic heartbeats.

    If Redis is unavailable, keep the SSE connection open and continue
    emitting heartbeats while retrying broker connection with capped backoff.
    """

    last_heartbeat = time.monotonic()
    reconnect_delay = 1.0
    max_reconnect_delay = 30.0

    sent_initial = False

    try:
        while True:
            client = None
            pubsub = None
            try:
                client = get_redis_client_from_url(redis_url)

                if not sent_initial:
                    snapshot_payload: Any = []
                    if latest_snapshot_key:
                        raw_snapshot = await client.get(latest_snapshot_key)
                        if isinstance(raw_snapshot, bytes):
                            raw_snapshot = raw_snapshot.decode("utf-8")
                        if raw_snapshot:
                            try:
                                snapshot_payload = json.loads(raw_snapshot)
                            except json.JSONDecodeError:
                                snapshot_payload = []

                    if payload_transform is not None:
                        try:
                            snapshot_payload = payload_transform(snapshot_payload)
                        except Exception:
                            snapshot_payload = []

                    yield f"data: {json.dumps(snapshot_payload)}\n\n".encode("utf-8")
                    sent_initial = True

                pubsub = client.pubsub()
                await pubsub.subscribe(channel)
                reconnect_delay = 1.0

                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=5.0
                    )
                    now = time.monotonic()
                    if message is None:
                        if now - last_heartbeat >= heartbeat_interval:
                            yield b": heartbeat\n\n"
                            last_heartbeat = now
                        continue

                    data = message.get("data")
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")

                    try:
                        broker_message = decode_broker_message(data)
                    except (TypeError, json.JSONDecodeError):
                        continue

                    payload = broker_message.get("payload")
                    if payload is None:
                        continue

                    if payload_transform is not None:
                        try:
                            payload = payload_transform(payload)
                        except Exception:
                            continue

                    yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
                    last_heartbeat = now
            except asyncio.CancelledError:
                raise
            except Exception:
                now = time.monotonic()
                if now - last_heartbeat >= heartbeat_interval:
                    yield b": heartbeat\n\n"
                    last_heartbeat = now

                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(max_reconnect_delay, reconnect_delay * 2)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.unsubscribe(channel)
                    except Exception:
                        pass
                    try:
                        await pubsub.close()
                    except Exception:
                        pass
                if client is not None:
                    try:
                        await client.close()
                    except Exception:
                        pass
    except asyncio.CancelledError:
        return
