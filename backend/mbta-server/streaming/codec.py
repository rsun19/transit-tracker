import json
from datetime import datetime, timezone
from typing import Any, Dict


def encode_broker_message(upstream_event: Dict[str, Any]) -> str:
    """Encode an upstream event into a broker message JSON string."""

    alert_id = upstream_event.get("id")
    message = {
        "alert_id": alert_id,
        "emitted_at": datetime.now(timezone.utc).isoformat(),
        "payload": upstream_event,
    }
    return json.dumps(message)


def decode_broker_message(data: str) -> Dict[str, Any]:
    """Decode a broker message JSON string into a dictionary."""

    return json.loads(data)
