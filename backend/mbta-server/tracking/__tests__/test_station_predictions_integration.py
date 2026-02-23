import json

from unittest.mock import patch

from django.test import RequestFactory, TestCase

from tracking import views


class _FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}

    async def close(self):
        return None

    async def get(self, key: str):
        return self.kv.get(key)

    async def set(self, key: str, value: str):
        self.kv[key] = value

    async def hget(self, key: str, field: str):
        return self.hashes.get(key, {}).get(field)

    async def hset(self, key: str, field: str, value: str):
        if key not in self.hashes:
            self.hashes[key] = {}
        self.hashes[key][field] = value


class StationPredictionsIntegrationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("tracking.views.get_redis_client")
    async def test_station_predictions_returns_filtered_rows(self, mock_get_client):
        redis = _FakeRedis()
        redis.hashes["mbta:tracking:station:rows"] = {
            "70080": json.dumps(
                {"station_id": "70080", "station_name": "South Station"}
            )
        }
        redis.kv["mbta:tracking:predictions:by_stop:70080"] = json.dumps(
            [
                {
                    "prediction_id": "p2",
                    "route_id": "Red",
                    "stop_id": "70080",
                    "arrival_time": "2026-02-22T12:02:00Z",
                    "updated_at": "2026-02-22T12:00:00Z",
                },
                {
                    "prediction_id": "p1",
                    "route_id": "Red",
                    "stop_id": "70080",
                    "arrival_time": "2026-02-22T12:01:00Z",
                    "updated_at": "2026-02-22T12:00:00Z",
                },
            ]
        )
        redis.kv["mbta:tracking:predictions:latest_snapshot"] = json.dumps(
            {"records": [], "snapshot_at": "2026-02-22T12:00:00Z", "route_count": 1}
        )
        mock_get_client.return_value = redis

        request = self.factory.get("/tracking/predictions/?station_id=70080")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["station_id"], "70080")
        self.assertEqual(
            [row["prediction_id"] for row in payload["predictions"]], ["p1", "p2"]
        )
        self.assertEqual(payload["last_updated"], "2026-02-22T12:00:00Z")

    @patch("tracking.views.get_redis_client")
    async def test_station_predictions_empty_list_when_no_predictions(
        self, mock_get_client
    ):
        redis = _FakeRedis()
        redis.hashes["mbta:tracking:station:rows"] = {
            "70080": json.dumps(
                {"station_id": "70080", "station_name": "South Station"}
            )
        }
        redis.kv["mbta:tracking:predictions:by_stop:70080"] = json.dumps([])
        redis.kv["mbta:tracking:predictions:latest_snapshot"] = json.dumps(
            {"records": [], "snapshot_at": "2026-02-22T12:00:00Z", "route_count": 0}
        )
        mock_get_client.return_value = redis

        request = self.factory.get("/tracking/predictions/?station_id=70080")
        response = await views.station_predictions(request)

        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(
            response.content,
            {
                "station_id": "70080",
                "predictions": [],
                "last_updated": "2026-02-22T12:00:00Z",
            },
        )
