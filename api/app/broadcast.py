"""In-process broadcast hub.

`BroadcastHub` is the seam a Redis implementation can replace. v1 publishes
only through `InMemoryHub`.
"""

from __future__ import annotations

import asyncio
import copy
from collections import defaultdict
from collections.abc import Mapping
from typing import Any, Protocol


class Subscription(Protocol):
    async def get(self) -> dict[str, Any]: ...

    async def aclose(self) -> None: ...


class BroadcastHub(Protocol):
    async def subscribe(self, slug: str) -> Subscription: ...

    async def publish(self, slug: str, frame: Mapping[str, Any]) -> None: ...


class _QueueSubscription:
    def __init__(self, queue: asyncio.Queue[dict[str, Any]], hub: InMemoryHub, slug: str) -> None:
        self._queue = queue
        self._hub = hub
        self._slug = slug
        self._closed = False

    async def get(self) -> dict[str, Any]:
        return await self._queue.get()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._hub._discard(self._slug, self._queue)


class InMemoryHub:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, slug: str) -> _QueueSubscription:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            self._subscribers[slug].add(queue)
        return _QueueSubscription(queue, self, slug)

    async def publish(self, slug: str, frame: Mapping[str, Any]) -> None:
        payload = copy.deepcopy(dict(frame))
        async with self._lock:
            queues = list(self._subscribers.get(slug, ()))
        for queue in queues:
            await queue.put(payload)

    async def _discard(self, slug: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(slug)
            if subscribers is None:
                return
            subscribers.discard(queue)
            if not subscribers:
                del self._subscribers[slug]
