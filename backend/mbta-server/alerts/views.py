# Create your views here.
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
import requests
from .mbta_event_streamer import mbta_event_streamer
from .const import MBTA_KEY, MBTA_ALERTS_URL


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


from asgiref.sync import sync_to_async

async def alerts_stream(request):
    """
    Endpoint to stream MBTA alerts using Server-Sent Events (SSE).
    GET /alerts/stream
    """
    response = StreamingHttpResponse(
        mbta_event_streamer(), content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


def health(request):
    return HttpResponse("OK")
