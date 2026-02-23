import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from alerts.management.commands.import_static_transit_data import (
    _build_dataset_payload,
    _import_to_redis,
    _normalize_json_rows,
)


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.closed = False

    async def get(self, key: str):
        return self.kv.get(key)

    async def set(self, key: str, value: str):
        self.kv[key] = value

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

    async def delete(self, *keys: str):
        count = 0
        for key in keys:
            if key in self.kv:
                del self.kv[key]
                count += 1
            if key in self.hashes:
                del self.hashes[key]
                count += 1
            if key in self.sets:
                del self.sets[key]
                count += 1
        return count

    async def sadd(self, key: str, *members: str):
        if key not in self.sets:
            self.sets[key] = set()
        before = len(self.sets[key])
        for member in members:
            self.sets[key].add(str(member))
        return len(self.sets[key]) - before

    async def smembers(self, key: str):
        return self.sets.get(key, set())

    async def close(self):
        self.closed = True


class ImportStaticTransitDataTests(TestCase):
    def test_normalize_json_rows_handles_dict_data_list(self):
        payload = {
            "data": [
                {"id": "70083", "type": "stop"},
                {"id": "70084", "type": "stop"},
            ]
        }

        rows = _normalize_json_rows(payload)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], "70083")

    def test_build_dataset_payload_from_csv(self):
        with TemporaryDirectory() as tmp:
            file_path = Path(tmp) / "routes.csv"
            file_path.write_text(
                "route_id,name\nRed,Red Line\nOrange,Orange Line\n", encoding="utf-8"
            )

            payload = _build_dataset_payload(file_path)

            self.assertEqual(payload.dataset, "routes")
            self.assertEqual(payload.row_count, 2)
            self.assertIn("Red", payload.rows_mapping)
            parsed = json.loads(payload.payload_json)
            self.assertEqual(parsed[1]["name"], "Orange Line")

    def test_build_dataset_payload_from_json_with_utf8_bom(self):
        with TemporaryDirectory() as tmp:
            file_path = Path(tmp) / "rapid_transit_routes.json"
            file_path.write_text(
                json.dumps({"data": [{"id": "Red", "type": "route"}]}),
                encoding="utf-8-sig",
            )

            payload = _build_dataset_payload(file_path)

            self.assertEqual(payload.dataset, "rapid_transit_routes")
            self.assertEqual(payload.row_count, 1)
            self.assertIn("Red", payload.rows_mapping)

    def test_import_to_redis_sets_current_version_after_ingest(self):
        redis = FakeRedis()

        with TemporaryDirectory() as tmp:
            static_dir = Path(tmp)
            (static_dir / "rapid_transit_routes.json").write_text(
                json.dumps(
                    {
                        "data": [
                            {"id": "Red", "type": "route"},
                            {"id": "Blue", "type": "route"},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            with patch(
                "alerts.management.commands.import_static_transit_data.get_redis_client",
                return_value=redis,
            ):
                imported = asyncio.run(
                    _import_to_redis(
                        version="v2026Q1",
                        static_dir=static_dir,
                        namespace="mbta:static:transit",
                        delete_previous=False,
                    )
                )

        self.assertEqual(len(imported), 1)
        self.assertEqual(redis.kv["mbta:static:transit:current_version"], "v2026Q1")
        self.assertEqual(
            redis.kv["mbta:static:transit:rapid_transit_routes:current_version"],
            "v2026Q1",
        )
        self.assertIn("mbta:static:transit:v2026Q1:rapid_transit_routes:rows", redis.hashes)
        self.assertTrue(redis.closed)

    def test_import_to_redis_can_delete_previous_version(self):
        redis = FakeRedis()
        redis.kv["mbta:static:transit:current_version"] = "v2025Q4"
        redis.sets["mbta:static:transit:v2025Q4:datasets"] = {"rapid_transit_routes"}
        redis.kv["mbta:static:transit:v2025Q4:rapid_transit_routes:payload"] = "old"
        redis.hashes["mbta:static:transit:v2025Q4:rapid_transit_routes:rows"] = {
            "Red": "old"
        }

        with TemporaryDirectory() as tmp:
            static_dir = Path(tmp)
            (static_dir / "rapid_transit_routes.json").write_text(
                json.dumps({"data": [{"id": "Red", "type": "route"}]}),
                encoding="utf-8",
            )

            with patch(
                "alerts.management.commands.import_static_transit_data.get_redis_client",
                return_value=redis,
            ):
                asyncio.run(
                    _import_to_redis(
                        version="v2026Q1",
                        static_dir=static_dir,
                        namespace="mbta:static:transit",
                        delete_previous=True,
                    )
                )

        self.assertNotIn("mbta:static:transit:v2025Q4:datasets", redis.sets)
        self.assertNotIn(
            "mbta:static:transit:v2025Q4:rapid_transit_routes:payload",
            redis.kv,
        )
        self.assertNotIn(
            "mbta:static:transit:v2025Q4:rapid_transit_routes:rows",
            redis.hashes,
        )
