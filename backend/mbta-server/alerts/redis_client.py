from streaming.broker import get_redis_client_from_url

from .const import REDIS_URL


def get_redis_client():
    """Return an asyncio Redis client configured from alerts REDIS_URL."""

    return get_redis_client_from_url(REDIS_URL)
