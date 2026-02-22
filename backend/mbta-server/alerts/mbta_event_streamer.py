import httpx
import json
from .const import MBTA_STREAMING_ALERTS_URL, MBTA_KEY


def mbta_event_streamer():
    """
    Stream MBTA alerts using Server-Sent Events (SSE) synchronously.
    Yields properly formatted SSE event strings (terminated by a blank line).
    """
    headers = {"Authorization": f"Bearer {MBTA_KEY}"}
    with httpx.Client(timeout=None) as client:
        with client.stream(
            "GET", MBTA_STREAMING_ALERTS_URL, headers=headers
        ) as response:
            for raw_line in response.iter_lines():
                if not raw_line:
                    continue
                if isinstance(raw_line, bytes):
                    line = raw_line.decode("utf-8")
                else:
                    line = raw_line
                if line.startswith("data:"):
                    raw_data = line.replace("data:", "").strip()
                    try:
                        parsed = json.loads(raw_data)
                        yield f"data: {json.dumps(parsed)}\n\n"
                    except json.JSONDecodeError:
                        continue
