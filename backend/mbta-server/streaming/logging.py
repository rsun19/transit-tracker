import logging
from typing import Any


def get_stream_logger(stream_name: str) -> logging.Logger:
    """Return a namespaced logger for stream pipelines."""

    return logging.getLogger(f"streaming.{stream_name}")


def log_stream_event(stream_name: str, event: str, **fields: Any) -> None:
    """Log a structured stream event."""

    logger = get_stream_logger(stream_name)
    extra = {"stream_name": stream_name, "event": event, **fields}
    logger.info("stream_event", extra=extra)
