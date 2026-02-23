from django.test import SimpleTestCase

from tracking.payload_transform import (
    normalize_prediction_for_client,
    transform_predictions_for_client,
)


class PayloadTransformTests(SimpleTestCase):
    def test_normalize_prediction_for_client(self):
        resource = {
            "id": "prediction-1",
            "attributes": {
                "arrival_time": "2026-02-22T12:00:00Z",
                "departure_time": None,
                "direction_id": 0,
                "stop_sequence": 10,
                "status": "On time",
                "updated_at": "2026-02-22T11:58:00Z",
            },
            "relationships": {
                "route": {"data": {"id": "Red", "type": "route"}},
                "stop": {"data": {"id": "70080", "type": "stop"}},
                "trip": {"data": {"id": "trip-1", "type": "trip"}},
            },
        }

        normalized = normalize_prediction_for_client(resource)

        self.assertEqual(normalized["prediction_id"], "prediction-1")
        self.assertEqual(normalized["route_id"], "Red")
        self.assertEqual(normalized["stop_id"], "70080")

    def test_transform_predictions_for_client_dedupes(self):
        resources = [
            {
                "id": "prediction-1",
                "attributes": {
                    "arrival_time": "2026-02-22T12:00:00Z",
                    "updated_at": "2026-02-22T11:58:00Z",
                },
                "relationships": {
                    "route": {"data": {"id": "Red", "type": "route"}},
                    "stop": {"data": {"id": "70080", "type": "stop"}},
                },
            },
            {
                "id": "prediction-1",
                "attributes": {
                    "arrival_time": "2026-02-22T12:00:00Z",
                    "updated_at": "2026-02-22T11:58:00Z",
                },
                "relationships": {
                    "route": {"data": {"id": "Red", "type": "route"}},
                    "stop": {"data": {"id": "70080", "type": "stop"}},
                },
            },
        ]

        transformed = transform_predictions_for_client(resources)

        self.assertEqual(len(transformed), 1)
        self.assertEqual(transformed[0]["prediction_id"], "prediction-1")
