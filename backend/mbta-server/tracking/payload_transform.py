from typing import Any


def _relationship_id(resource: dict[str, Any], relation: str) -> str | None:
    relationships = resource.get("relationships")
    if not isinstance(relationships, dict):
        return None

    relation_payload = relationships.get(relation)
    if not isinstance(relation_payload, dict):
        return None

    relation_data = relation_payload.get("data")
    if not isinstance(relation_data, dict):
        return None

    relation_id = relation_data.get("id")
    return str(relation_id) if relation_id is not None else None


def normalize_prediction_for_client(resource: dict[str, Any]) -> dict[str, Any] | None:
    prediction_id = resource.get("id")
    attributes = resource.get("attributes")
    route_id = _relationship_id(resource, "route")
    stop_id = _relationship_id(resource, "stop")

    if (
        prediction_id is None
        or not isinstance(attributes, dict)
        or not route_id
        or not stop_id
    ):
        return None

    return {
        "prediction_id": str(prediction_id),
        "route_id": route_id,
        "stop_id": stop_id,
        "trip_id": _relationship_id(resource, "trip"),
        "direction_id": attributes.get("direction_id"),
        "arrival_time": attributes.get("arrival_time"),
        "departure_time": attributes.get("departure_time"),
        "stop_sequence": attributes.get("stop_sequence"),
        "status": attributes.get("status"),
        "updated_at": attributes.get("updated_at"),
    }


def transform_predictions_for_client(
    resources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for resource in resources:
        normalized = normalize_prediction_for_client(resource)
        if not normalized:
            continue

        prediction_id = normalized["prediction_id"]
        if prediction_id in seen:
            continue

        seen.add(prediction_id)
        records.append(normalized)

    records.sort(
        key=lambda row: (
            str(row.get("arrival_time") or row.get("departure_time") or ""),
            str(row.get("route_id") or ""),
            str(row.get("stop_id") or ""),
            str(row.get("prediction_id") or ""),
        )
    )
    return records
