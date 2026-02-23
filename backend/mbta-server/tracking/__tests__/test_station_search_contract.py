from unittest.mock import AsyncMock, patch

from django.test import RequestFactory, TestCase

from tracking import views


class StationSearchContractTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    async def test_requires_q_parameter(self):
        request = self.factory.get("/tracking/stations/")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 400)
        self.assertJSONEqual(
            response.content,
            {
                "error": {
                    "code": "invalid_query",
                    "message": "Query parameter 'q' is required.",
                    "details": {"parameter": "q"},
                }
            },
        )

    async def test_rejects_invalid_limit(self):
        request = self.factory.get("/tracking/stations/?q=south&limit=bad")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 400)

    async def test_rejects_out_of_range_limit(self):
        request = self.factory.get("/tracking/stations/?q=south&limit=500")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 400)

    @patch("tracking.views.get_redis_client")
    @patch("tracking.views.search_stations_in_cache", new_callable=AsyncMock)
    async def test_valid_request_returns_stations(self, mock_search, mock_get_client):
        mock_redis = AsyncMock()
        mock_get_client.return_value = mock_redis
        mock_search.return_value = [
            {
                "station_id": "70080",
                "station_name": "South Station",
                "municipality": "Boston",
            }
        ]

        request = self.factory.get("/tracking/stations/?q=south&limit=5")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(
            response.content,
            {
                "stations": [
                    {
                        "station_id": "70080",
                        "station_name": "South Station",
                        "municipality": "Boston",
                    }
                ]
            },
        )
