import httpx
import json

from .const import MBTA_STREAMING_ALERTS_URL, MBTA_KEY


async def mbta_stream_events():
    """Yield parsed MBTA SSE events as ``(event_type, payload)`` tuples."""

    headers = {"Accept": "text/event-stream"}
    url = MBTA_STREAMING_ALERTS_URL
    if MBTA_KEY:
        url = f"{url}&api_key={MBTA_KEY}"

    async with httpx.AsyncClient(timeout=None, http2=True) as client:
        async with client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()

            event_type = "message"
            data_lines: list[str] = []

            async for raw_line in response.aiter_lines():
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line

                if line == "":
                    if data_lines:
                        raw_data = "\n".join(data_lines).strip()
                        try:
                            payload = json.loads(raw_data)
                            yield event_type, payload
                        except json.JSONDecodeError:
                            pass

                    event_type = "message"
                    data_lines = []
                    continue

                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event_type = line.replace("event:", "", 1).strip() or "message"
                    continue
                if line.startswith("data:"):
                    data_part = line.replace("data:", "", 1).lstrip()

                    # Backward-compatible path for single-line message events
                    # that are not terminated with a blank line in tests/mocks.
                    if event_type == "message":
                        try:
                            payload = json.loads(data_part)
                            yield event_type, payload
                            data_lines = []
                            continue
                        except json.JSONDecodeError:
                            pass

                    data_lines.append(data_part)

            if data_lines:
                raw_data = "\n".join(data_lines).strip()
                try:
                    payload = json.loads(raw_data)
                    yield event_type, payload
                except json.JSONDecodeError:
                    pass


async def mbta_event_streamer():
    """
    Stream MBTA alerts using Server-Sent Events (SSE) asynchronously.
    Yields properly formatted SSE event bytes (terminated by a blank line).
    """
    async for _event_type, payload in mbta_stream_events():
        yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
