import json
from typing import Any


STATIC_TRANSIT_NAMESPACE = "mbta:static:transit"


def _decode(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return value


async def get_dataset_current_version(
    redis_client, dataset: str, namespace: str = STATIC_TRANSIT_NAMESPACE
) -> str | None:
    value = await redis_client.get(f"{namespace}:{dataset}:current_version")
    value = _decode(value)
    return value if isinstance(value, str) and value else None


async def get_dataset_rows(
    redis_client,
    dataset: str,
    *,
    namespace: str = STATIC_TRANSIT_NAMESPACE,
    version: str | None = None,
) -> list[dict[str, Any]]:
    resolved_version = version or await get_dataset_current_version(
        redis_client, dataset, namespace
    )
    if not resolved_version:
        return []

    rows_key = f"{namespace}:{resolved_version}:{dataset}:rows"
    rows_mapping = await redis_client.hgetall(rows_key)
    rows: list[dict[str, Any]] = []

    for raw in rows_mapping.values():
        decoded = _decode(raw)
        if not isinstance(decoded, str):
            continue
        try:
            parsed = json.loads(decoded)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            rows.append(parsed)

    return rows


async def get_rapid_transit_route_ids(redis_client) -> list[str]:
    rows = await get_dataset_rows(redis_client, "rapid_transit_routes")
    route_ids = {
        str(row.get("id")) for row in rows if isinstance(row, dict) and row.get("id")
    }
    return sorted(route_ids)


async def get_rapid_transit_routes(redis_client) -> list[dict[str, str | None]]:
    rows = await get_dataset_rows(redis_client, "rapid_transit_routes")
    route_map: dict[str, str | None] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue

        route_id = row.get("id")
        if not route_id:
            continue

        route_id_str = str(route_id)
        attributes = row.get("attributes")
        long_name: str | None = None
        if isinstance(attributes, dict):
            raw_long_name = attributes.get("long_name")
            if raw_long_name is not None:
                long_name = str(raw_long_name)

        route_map[route_id_str] = long_name

    sorted_items = sorted(
        route_map.items(),
        key=lambda item: ((item[1] or "").casefold(), item[0].casefold()),
    )

    return [
        {"route_id": route_id, "long_name": long_name}
        for route_id, long_name in sorted_items
    ]


async def get_rapid_transit_stops(redis_client) -> list[dict[str, Any]]:
    return await get_dataset_rows(redis_client, "rapid_transit_stops")
