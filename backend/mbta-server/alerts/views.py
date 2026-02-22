from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
import requests

from streaming.sse import redis_channel_sse_stream

from .const import ALERTS_CHANNEL, MBTA_KEY, MBTA_ALERTS_URL, REDIS_URL
from .payload_transform import transform_mbta_payload_for_client


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

    response = StreamingHttpResponse(
        redis_channel_sse_stream(
            redis_url=REDIS_URL,
            channel=ALERTS_CHANNEL,
            payload_transform=transform_mbta_payload_for_client,
        ),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


def health(request):
    return HttpResponse("OK")
