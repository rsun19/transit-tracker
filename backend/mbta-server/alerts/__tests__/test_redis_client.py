import asyncio

from alerts.redis_client import get_redis_client


def test_get_redis_client_returns_async_client():
    async def _run() -> None:
        client = get_redis_client()
        # The exact class depends on redis-py internals, but the object should
        # provide `publish` and `pubsub` coroutine methods for our usage.
        assert hasattr(client, "publish")
        assert hasattr(client, "pubsub")

        # Clean up the created client
        await client.aclose()

    asyncio.run(_run())
