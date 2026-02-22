import redis.asyncio as redis


def get_redis_client_from_url(redis_url: str) -> "redis.Redis":
    """Return an asyncio Redis client configured from a URL."""

    return redis.from_url(redis_url, decode_responses=False)
