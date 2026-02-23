import asyncio
import json
from unittest import TestCase

from tracking import prediction_cache, static_dataset, station_index


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}

    async def get(self, key: str):
        return self.kv.get(key)

    async def set(self, key: str, value: str):
        self.kv[key] = value

    async def delete(self, *keys: str):
        for key in keys:
            self.kv.pop(key, None)
            self.hashes.pop(key, None)
            self.sets.pop(key, None)

    async def hgetall(self, key: str):
        return self.hashes.get(key, {})

    async def hset(self, key: str, *args, mapping=None):
        if key not in self.hashes:
            self.hashes[key] = {}

        if mapping is not None:
            for field, value in mapping.items():
                self.hashes[key][str(field)] = str(value)
            return len(mapping)

        if len(args) == 2:
            field, value = args
            self.hashes[key][str(field)] = str(value)
            return 1

        raise AssertionError("Unexpected hset arguments")

    async def hget(self, key: str, field: str):
        return self.hashes.get(key, {}).get(field)

    async def sadd(self, key: str, *members: str):
        if key not in self.sets:
            self.sets[key] = set()
        for member in members:
            self.sets[key].add(str(member))

    async def smembers(self, key: str):
        return self.sets.get(key, set())

    async def scan_iter(self, match: str):
        import fnmatch

        for key in self.kv.keys():
            if fnmatch.fnmatch(key, match):
                yield key


class FoundationTests(TestCase):
    def test_static_dataset_reads_versioned_rows(self):
        redis = FakeRedis()
        redis.kv["mbta:static:transit:rapid_transit_routes:current_version"] = "v2026Q1"
        redis.hashes["mbta:static:transit:v2026Q1:rapid_transit_routes:rows"] = {
            "Red": json.dumps(
                {
                    "id": "Red",
                    "type": "route",
                    "attributes": {"long_name": "Red Line"},
                }
            ),
            "Orange": json.dumps(
                {
                    "id": "Orange",
                    "type": "route",
                    "attributes": {"long_name": "Orange Line"},
                }
            ),
            "Green-C": json.dumps(
                {
                    "id": "Green-C",
                    "type": "route",
                    "attributes": {"long_name": "A Line"},
                }
            ),
        }

        route_ids = asyncio.run(static_dataset.get_rapid_transit_route_ids(redis))
        routes = asyncio.run(static_dataset.get_rapid_transit_routes(redis))

        self.assertEqual(route_ids, ["Green-C", "Orange", "Red"])
        self.assertEqual(
            routes,
            [
                {"route_id": "Green-C", "long_name": "A Line"},
                {"route_id": "Orange", "long_name": "Orange Line"},
                {"route_id": "Red", "long_name": "Red Line"},
            ],
        )

    def test_station_index_refresh_and_like_search(self):
        redis = FakeRedis()
        rows = [
            {
                "id": "70080",
                "attributes": {"name": "South Station", "municipality": "Boston"},
            },
            {
                "id": "70075",
                "attributes": {"name": "Park Street", "municipality": "Boston"},
            },
        ]

        indexed_count = asyncio.run(station_index.refresh_station_index(redis, rows))
        matches = asyncio.run(station_index.search_stations(redis, "south"))

        self.assertEqual(indexed_count, 2)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["station_id"], "70080")
        self.assertEqual(matches[0]["station_name"], "South Station")

    def test_prediction_cache_snapshot_and_stop_lookup(self):
        redis = FakeRedis()
        predictions = [
            {
                "prediction_id": "p1",
                "route_id": "Red",
                "stop_id": "70080",
                "arrival_time": "2026-02-22T12:00:00Z",
            },
            {
                "prediction_id": "p2",
                "route_id": "Red",
                "stop_id": "70080",
                "arrival_time": "2026-02-22T12:03:00Z",
            },
            {
                "prediction_id": "p3",
                "route_id": "Orange",
                "stop_id": "70075",
                "arrival_time": "2026-02-22T12:05:00Z",
            },
        ]

        stats = asyncio.run(
            prediction_cache.write_prediction_snapshot(redis, predictions)
        )
        latest = asyncio.run(prediction_cache.read_latest_snapshot(redis))
        by_stop = asyncio.run(prediction_cache.read_predictions_by_stop(redis, "70080"))

        self.assertEqual(stats["record_count"], 3)
        self.assertEqual(stats["route_count"], 2)
        self.assertEqual(stats["stop_count"], 2)
        self.assertEqual(len(latest["records"]), 3)
        self.assertEqual(len(by_stop), 2)

    def test_normalize_station_name(self):
        self.assertEqual(
            station_index.normalize_station_name("  South   Station! "), "south station"
        )
