from datetime import datetime, timezone

from alerts.mbta_message_codec import decode_broker_message, encode_broker_message


def test_encode_and_decode_broker_message_round_trip():
    upstream = {"id": "alert-1", "type": "alert", "attributes": {"a": 1}}

    encoded = encode_broker_message(upstream)
    decoded = decode_broker_message(encoded)

    assert decoded["alert_id"] == "alert-1"
    assert decoded["payload"] == upstream

    emitted_at = decoded["emitted_at"]
    # Basic sanity check that emitted_at is a valid ISO 8601 timestamp
    parsed = datetime.fromisoformat(emitted_at)
    assert parsed.tzinfo is not None
    assert parsed.tzinfo == timezone.utc
