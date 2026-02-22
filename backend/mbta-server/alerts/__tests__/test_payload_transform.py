from django.test import SimpleTestCase

from alerts.payload_transform import transform_mbta_payload_for_client


class PayloadTransformTest(SimpleTestCase):
    def test_transform_single_alert_payload(self):
        payload = {
            "id": "668492",
            "type": "alert",
            "attributes": {
                "active_period": [{"start": "2025-09-27T03:00:00-04:00", "end": None}],
                "cause": "UNKNOWN_CAUSE",
                "effect": "STATION_ISSUE",
                "header": "Jackson Square platform issue",
                "description": "Please see station personnel.",
                "url": "MBTA.com/JacksonSquare",
                "lifecycle": "ONGOING",
                "informed_entity": [
                    {"route": "Orange"},
                    {"route": "Orange"},
                ],
            },
        }

        rows = transform_mbta_payload_for_client(payload)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["route"], "Orange")
        self.assertEqual(
            rows[0]["active_period"],
            {"start": "2025-09-27T03:00:00-04:00", "end": None},
        )
        self.assertEqual(rows[0]["cause"], "UNKNOWN_CAUSE")
        self.assertEqual(rows[0]["effect"], "STATION_ISSUE")
        self.assertEqual(rows[0]["header"], "Jackson Square platform issue")
        self.assertEqual(rows[0]["description"], "Please see station personnel.")
        self.assertEqual(rows[0]["url"], "MBTA.com/JacksonSquare")
        self.assertEqual(rows[0]["lifecycle"], "ONGOING")
