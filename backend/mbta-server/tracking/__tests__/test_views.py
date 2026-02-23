import json

from unittest.mock import AsyncMock, patch

from django.test import RequestFactory, TestCase

from tracking import views


class TrackingViewsConsistencyTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    async def test_search_error_envelope_shape(self):
        request = self.factory.get("/tracking/stations/")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 400)
        payload = json.loads(response.content)
        self.assertIn("error", payload)
        self.assertIn("code", payload["error"])
        self.assertIn("message", payload["error"])
        self.assertIn("details", payload["error"])

    async def test_predictions_error_envelope_shape(self):
        request = self.factory.get("/tracking/predictions/")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 400)
        payload = json.loads(response.content)
        self.assertIn("error", payload)
        self.assertIn("code", payload["error"])
        self.assertIn("message", payload["error"])
        self.assertIn("details", payload["error"])

    @patch("tracking.views.get_redis_client")
    async def test_predictions_not_found_error_envelope_shape(self, mock_get_client):
        redis_client = AsyncMock()
        redis_client.hget = AsyncMock(return_value=None)
        mock_get_client.return_value = redis_client

        request = self.factory.get("/tracking/predictions/?station_id=missing")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 404)
        payload = json.loads(response.content)
        self.assertIn("error", payload)
        self.assertEqual(payload["error"]["code"], "station_not_found")

    @patch("tracking.views.get_redis_client")
    @patch("tracking.views.get_rapid_transit_routes")
    async def test_available_route_ids_returns_routes(
        self, mock_get_routes, mock_get_client
    ):
        redis_client = AsyncMock()
        mock_get_client.return_value = redis_client
        mock_get_routes.return_value = [
            {"route_id": "Blue", "long_name": "Blue Line"},
            {"route_id": "Orange", "long_name": "Orange Line"},
            {"route_id": "Red", "long_name": "Red Line"},
        ]

        request = self.factory.get("/tracking/routes/")
        response = await views.available_route_ids(request)

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(
            payload["routes"],
            [
                {"route_id": "Blue", "long_name": "Blue Line"},
                {"route_id": "Orange", "long_name": "Orange Line"},
                {"route_id": "Red", "long_name": "Red Line"},
            ],
        )
