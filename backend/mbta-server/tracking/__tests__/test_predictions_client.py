from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

import httpx

from tracking.mbta_predictions_client import (
    fetch_predictions_for_route,
    fetch_predictions_for_routes,
)


class PredictionsClientTests(IsolatedAsyncioTestCase):
    async def test_fetch_predictions_for_route_parses_data_list(self):
        client = AsyncMock(spec=httpx.AsyncClient)
        response = Mock()
        response.json.return_value = {
            "data": [{"id": "prediction-1"}, {"id": "prediction-2"}]
        }
        response.raise_for_status = Mock()
        client.get.return_value = response

        rows = await fetch_predictions_for_route(client, "Red")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], "prediction-1")

    async def test_fetch_predictions_for_routes_skips_failed_route(self):
        async def fake_fetch(_client, route_id):
            if route_id == "Red":
                raise httpx.HTTPError("boom")
            return [{"id": f"prediction-{route_id}"}]

        with patch(
            "tracking.mbta_predictions_client.fetch_predictions_for_route",
            side_effect=fake_fetch,
        ):
            rows = await fetch_predictions_for_routes(
                ["Red", "Orange"], max_concurrency=2
            )

        self.assertEqual(rows, [{"id": "prediction-Orange"}])
