from alerts.redis_client import get_redis_client


async def test_get_redis_client_returns_async_client():
    client = get_redis_client()
    # The exact class depends on redis-py internals, but the object should
    # provide `publish` and `pubsub` coroutine methods for our usage.
    assert hasattr(client, "publish")
    assert hasattr(client, "pubsub")

    # Clean up the created client
    await client.close()
