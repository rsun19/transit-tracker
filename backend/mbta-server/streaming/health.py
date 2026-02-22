from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional


@dataclass
class StreamHealthState:
    """In-memory health state for a long-lived stream pipeline."""

    connected: bool = False
    last_event_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    last_error_message: Optional[str] = None

    def mark_connected(self) -> None:
        self.connected = True

    def mark_disconnected(self, error_message: Optional[str] = None) -> None:
        self.connected = False
        self.last_error_at = datetime.now(timezone.utc)
        self.last_error_message = error_message

    def record_event(self) -> None:
        self.last_event_at = datetime.now(timezone.utc)


_states: Dict[str, StreamHealthState] = {}


def get_stream_health_state(stream_name: str) -> StreamHealthState:
    """Get a named stream health state singleton."""

    if stream_name not in _states:
        _states[stream_name] = StreamHealthState()
    return _states[stream_name]
