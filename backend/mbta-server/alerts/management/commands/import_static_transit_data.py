import asyncio
import csv
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from alerts.redis_client import get_redis_client


SUPPORTED_SUFFIXES = {".csv", ".json"}
DEFAULT_NAMESPACE = "mbta:static:transit"


@dataclass(frozen=True)
class DatasetPayload:
    dataset: str
    row_count: int
    rows_mapping: dict[str, str]
    payload_json: str
    source_file: str


def _backend_dir() -> Path:
    return Path(__file__).resolve().parents[4]


def _default_static_dir() -> Path:
    return _backend_dir() / "static"


def _dataset_name(path: Path) -> str:
    return path.stem.strip().lower().replace(" ", "_")


def _normalize_json_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            return [data]
        return [payload]

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    raise CommandError("JSON file must contain an object or list of objects")


def _read_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        if path.suffix.lower() == ".csv":
            return [dict(row) for row in csv.DictReader(fh)]

        payload = json.load(fh)
        return _normalize_json_rows(payload)


def _row_identifier(row: dict[str, Any], index: int) -> str:
    row_id = row.get("id")
    if row_id is not None:
        return str(row_id)

    attributes = row.get("attributes")
    if isinstance(attributes, dict):
        attribute_id = attributes.get("id")
        if attribute_id is not None:
            return str(attribute_id)

    for candidate_key in ("stop_id", "route_id", "name"):
        candidate = row.get(candidate_key)
        if candidate is not None:
            return str(candidate)

    return f"row:{index}"


def _build_dataset_payload(path: Path) -> DatasetPayload:
    rows = _read_rows(path)
    rows_mapping: dict[str, str] = {}
    for index, row in enumerate(rows):
        key = _row_identifier(row, index)
        rows_mapping[key] = json.dumps(row, separators=(",", ":"), sort_keys=True)

    payload_json = json.dumps(rows, separators=(",", ":"), sort_keys=True)
    return DatasetPayload(
        dataset=_dataset_name(path),
        row_count=len(rows),
        rows_mapping=rows_mapping,
        payload_json=payload_json,
        source_file=path.name,
    )


def _find_supported_files(static_dir: Path) -> list[Path]:
    if not static_dir.exists() or not static_dir.is_dir():
        raise CommandError(f"Static directory does not exist: {static_dir}")

    files = [
        path
        for path in static_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    ]
    return sorted(files)


async def _import_to_redis(
    *,
    version: str,
    static_dir: Path,
    namespace: str,
    delete_previous: bool,
) -> list[DatasetPayload]:
    redis_client = get_redis_client()
    imported: list[DatasetPayload] = []
    current_version_key = f"{namespace}:current_version"

    try:
        previous_version = await redis_client.get(current_version_key)
        if isinstance(previous_version, bytes):
            previous_version = previous_version.decode("utf-8")

        files = _find_supported_files(static_dir)
        if not files:
            raise CommandError(f"No CSV or JSON files found in {static_dir}")

        for path in files:
            payload = _build_dataset_payload(path)
            imported.append(payload)

            dataset_payload_key = f"{namespace}:{version}:{payload.dataset}:payload"
            dataset_rows_key = f"{namespace}:{version}:{payload.dataset}:rows"
            dataset_meta_key = f"{namespace}:{version}:{payload.dataset}:meta"

            await redis_client.delete(dataset_payload_key, dataset_rows_key, dataset_meta_key)
            await redis_client.set(dataset_payload_key, payload.payload_json)
            if payload.rows_mapping:
                await redis_client.hset(dataset_rows_key, mapping=payload.rows_mapping)

            await redis_client.hset(
                dataset_meta_key,
                mapping={
                    "dataset": payload.dataset,
                    "source_file": payload.source_file,
                    "row_count": str(payload.row_count),
                    "imported_at": datetime.now(UTC).isoformat(),
                    "version": version,
                },
            )

            await redis_client.sadd(f"{namespace}:{version}:datasets", payload.dataset)

        await redis_client.set(current_version_key, version)
        for payload in imported:
            await redis_client.set(f"{namespace}:{payload.dataset}:current_version", version)

        if (
            delete_previous
            and previous_version
            and previous_version != version
            and isinstance(previous_version, str)
        ):
            datasets_key = f"{namespace}:{previous_version}:datasets"
            previous_datasets = await redis_client.smembers(datasets_key)
            previous_dataset_names: list[str] = []
            for item in previous_datasets:
                if isinstance(item, bytes):
                    previous_dataset_names.append(item.decode("utf-8"))
                elif isinstance(item, str):
                    previous_dataset_names.append(item)

            keys_to_delete = [datasets_key]
            for dataset in previous_dataset_names:
                keys_to_delete.extend(
                    [
                        f"{namespace}:{previous_version}:{dataset}:payload",
                        f"{namespace}:{previous_version}:{dataset}:rows",
                        f"{namespace}:{previous_version}:{dataset}:meta",
                    ]
                )

            if keys_to_delete:
                await redis_client.delete(*keys_to_delete)

        return imported
    finally:
        await redis_client.close()


class Command(BaseCommand):
    help = "Import CSV/JSON transit static files into versioned Redis cache keys."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--data-version",
            required=True,
            help="Version label for imported keys (for example v2026Q1).",
        )
        parser.add_argument(
            "--static-dir",
            default=str(_default_static_dir()),
            help="Directory containing CSV/JSON files to ingest.",
        )
        parser.add_argument(
            "--namespace",
            default=DEFAULT_NAMESPACE,
            help="Redis key namespace prefix.",
        )
        parser.add_argument(
            "--delete-previous",
            action="store_true",
            help="Delete previous version keys after successful version swap.",
        )

    def handle(self, *args: Any, **options: Any) -> None:  # type: ignore[override]
        version: str = options["data_version"].strip()
        namespace: str = options["namespace"].strip()
        static_dir = Path(options["static_dir"]).expanduser().resolve()
        delete_previous = bool(options["delete_previous"])

        if not version:
            raise CommandError("--data-version cannot be empty")
        if not namespace:
            raise CommandError("--namespace cannot be empty")

        imported = asyncio.run(
            _import_to_redis(
                version=version,
                static_dir=static_dir,
                namespace=namespace,
                delete_previous=delete_previous,
            )
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Imported static transit datasets: "
                + ", ".join(
                    f"{item.dataset} ({item.row_count} rows)" for item in imported
                )
                + f" | current_version={version}"
            )
        )
