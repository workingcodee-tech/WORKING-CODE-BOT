"""
WORKING CODE — Telegram Bot handlerlar paketi.
"""

from __future__ import annotations

from aiogram import Dispatcher

from handlers.admin import router as admin_router
from handlers.broadcast import router as broadcast_router
from handlers.channels import router as channels_router
from handlers.contents import router as contents_router
from handlers.user import router as user_router


def register_all_routers(dp: Dispatcher) -> None:
    """
    Routerlarni ustuvorlik (priority) tartibida ulaydi:
    1. Admin, Kanallar, Kontentlar va Reklama routerlari
    2. Foydalanuvchi va maxsus kod qidirish routeri
    """
    dp.include_router(admin_router)
    dp.include_router(channels_router)
    dp.include_router(contents_router)
    dp.include_router(broadcast_router)
    dp.include_router(user_router)
