from typing import Any


def _extract_first_active_period(attributes: dict[str, Any]) -> dict[str, Any]:
    active_periods = attributes.get("active_period") or []
    if isinstance(active_periods, list) and active_periods:
        first = active_periods[0]
        if isinstance(first, dict):
            return {
                "start": first.get("start"),
                "end": first.get("end"),
            }
    return {"start": None, "end": None}


def _extract_routes(attributes: dict[str, Any]) -> list[Any]:
    informed_entities = attributes.get("informed_entity") or []
    if not isinstance(informed_entities, list):
        return [None]

    routes = {
        entity.get("route")
        for entity in informed_entities
        if isinstance(entity, dict) and entity.get("route") is not None
    }
    if not routes:
        return [None]
    return sorted(routes)


def transform_alert_for_client(alert: dict[str, Any]) -> list[dict[str, Any]]:
    """Transform a single MBTA alert into the client-facing list structure."""

    attributes = alert.get("attributes") or {}
    active_period = _extract_first_active_period(attributes)

    base = {
        "active_period": active_period,
        "cause": attributes.get("cause"),
        "effect": attributes.get("effect"),
        "header": attributes.get("header") or attributes.get("short_header"),
        "description": attributes.get("description"),
        "url": attributes.get("url"),
        "lifecycle": attributes.get("lifecycle"),
    }

    rows = []
    for route in _extract_routes(attributes):
        rows.append({"route": route, **base})
    return rows


def transform_mbta_payload_for_client(payload: Any) -> list[dict[str, Any]]:
    """Transform MBTA payload variants into client-facing alert rows.

    Returns list[{
      route,
      active_period: {start, end},
      cause,
      effect,
      header,
      description,
      url,
      lifecycle,
    }]
    """

    rows: list[dict[str, Any]] = []

    if isinstance(payload, dict) and "data" in payload:
        data = payload.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    rows.extend(transform_alert_for_client(item))
            return rows
        if isinstance(data, dict):
            return transform_alert_for_client(data)

    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                rows.extend(transform_alert_for_client(item))
        return rows

    if isinstance(payload, dict):
        return transform_alert_for_client(payload)

    return rows
