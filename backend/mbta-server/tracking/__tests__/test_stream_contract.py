from django.test import RequestFactory, TestCase
from unittest.mock import patch

from tracking import views


class TrackingStreamContractTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("tracking.views.redis_channel_sse_stream")
    async def test_tracking_stream_contract_headers(self, mock_stream):
        async def fake_stream():
            yield b"data: []\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/tracking/stream/")
        response = await views.tracking_stream(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-cache")
        self.assertEqual(response["X-Accel-Buffering"], "no")
        self.assertEqual(response["Content-Type"], "text/event-stream")

    @patch("tracking.views.redis_channel_sse_stream")
    async def test_tracking_stream_filters_by_route_id_query(self, mock_stream):
        async def fake_stream():
            yield b"data: []\n\n"

        mock_stream.return_value = fake_stream()

        request = self.factory.get("/tracking/stream/?route_id=Red")
        await views.tracking_stream(request)

        transform = mock_stream.call_args.kwargs["payload_transform"]
        rows = transform(
            {
                "records": [
                    {"prediction_id": "1", "route_id": "Red"},
                    {"prediction_id": "2", "route_id": "Orange"},
                ]
            }
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["route_id"], "Red")
