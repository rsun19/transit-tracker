import asyncio
from django.test import TestCase

from tracking.prediction_cache import (
    read_station_predictions,
    write_prediction_snapshot,
)


class _FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}

    async def set(self, key: str, value: str):
        self.kv[key] = value

    async def get(self, key: str):
        return self.kv.get(key)


class PredictionCacheTests(TestCase):
    def test_read_station_predictions_returns_sorted_projection(self):
        redis = _FakeRedis()
        predictions = [
            {
                "prediction_id": "p2",
                "route_id": "Red",
                "stop_id": "70080",
                "arrival_time": "2026-02-22T12:03:00Z",
                "updated_at": "2026-02-22T12:00:00Z",
            },
            {
                "prediction_id": "p1",
                "route_id": "Red",
                "stop_id": "70080",
                "arrival_time": "2026-02-22T12:01:00Z",
                "updated_at": "2026-02-22T12:00:00Z",
            },
            {
                "prediction_id": "p3",
                "route_id": "Orange",
                "stop_id": "70075",
                "arrival_time": "2026-02-22T12:00:00Z",
                "updated_at": "2026-02-22T12:00:00Z",
            },
        ]
        asyncio.run(write_prediction_snapshot(redis, predictions))

        rows = asyncio.run(read_station_predictions(redis, "70080"))

        self.assertEqual([row["prediction_id"] for row in rows], ["p1", "p2"])
        self.assertTrue(all("stop_id" in row and "route_id" in row for row in rows))
