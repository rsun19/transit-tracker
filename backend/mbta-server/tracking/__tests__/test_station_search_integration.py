from django.test import RequestFactory, TestCase
from unittest.mock import patch

from tracking import views
from tracking.station_index import refresh_station_index


class _FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}

    async def close(self):
        return None

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

    async def hget(self, key: str, field: str):
        return self.hashes.get(key, {}).get(field)

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


class StationSearchIntegrationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("tracking.views.get_redis_client")
    async def test_partial_case_insensitive_search_returns_match(self, mock_get_client):
        fake_redis = _FakeRedis()
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
        await refresh_station_index(fake_redis, rows)
        mock_get_client.return_value = fake_redis

        request = self.factory.get("/tracking/stations/?q=SoUtH")
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

    @patch("tracking.views.get_redis_client")
    async def test_search_no_matches_returns_empty_list(self, mock_get_client):
        fake_redis = _FakeRedis()
        rows = [
            {
                "id": "70075",
                "attributes": {"name": "Park Street", "municipality": "Boston"},
            }
        ]
        await refresh_station_index(fake_redis, rows)
        mock_get_client.return_value = fake_redis

        request = self.factory.get("/tracking/stations/?q=south")
        response = await views.search_stations(request)

        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"stations": []})
