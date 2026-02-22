import json
from django.test import SimpleTestCase
from unittest.mock import patch

from alerts.mbta_event_streamer import mbta_event_streamer


class StreamerTest(SimpleTestCase):
    def test_mbta_event_streamer_parses_and_yields_events(self):
        # Prepare a sequence of raw lines as might be returned by response.iter_lines()
        raw_lines = [
            b'data: {"a":1}',
            b"some: ignore",
            b"",
            'data: {"c": 3}',
            b"data: invalid json",
            b'data: {"b":2}',
        ]

        class FakeResponse:
            def iter_lines(self):
                for l in raw_lines:
                    yield l

        class FakeStreamCtx:
            def __init__(self, resp):
                self._resp = resp

            def __enter__(self):
                return self._resp

            def __exit__(self, exc_type, exc, tb):
                return False

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def stream(self, *args, **kwargs):
                return FakeStreamCtx(FakeResponse())

        with patch(
            "alerts.mbta_event_streamer.httpx.Client", return_value=FakeClient()
        ):
            gen = mbta_event_streamer()
            events = list(gen)

        # We expect three valid JSON events yielded (a, c and b)
        self.assertEqual(len(events), 3)

        parsed = [json.loads(e.replace("data:", "").strip()) for e in events]
        # Order should match input: a, c, b
        self.assertEqual(parsed[0], {"a": 1})
        self.assertEqual(parsed[1], {"c": 3})
        self.assertEqual(parsed[2], {"b": 2})
