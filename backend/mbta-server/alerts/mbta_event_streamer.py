import httpx
import json
from .const import MBTA_STREAMING_ALERTS_URL, MBTA_KEY


import asyncio

async def mbta_event_streamer():
    """
    Stream MBTA alerts using Server-Sent Events (SSE) asynchronously.
    Yields properly formatted SSE event strings (terminated by a blank line).
    """
    headers = {"Authorization": f"Bearer {MBTA_KEY}"}
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "GET", MBTA_STREAMING_ALERTS_URL, headers=headers
        ) as response:
            async for raw_line in response.aiter_lines():
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
