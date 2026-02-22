from typing import Any

from streaming.logging import get_stream_logger, log_stream_event


def get_logger():
    return get_stream_logger("alerts")


def log_worker_event(event: str, **fields: Any) -> None:
    """Log a structured alerts worker event."""

    log_stream_event("alerts", event, **fields)
