import json
import re
from typing import Any

from .const import (
    TRACKING_SEARCH_DEFAULT_LIMIT,
    TRACKING_SEARCH_MAX_LIMIT,
    TRACKING_STATION_NAME_INDEX_PREFIX,
    TRACKING_STATION_ROWS_KEY,
)


_INDEX_KEYS_SET = "mbta:tracking:station_name:index_keys"


def normalize_station_name(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.strip().lower())
    normalized = re.sub(r"[^a-z0-9 /&'-]", "", normalized)
    return normalized


def build_station_record(row: dict[str, Any]) -> dict[str, Any] | None:
    stop_id = row.get("id")
    attributes = (
        row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
    )
    name = attributes.get("name")

    if not stop_id or not name:
        return None

    return {
        "station_id": str(stop_id),
        "station_name": str(name),
        "normalized_name": normalize_station_name(str(name)),
        "municipality": attributes.get("municipality"),
        "platform_name": attributes.get("platform_name"),
    }


def _station_name_index_key(normalized_name: str, station_id: str) -> str:
    return f"{TRACKING_STATION_NAME_INDEX_PREFIX}:{normalized_name}:{station_id}"


async def refresh_station_index(
    redis_client, station_rows: list[dict[str, Any]]
) -> int:
    previous_keys = await redis_client.smembers(_INDEX_KEYS_SET)
    for raw_key in previous_keys:
        key = raw_key.decode("utf-8") if isinstance(raw_key, bytes) else raw_key
        if isinstance(key, str):
            await redis_client.delete(key)

    await redis_client.delete(_INDEX_KEYS_SET)
    await redis_client.delete(TRACKING_STATION_ROWS_KEY)

    indexed = 0
    for row in station_rows:
        station = build_station_record(row)
        if not station:
            continue

        station_id = station["station_id"]
        await redis_client.hset(
            TRACKING_STATION_ROWS_KEY,
            station_id,
            json.dumps(station, separators=(",", ":"), sort_keys=True),
        )

        index_key = _station_name_index_key(station["normalized_name"], station_id)
        await redis_client.set(index_key, station_id)
        await redis_client.sadd(_INDEX_KEYS_SET, index_key)
        indexed += 1

    return indexed


async def search_station_ids_like(
    redis_client, query: str, *, limit: int | None = None
) -> list[str]:
    normalized_query = normalize_station_name(query)
    if not normalized_query:
        return []

    effective_limit = (
        limit if isinstance(limit, int) and limit > 0 else TRACKING_SEARCH_DEFAULT_LIMIT
    )
    effective_limit = min(effective_limit, TRACKING_SEARCH_MAX_LIMIT)

    ids: list[str] = []
    seen: set[str] = set()
    pattern = f"{TRACKING_STATION_NAME_INDEX_PREFIX}:*{normalized_query}*"

    async for raw_key in redis_client.scan_iter(match=pattern):
        key = raw_key.decode("utf-8") if isinstance(raw_key, bytes) else raw_key
        if not isinstance(key, str):
            continue

        station_id = key.rsplit(":", 1)[-1]
        if station_id in seen:
            continue

        seen.add(station_id)
        ids.append(station_id)
        if len(ids) >= effective_limit:
            break

    return ids


async def fetch_station_records(
    redis_client, station_ids: list[str]
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for station_id in station_ids:
        payload = await redis_client.hget(TRACKING_STATION_ROWS_KEY, station_id)
        payload = payload.decode("utf-8") if isinstance(payload, bytes) else payload
        if not isinstance(payload, str):
            continue

        try:
            parsed = json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            continue

        if isinstance(parsed, dict):
            records.append(parsed)

    return records


async def search_stations(
    redis_client, query: str, *, limit: int | None = None
) -> list[dict[str, Any]]:
    station_ids = await search_station_ids_like(redis_client, query, limit=limit)
    records = await fetch_station_records(redis_client, station_ids)

    records.sort(
        key=lambda item: (
            str(item.get("station_name", "")).lower(),
            str(item.get("station_id", "")),
        )
    )
    return records
