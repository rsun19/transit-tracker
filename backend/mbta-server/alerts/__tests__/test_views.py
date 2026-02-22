from django.test import TestCase, RequestFactory
from unittest.mock import patch, Mock
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

    @patch("alerts.views.mbta_event_streamer")
    async def test_alerts_stream(self, mock_streamer):
        async def fake_generator():
            yield b"data: one\n\n"
            yield b"data: two\n\n"

        mock_streamer.return_value = fake_generator()

        request = self.factory.get("/alerts/stream")
        resp = await views.alerts_stream(request)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Cache-Control"], "no-cache")
        self.assertEqual(resp["X-Accel-Buffering"], "no")
        self.assertEqual(resp["Content-Type"], "text/event-stream")

        # Collect streaming content
        content = b""
        async for chunk in resp.streaming_content:
            content += chunk
        self.assertIn(b"data: one", content)
        self.assertIn(b"data: two", content)

    def test_health(self):
        request = self.factory.get("/health")
        resp = views.health(request)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"OK")
