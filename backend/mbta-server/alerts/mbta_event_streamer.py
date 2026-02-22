import httpx
import json
from .const import MBTA_STREAMING_ALERTS_URL, MBTA_KEY




async def mbta_event_streamer():
    """
    Stream MBTA alerts using Server-Sent Events (SSE) asynchronously.
    Yields properly formatted SSE event bytes (terminated by a blank line).
    """
    headers = {"Accept": "text/event-stream"}
    url = MBTA_STREAMING_ALERTS_URL
    if MBTA_KEY:
        url = f"{url}&api_key={MBTA_KEY}"
    async with httpx.AsyncClient(timeout=None, http2=True) as client:
        async with client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()
            async for raw_line in response.aiter_lines():
                if not raw_line:
                    continue
                if isinstance(raw_line, bytes):
                    line = raw_line.decode("utf-8")
                else:
                    line = raw_line
                if line.startswith(":"):
                    # SSE comment/heartbeat
                    continue
                if line.startswith("data:"):
                    raw_data = line.replace("data:", "").strip()
                    try:
                        parsed = json.loads(raw_data)
                        yield f"data: {json.dumps(parsed)}\n\n".encode("utf-8")
                    except json.JSONDecodeError:
                        continue
