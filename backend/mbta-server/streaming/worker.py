import asyncio
import random
from collections.abc import Awaitable, Callable


async def run_with_backoff(
    *,
    run_once: Callable[[], Awaitable[None]],
    on_start: Callable[[], None] | None = None,
    on_end: Callable[[], None] | None = None,
    on_error: Callable[[Exception], None] | None = None,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
) -> None:
    """Run a long-lived coroutine loop with capped exponential backoff + jitter."""

    delay = base_delay

    while True:
        try:
            if on_start:
                on_start()
            await run_once()
            if on_end:
                on_end()
            delay = base_delay
            await asyncio.sleep(1.0)
        except Exception as exc:  # pragma: no cover - defensive catch
            if on_error:
                on_error(exc)

            delay = min(max_delay, delay * 2)
            jitter = random.uniform(0, delay / 2)
            await asyncio.sleep(delay + jitter)
