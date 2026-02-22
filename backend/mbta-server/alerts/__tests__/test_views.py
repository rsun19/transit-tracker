from django.test import TestCase, RequestFactory
from unittest.mock import Mock, patch
import requests

from alerts import views


class ViewsTestCase(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("alerts.views.requests.get")
    def test_index_success(self, mock_get):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"alerts": []}
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response

        request = self.factory.get("/alerts")
        resp = views.index(request)

        self.assertEqual(resp.status_code, 200)
        self.assertJSONEqual(resp.content, {"alerts": []})

    @patch("alerts.views.requests.get")
    def test_index_failure(self, mock_get):
        mock_get.side_effect = requests.exceptions.RequestException("boom")

        request = self.factory.get("/alerts")
        resp = views.index(request)

        self.assertEqual(resp.status_code, 500)
        self.assertIn(b"Failed to fetch MBTA alerts", resp.content)

    @patch("alerts.views.redis_channel_sse_stream")
    async def test_alerts_stream_uses_broker_events(self, mock_stream):
        async def fake_stream(*args, **kwargs):
            yield b'data: {"id": "a1", "type": "alert"}\n\n'
            yield b'data: {"id": "a2", "type": "alert"}\n\n'

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/alerts/stream")
        resp = await views.alerts_stream(request)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Cache-Control"], "no-cache")
        self.assertEqual(resp["X-Accel-Buffering"], "no")
        self.assertEqual(resp["Content-Type"], "text/event-stream")

        # Collect a finite amount of streaming content
        collected = b""
        async for chunk in resp.streaming_content:
            collected += chunk
            if b"a1" in collected and b"a2" in collected:
                break

        self.assertIn(b"data:", collected)
        self.assertIn(b"\"id\": \"a1\"", collected)
        self.assertIn(b"\"id\": \"a2\"", collected)

    @patch("alerts.views.redis_channel_sse_stream")
    async def test_alerts_stream_filters_by_route_ids_query(self, mock_stream):
        async def fake_stream(*args, **kwargs):
            yield b"data: []\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/alerts/stream?route_ids=Orange,Red")
        await views.alerts_stream(request)

        transform = mock_stream.call_args.kwargs["payload_transform"]
        payload = {
            "id": "x1",
            "type": "alert",
            "attributes": {
                "active_period": [{"start": "2025-01-01T00:00:00Z", "end": None}],
                "cause": "UNKNOWN_CAUSE",
                "effect": "STATION_ISSUE",
                "header": "Sample",
                "description": "Sample desc",
                "url": "MBTA.com/sample",
                "lifecycle": "ONGOING",
                "informed_entity": [{"route": "Orange"}, {"route": "Blue"}],
            },
        }

        rows = transform(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["route"], "Orange")

    @patch("alerts.views.redis_channel_sse_stream")
    async def test_alerts_stream_filters_with_repeated_query_params(self, mock_stream):
        async def fake_stream(*args, **kwargs):
            yield b"data: []\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/alerts/stream?route_ids=Orange&route_ids=Red")
        await views.alerts_stream(request)

        transform = mock_stream.call_args.kwargs["payload_transform"]
        payload = [
            {
                "id": "x1",
                "type": "alert",
                "attributes": {
                    "active_period": [{"start": "2025-01-01T00:00:00Z", "end": None}],
                    "cause": "UNKNOWN_CAUSE",
                    "effect": "STATION_ISSUE",
                    "header": "Sample",
                    "description": "Sample desc",
                    "url": "MBTA.com/sample",
                    "lifecycle": "ONGOING",
                    "informed_entity": [{"route": "Orange"}, {"route": "Blue"}],
                },
            },
            {
                "id": "x2",
                "type": "alert",
                "attributes": {
                    "active_period": [{"start": "2025-01-01T00:00:00Z", "end": None}],
                    "cause": "UNKNOWN_CAUSE",
                    "effect": "STATION_ISSUE",
                    "header": "Sample 2",
                    "description": "Sample desc 2",
                    "url": "MBTA.com/sample2",
                    "lifecycle": "ONGOING",
                    "informed_entity": [{"route": "Red"}],
                },
            },
        ]

        rows = transform(payload)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["route"] for row in rows}, {"Orange", "Red"})

    @patch("alerts.views.redis_channel_sse_stream")
    async def test_alerts_stream_filters_with_routes_alias(self, mock_stream):
        async def fake_stream(*args, **kwargs):
            yield b"data: []\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/alerts/stream?routes=Blue")
        await views.alerts_stream(request)

        transform = mock_stream.call_args.kwargs["payload_transform"]
        payload = {
            "id": "x3",
            "type": "alert",
            "attributes": {
                "active_period": [{"start": "2025-01-01T00:00:00Z", "end": None}],
                "cause": "UNKNOWN_CAUSE",
                "effect": "STATION_ISSUE",
                "header": "Blue line alert",
                "description": "Blue sample",
                "url": "MBTA.com/blue",
                "lifecycle": "ONGOING",
                "informed_entity": [{"route": "Blue"}, {"route": "Orange"}],
            },
        }

        rows = transform(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["route"], "Blue")

    def test_health(self):
        request = self.factory.get("/health")
        resp = views.health(request)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"OK")
