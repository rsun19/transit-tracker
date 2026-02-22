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

    def test_health(self):
        request = self.factory.get("/health")
        resp = views.health(request)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"OK")
