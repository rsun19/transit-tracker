import asyncio
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from tracking.management.commands.mbta_predictions_worker import _poll_and_publish


class WorkerTests(TestCase):
    def test_poll_and_publish_writes_and_publishes(self):
        redis_client = AsyncMock()
        redis_client.publish = AsyncMock()

        with (
            patch(
                "tracking.management.commands.mbta_predictions_worker.get_rapid_transit_route_ids",
                AsyncMock(return_value=["Red"]),
            ),
            patch(
                "tracking.management.commands.mbta_predictions_worker.fetch_predictions_for_routes",
                AsyncMock(
                    return_value=[
                        {
                            "id": "prediction-1",
                            "attributes": {},
                            "relationships": {
                                "route": {"data": {"id": "Red"}},
                                "stop": {"data": {"id": "70080"}},
                            },
                        }
                    ]
                ),
            ),
            patch(
                "tracking.management.commands.mbta_predictions_worker.transform_predictions_for_client",
                return_value=[
                    {
                        "prediction_id": "prediction-1",
                        "route_id": "Red",
                        "stop_id": "70080",
                    }
                ],
            ),
            patch(
                "tracking.management.commands.mbta_predictions_worker.write_prediction_snapshot",
                AsyncMock(
                    return_value={"record_count": 1, "route_count": 1, "stop_count": 1}
                ),
            ),
        ):
            stats = asyncio.run(_poll_and_publish(redis_client))

        self.assertEqual(stats["record_count"], 1)
        redis_client.publish.assert_awaited()
