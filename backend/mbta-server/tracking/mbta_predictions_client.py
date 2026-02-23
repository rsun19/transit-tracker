import asyncio
from collections.abc import Iterable
from typing import Any

import httpx

from .const import MBTA_KEY, MBTA_PREDICTIONS_URL, TRACKING_ROUTE_CONCURRENCY


def _build_params(route_id: str) -> dict[str, str]:
    return {"filter[route]": route_id}


async def fetch_predictions_for_route(
    client: httpx.AsyncClient, route_id: str
) -> list[dict[str, Any]]:
    params = _build_params(route_id)
    if MBTA_KEY:
        params["api_key"] = MBTA_KEY

    response = await client.get(MBTA_PREDICTIONS_URL, params=params)
    response.raise_for_status()

    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    return [item for item in data if isinstance(item, dict)]


async def fetch_predictions_for_routes(
    route_ids: Iterable[str],
    *,
    max_concurrency: int = TRACKING_ROUTE_CONCURRENCY,
) -> list[dict[str, Any]]:
    semaphore = asyncio.Semaphore(max(1, int(max_concurrency)))

    async with httpx.AsyncClient(timeout=20.0, http2=True) as client:

        async def _fetch(route_id: str) -> list[dict[str, Any]]:
            async with semaphore:
                return await fetch_predictions_for_route(client, route_id)

        results = await asyncio.gather(
            *[_fetch(route_id) for route_id in route_ids], return_exceptions=True
        )

    merged: list[dict[str, Any]] = []
    for item in results:
        if isinstance(item, Exception):
            continue
        merged.extend(item)

    return merged
