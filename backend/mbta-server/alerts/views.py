from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
import requests
from typing import Any, Callable

from streaming.sse import redis_channel_sse_stream

from .const import (
    ALERTS_CHANNEL,
    ALERTS_LATEST_SNAPSHOT_KEY,
    MBTA_KEY,
    MBTA_ALERTS_URL,
    REDIS_URL,
)
from .payload_transform import transform_mbta_payload_for_client


def _parse_route_filters(request) -> set[str]:
    """Parse route filters from query string.

    Supports either repeated query params or comma-separated values:
    - /alerts/stream?route_ids=Red&route_ids=Orange
    - /alerts/stream?route_ids=Red,Orange
    - /alerts/stream?routes=Red,Orange
    """

    raw_values = request.GET.getlist("route_ids") + request.GET.getlist("routes")
    route_ids: set[str] = set()
    for raw in raw_values:
        for item in raw.split(","):
            route = item.strip()
            if route:
                route_ids.add(route)
    return route_ids


def _build_stream_payload_transform(route_filters: set[str]) -> Callable[[Any], list[dict[str, Any]]]:
    """Build a payload transform that optionally filters rows by route id."""

    def _transform(payload: Any) -> list[dict[str, Any]]:
        rows = transform_mbta_payload_for_client(payload)
        if not route_filters:
            return rows
        return [row for row in rows if row.get("route") in route_filters]

    return _transform


def index(request):
    """
    Get all alerts from the MBTA API and return them as a JSON response.
    GET /alerts
    """
    headers = {"Authorization": f"Bearer {MBTA_KEY}"}
    try:
        response = requests.get(MBTA_ALERTS_URL, headers=headers)
        response.raise_for_status()
        return JsonResponse(response.json(), safe=False, status=response.status_code)
    except requests.exceptions.RequestException as e:
        return JsonResponse(
            {"error": "Failed to fetch MBTA alerts", "details": str(e)}, status=500
        )

async def alerts_stream(request):
    """Stream MBTA alerts from the internal broker using Server-Sent Events.

    The background worker maintains the single upstream MBTA SSE connection
    and publishes BrokerMessage JSON payloads into the ALERTS_CHANNEL. This
    view subscribes to that channel and fans out events to all connected
    clients, adding periodic heartbeats when idle.
    """

    route_filters = _parse_route_filters(request)

    response = StreamingHttpResponse(
        redis_channel_sse_stream(
            redis_url=REDIS_URL,
            channel=ALERTS_CHANNEL,
            payload_transform=_build_stream_payload_transform(route_filters),
            latest_snapshot_key=ALERTS_LATEST_SNAPSHOT_KEY,
        ),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


def health(request):
    return HttpResponse("OK")
