import json
from datetime import UTC, datetime
from typing import Any

from .const import (
    TRACKING_PREDICTIONS_BY_ROUTE_KEY_PREFIX,
    TRACKING_PREDICTIONS_BY_STOP_KEY_PREFIX,
    TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY,
)


def _key_by_route(route_id: str) -> str:
    return f"{TRACKING_PREDICTIONS_BY_ROUTE_KEY_PREFIX}:{route_id}"


def _key_by_stop(stop_id: str) -> str:
    return f"{TRACKING_PREDICTIONS_BY_STOP_KEY_PREFIX}:{stop_id}"


def _parse_json_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    if not isinstance(payload, str) or not payload:
        return []

    try:
        parsed = json.loads(payload)
    except (TypeError, json.JSONDecodeError):
        return []

    if not isinstance(parsed, list):
        return []

    return [item for item in parsed if isinstance(item, dict)]


async def write_prediction_snapshot(
    redis_client, predictions: list[dict[str, Any]]
) -> dict[str, int]:
    snapshot_at = datetime.now(UTC).isoformat()

    by_route: dict[str, list[dict[str, Any]]] = {}
    by_stop: dict[str, list[dict[str, Any]]] = {}

    for prediction in predictions:
        route_id = prediction.get("route_id")
        stop_id = prediction.get("stop_id")

        if route_id:
            by_route.setdefault(str(route_id), []).append(prediction)
        if stop_id:
            by_stop.setdefault(str(stop_id), []).append(prediction)

    for route_id, items in by_route.items():
        await redis_client.set(
            _key_by_route(route_id),
            json.dumps(items, separators=(",", ":"), sort_keys=True),
        )

    for stop_id, items in by_stop.items():
        await redis_client.set(
            _key_by_stop(stop_id),
            json.dumps(items, separators=(",", ":"), sort_keys=True),
        )

    snapshot_payload = {
        "records": predictions,
        "snapshot_at": snapshot_at,
        "route_count": len(by_route),
    }
    await redis_client.set(
        TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY,
        json.dumps(snapshot_payload, separators=(",", ":"), sort_keys=True),
    )

    return {
        "record_count": len(predictions),
        "route_count": len(by_route),
        "stop_count": len(by_stop),
    }


async def read_latest_snapshot(redis_client) -> dict[str, Any]:
    payload = await redis_client.get(TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY)
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")

    if not isinstance(payload, str) or not payload:
        return {"records": [], "snapshot_at": None, "route_count": 0}

    try:
        parsed = json.loads(payload)
    except (TypeError, json.JSONDecodeError):
        return {"records": [], "snapshot_at": None, "route_count": 0}

    if not isinstance(parsed, dict):
        return {"records": [], "snapshot_at": None, "route_count": 0}

    return parsed


async def read_predictions_by_stop(redis_client, stop_id: str) -> list[dict[str, Any]]:
    payload = await redis_client.get(_key_by_stop(stop_id))
    return _parse_json_list(payload)


async def read_predictions_by_route(
    redis_client, route_id: str
) -> list[dict[str, Any]]:
    payload = await redis_client.get(_key_by_route(route_id))
    return _parse_json_list(payload)


def _prediction_sort_key(item: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(item.get("arrival_time") or item.get("departure_time") or ""),
        str(item.get("route_id") or ""),
        str(item.get("prediction_id") or ""),
    )


def _projection(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "prediction_id": item.get("prediction_id"),
        "route_id": item.get("route_id"),
        "stop_id": item.get("stop_id"),
        "trip_id": item.get("trip_id"),
        "direction_id": item.get("direction_id"),
        "arrival_time": item.get("arrival_time"),
        "departure_time": item.get("departure_time"),
        "stop_sequence": item.get("stop_sequence"),
        "status": item.get("status"),
        "updated_at": item.get("updated_at"),
    }


async def read_station_predictions(
    redis_client, station_id: str
) -> list[dict[str, Any]]:
    rows = await read_predictions_by_stop(redis_client, station_id)
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=_prediction_sort_key)
    return [_projection(row) for row in rows]
