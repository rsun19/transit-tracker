import json
from django.test import SimpleTestCase
from unittest.mock import patch

from alerts.mbta_event_streamer import mbta_event_streamer


class StreamerTest(SimpleTestCase):
    async def test_mbta_event_streamer_parses_and_yields_events(self):
        # Prepare a sequence of raw lines as might be returned by response.aiter_lines()
        raw_lines = [
            b'data: {"a":1}',
            b"some: ignore",
            b"",
            'data: {"c": 3}',
            b"data: invalid json",
            b'data: {"b":2}',
        ]

        class FakeResponse:
            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                for line in raw_lines:
                    yield line

        class FakeStreamCtx:
            def __init__(self, resp):
                self._resp = resp

            async def __aenter__(self):
                return self._resp

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            def stream(self, *args, **kwargs):
                return FakeStreamCtx(FakeResponse())

        with patch(
            "alerts.mbta_event_streamer.httpx.AsyncClient", return_value=FakeClient()
        ):
            gen = mbta_event_streamer()
            events = []
            async for e in gen:
                events.append(e)

        # We expect three valid JSON events yielded (a, c and b)
        self.assertEqual(len(events), 3)

        parsed = [json.loads(e.decode("utf-8").replace("data:", "").strip()) for e in events]
        # Order should match input: a, c, b
        self.assertEqual(parsed[0], {"a": 1})
        self.assertEqual(parsed[1], {"c": 3})
        self.assertEqual(parsed[2], {"b": 2})

    async def test_mbta_event_streamer_appends_api_key(self):
        class FakeResponse:
            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                if False:
                    yield b""  # pragma: no cover

        class FakeStreamCtx:
            def __init__(self, resp):
                self._resp = resp

            async def __aenter__(self):
                return self._resp

            async def __aexit__(self, exc_type, exc, tb):
                return False

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            def stream(self, method, url, headers=None):
                assert "api_key=" in url
                return FakeStreamCtx(FakeResponse())

        with patch(
            "alerts.mbta_event_streamer.httpx.AsyncClient", return_value=FakeClient()
        ):
            gen = mbta_event_streamer()
            events = []
            async for e in gen:
                events.append(e)

        self.assertEqual(events, [])
