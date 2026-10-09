"""
WORKING CODE — Flood va spamga qarshi tezkor himoya middleware'i.
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject


class ThrottlingMiddleware(BaseMiddleware):
    def __init__(self, min_interval_seconds: float = 0.35) -> None:
        super().__init__()
        self.min_interval = min_interval_seconds
        self._last_seen: Dict[int, float] = {}

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        if isinstance(event, Message) and event.from_user:
            # Media guruh (albom) xabarlarini bloklamaslik uchun media_group_id bo'lsa o'tkazamiz
            if not event.media_group_id:
                uid = event.from_user.id
                now = time.monotonic()
                prev = self._last_seen.get(uid, 0.0)
                if now - prev < self.min_interval:
                    return None
                self._last_seen[uid] = now
        return await handler(event, data)
