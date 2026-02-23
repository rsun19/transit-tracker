from django.test import RequestFactory, TestCase
from unittest.mock import patch

from tracking import views


class TrackingStreamIntegrationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("tracking.views.redis_channel_sse_stream")
    async def test_tracking_stream_yields_data(self, mock_stream):
        async def fake_stream(*_args, **_kwargs):
            yield b'data: [{"prediction_id":"p1"}]\n\n'
            yield b": heartbeat\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/tracking/stream/")
        response = await views.tracking_stream(request)

        collected = b""
        async for chunk in response.streaming_content:
            collected += chunk
            if b"prediction_id" in collected and b"heartbeat" in collected:
                break

        self.assertIn(b"prediction_id", collected)
        self.assertIn(b"heartbeat", collected)
