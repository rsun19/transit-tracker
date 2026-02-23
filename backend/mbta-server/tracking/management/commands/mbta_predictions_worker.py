import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from django.core.management.base import BaseCommand

from streaming.codec import encode_broker_message
from streaming.worker import run_with_backoff

from tracking.const import TRACKING_POLL_INTERVAL_SECONDS, TRACKING_PREDICTIONS_CHANNEL
from tracking.mbta_predictions_client import fetch_predictions_for_routes
from tracking.prediction_cache import write_prediction_snapshot
from tracking.redis_client import get_redis_client
from tracking.static_dataset import get_rapid_transit_route_ids, get_rapid_transit_stops
from tracking.station_index import refresh_station_index
from tracking.payload_transform import transform_predictions_for_client


def _parse_iso_utc(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _compute_ingestion_lag_seconds(records: list[dict[str, Any]]) -> float | None:
    candidate_timestamps: list[datetime] = []
    for record in records:
        updated_at = _parse_iso_utc(record.get("updated_at"))
        if updated_at is not None:
            candidate_timestamps.append(updated_at)

    if not candidate_timestamps:
        return None

    newest = max(candidate_timestamps)
    lag = datetime.now(UTC) - newest
    return max(0.0, lag.total_seconds())


async def _poll_and_publish(redis_client) -> dict[str, Any]:
    cycle_started = time.perf_counter()
    route_ids = await get_rapid_transit_route_ids(redis_client)
    if not route_ids:
        return {
            "record_count": 0,
            "route_count": 0,
            "stop_count": 0,
            "publish_count": 0,
            "ingestion_lag_s": None,
            "cycle_duration_ms": (time.perf_counter() - cycle_started) * 1000,
        }

    raw_predictions = await fetch_predictions_for_routes(route_ids)
    fetched_at = time.perf_counter()
    records = transform_predictions_for_client(raw_predictions)
    transformed_at = time.perf_counter()
    stats = await write_prediction_snapshot(redis_client, records)

    encoded = encode_broker_message(
        {
            "id": "tracking-predictions-snapshot",
            "records": records,
        }
    )
    publish_count = await redis_client.publish(TRACKING_PREDICTIONS_CHANNEL, encoded)
    published_at = time.perf_counter()

    stats["publish_count"] = int(publish_count)
    stats["ingestion_lag_s"] = _compute_ingestion_lag_seconds(records)
    stats["fetch_duration_ms"] = (fetched_at - cycle_started) * 1000
    stats["transform_duration_ms"] = (transformed_at - fetched_at) * 1000
    stats["publish_duration_ms"] = (published_at - transformed_at) * 1000
    stats["cycle_duration_ms"] = (published_at - cycle_started) * 1000

    return stats


async def _run_worker_cycle() -> None:
    redis_client = get_redis_client()
    try:
        station_rows = await get_rapid_transit_stops(redis_client)
        await refresh_station_index(redis_client, station_rows)

        while True:
            stats = await _poll_and_publish(redis_client)
            lag = stats.get("ingestion_lag_s")
            lag_display = f"{lag:.3f}" if isinstance(lag, (float, int)) else "n/a"
            print(
                "[tracking.worker] "
                f"snapshot_at={datetime.now(UTC).isoformat()} "
                f"records={stats['record_count']} routes={stats['route_count']} stops={stats['stop_count']} "
                f"published_to_clients={stats.get('publish_count', 0)} "
                f"ingestion_lag_s={lag_display} "
                f"fetch_ms={stats.get('fetch_duration_ms', 0):.2f} "
                f"transform_ms={stats.get('transform_duration_ms', 0):.2f} "
                f"publish_ms={stats.get('publish_duration_ms', 0):.2f} "
                f"cycle_ms={stats.get('cycle_duration_ms', 0):.2f}"
            )
            await asyncio.sleep(TRACKING_POLL_INTERVAL_SECONDS)
    finally:
        await redis_client.close()


async def _run_worker_loop() -> None:
    await run_with_backoff(run_once=_run_worker_cycle, base_delay=1.0, max_delay=30.0)


class Command(BaseCommand):
    help = "Run MBTA predictions worker for tracking SSE and polling endpoints."

    def handle(self, *args: Any, **options: Any) -> None:  # type: ignore[override]
        asyncio.run(_run_worker_loop())
