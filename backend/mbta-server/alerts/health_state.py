from streaming.health import StreamHealthState, get_stream_health_state


def get_health_state() -> StreamHealthState:
    """Return the named alerts stream health state singleton."""

    return get_stream_health_state("alerts")
