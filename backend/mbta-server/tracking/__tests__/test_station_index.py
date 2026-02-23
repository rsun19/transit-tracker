import asyncio
from django.test import TestCase

from tracking.station_index import refresh_station_index, search_station_ids_like


class _FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}

    async def set(self, key: str, value: str):
        self.kv[key] = value

    async def get(self, key: str):
        return self.kv.get(key)

    async def delete(self, *keys: str):
        for key in keys:
            self.kv.pop(key, None)
            self.hashes.pop(key, None)
            self.sets.pop(key, None)

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

    async def smembers(self, key: str):
        return self.sets.get(key, set())

    async def sadd(self, key: str, *members: str):
        if key not in self.sets:
            self.sets[key] = set()
        for member in members:
            self.sets[key].add(str(member))

    async def scan_iter(self, match: str):
        import fnmatch

        for key in self.kv.keys():
            if fnmatch.fnmatch(key, match):
                yield key


class StationIndexTests(TestCase):
    def test_like_search_is_case_insensitive(self):
        redis = _FakeRedis()
        rows = [
            {"id": "70080", "attributes": {"name": "South Station"}},
            {"id": "70075", "attributes": {"name": "Park Street"}},
        ]
        asyncio.run(refresh_station_index(redis, rows))

        matches = asyncio.run(search_station_ids_like(redis, "SoUtH"))

        self.assertEqual(matches, ["70080"])

    def test_like_search_respects_limit(self):
        redis = _FakeRedis()
        rows = [
            {"id": "70080", "attributes": {"name": "South Station"}},
            {"id": "70081", "attributes": {"name": "South Bay"}},
            {"id": "70082", "attributes": {"name": "South End"}},
        ]
        asyncio.run(refresh_station_index(redis, rows))

        matches = asyncio.run(search_station_ids_like(redis, "south", limit=2))

        self.assertEqual(len(matches), 2)
