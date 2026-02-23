from unittest.mock import AsyncMock, patch

from django.test import RequestFactory, TestCase

from tracking import views


class StationPredictionsContractTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    async def test_station_id_is_required(self):
        request = self.factory.get("/tracking/predictions/")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 400)
        self.assertJSONEqual(
            response.content,
            {
                "error": {
                    "code": "invalid_query",
                    "message": "Query parameter 'station_id' is required.",
                    "details": {"parameter": "station_id"},
                }
            },
        )

    @patch("tracking.views.get_redis_client")
    async def test_unknown_station_returns_404(self, mock_get_client):
        redis_client = AsyncMock()
        redis_client.hget = AsyncMock(return_value=None)
        mock_get_client.return_value = redis_client

        request = self.factory.get("/tracking/predictions/?station_id=unknown")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 404)

    @patch("tracking.views.get_redis_client")
    @patch("tracking.views.read_station_predictions", new_callable=AsyncMock)
    @patch("tracking.views.read_latest_snapshot", new_callable=AsyncMock)
    async def test_valid_station_response_shape(
        self, mock_snapshot, mock_predictions, mock_get_client
    ):
        redis_client = AsyncMock()
        redis_client.hget = AsyncMock(return_value='{"station_id":"70080"}')
        mock_get_client.return_value = redis_client
        mock_predictions.return_value = [
            {
                "prediction_id": "p1",
                "route_id": "Red",
                "stop_id": "70080",
                "updated_at": "2026-02-22T12:00:00Z",
            }
        ]
        mock_snapshot.return_value = {"snapshot_at": "2026-02-22T12:00:00Z"}

        request = self.factory.get("/tracking/predictions/?station_id=70080")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(
            response.content,
            {
                "station_id": "70080",
                "predictions": [
                    {
                        "prediction_id": "p1",
                        "route_id": "Red",
                        "stop_id": "70080",
                        "updated_at": "2026-02-22T12:00:00Z",
                    }
                ],
                "last_updated": "2026-02-22T12:00:00Z",
            },
        )
