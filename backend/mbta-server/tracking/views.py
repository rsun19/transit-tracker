from typing import Any, Callable

from django.http import JsonResponse, StreamingHttpResponse

from streaming.sse import redis_channel_sse_stream

from .const import (
    REDIS_URL,
    TRACKING_PREDICTIONS_CHANNEL,
    TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY,
    TRACKING_SEARCH_DEFAULT_LIMIT,
    TRACKING_SEARCH_MAX_LIMIT,
    TRACKING_STATION_ROWS_KEY,
)
from .errors import error_response
from .prediction_cache import read_latest_snapshot, read_station_predictions
from .redis_client import get_redis_client
from .static_dataset import get_rapid_transit_routes
from .station_index import search_stations as search_stations_in_cache


def _tracking_payload_transform(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        records = payload.get("records")
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _parse_route_filters(request) -> set[str]:
    raw_values = request.GET.getlist("route_id")
    route_ids: set[str] = set()
    for raw in raw_values:
        for item in raw.split(","):
            route = item.strip()
            if route:
                route_ids.add(route)
    return route_ids


def _build_tracking_stream_payload_transform(
    route_filters: set[str],
) -> Callable[[Any], list[dict[str, Any]]]:
    def _transform(payload: Any) -> list[dict[str, Any]]:
        rows = _tracking_payload_transform(payload)
        if not route_filters:
            return rows
        return [row for row in rows if row.get("route_id") in route_filters]

    return _transform


def _parse_limit(raw_limit: str | None) -> tuple[int | None, JsonResponse | None]:
    if raw_limit is None or not raw_limit.strip():
        return TRACKING_SEARCH_DEFAULT_LIMIT, None

    try:
        parsed = int(raw_limit)
    except ValueError:
        return None, error_response(
            code="invalid_query",
            message="Query parameter 'limit' must be an integer.",
            details={"parameter": "limit"},
            status=400,
        )

    if parsed < 1 or parsed > TRACKING_SEARCH_MAX_LIMIT:
        return None, error_response(
            code="invalid_query",
            message=f"Query parameter 'limit' must be between 1 and {TRACKING_SEARCH_MAX_LIMIT}.",
            details={"parameter": "limit"},
            status=400,
        )

    return parsed, None


async def tracking_stream(request):
    route_filters = _parse_route_filters(request)

    response = StreamingHttpResponse(
        redis_channel_sse_stream(
            redis_url=REDIS_URL,
            channel=TRACKING_PREDICTIONS_CHANNEL,
            payload_transform=_build_tracking_stream_payload_transform(route_filters),
            latest_snapshot_key=TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY,
        ),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


async def available_route_ids(_request):
    redis_client = get_redis_client()
    try:
        routes = await get_rapid_transit_routes(redis_client)
    except Exception as exc:
        return error_response(
            code="cache_unavailable",
            message="Failed to query route ids cache.",
            details=str(exc),
            status=503,
        )
    finally:
        await redis_client.close()

    return JsonResponse({"routes": routes}, status=200)


async def search_stations(request):
    query = (request.GET.get("q") or "").strip()
    if not query:
        return error_response(
            code="invalid_query",
            message="Query parameter 'q' is required.",
            details={"parameter": "q"},
            status=400,
        )

    limit, limit_error = _parse_limit(request.GET.get("limit"))
    if limit_error is not None:
        return limit_error

    redis_client = get_redis_client()
    try:
        stations = await search_stations_in_cache(redis_client, query, limit=limit)
    except Exception as exc:
        return error_response(
            code="cache_unavailable",
            message="Failed to query station search cache.",
            details=str(exc),
            status=503,
        )
    finally:
        await redis_client.close()

    results = [
        {
            "station_id": station.get("station_id"),
            "station_name": station.get("station_name"),
            "municipality": station.get("municipality"),
        }
        for station in stations
    ]
    return JsonResponse({"stations": results}, status=200)


async def station_predictions(request):
    station_id = (request.GET.get("station_id") or "").strip()
    if not station_id:
        return error_response(
            code="invalid_query",
            message="Query parameter 'station_id' is required.",
            details={"parameter": "station_id"},
            status=400,
        )

    redis_client = get_redis_client()
    try:
        station_row = await redis_client.hget(TRACKING_STATION_ROWS_KEY, station_id)
        if not station_row:
            return error_response(
                code="station_not_found",
                message="Station id was not found in station cache.",
                details={"station_id": station_id},
                status=404,
            )

        predictions = await read_station_predictions(redis_client, station_id)
        snapshot = await read_latest_snapshot(redis_client)
    except Exception as exc:
        return error_response(
            code="cache_unavailable",
            message="Failed to query station predictions cache.",
            details=str(exc),
            status=503,
        )
    finally:
        await redis_client.close()

    return JsonResponse(
        {
            "station_id": station_id,
            "predictions": predictions,
            "last_updated": snapshot.get("snapshot_at"),
        },
        status=200,
    )
