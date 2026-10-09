"""
WORKING CODE — Vaqtinchalik xabarlarni avtomatik o'chirish xizmati.
Qoida: Bot faqat o'zi yuborgan vaqtinchalik xabarlarni o'chiradi. Foydalanuvchi yozgan
xabarlar yoki doimiy kontent xabarlari hech qachon o'chirilmaydi.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from database import DatabaseManager
from models import BotSetting, ScheduledMessageDeletion

logger = logging.getLogger(__name__)

DELETE_DELAY_SETTING_KEY = "temp_msg_delete_seconds"


async def get_delete_delay_seconds(session: AsyncSession, config: Config) -> int:
    """Bazadan yoki konfiguratsiyadan vaqtinchalik xabarlarni o'chirish vaqtini oladi."""
    setting = await session.scalar(
        select(BotSetting).where(BotSetting.key == DELETE_DELAY_SETTING_KEY)
    )
    if setting and setting.value.isdigit():
        return max(5, int(setting.value))
    return config.temp_msg_delete_seconds


async def set_delete_delay_seconds(
    session: AsyncSession, seconds: int, admin_id: int
) -> int:
    """Vaqtinchalik xabarlarni o'chirish muddatini o'zgartiradi."""
    valid_seconds = max(5, min(3600, seconds))
    setting = await session.scalar(
        select(BotSetting).where(BotSetting.key == DELETE_DELAY_SETTING_KEY)
    )
    if setting:
        setting.value = str(valid_seconds)
        setting.updated_by = admin_id
        setting.updated_at = datetime.now(timezone.utc)
    else:
        session.add(
            BotSetting(
                key=DELETE_DELAY_SETTING_KEY,
                value=str(valid_seconds),
                updated_by=admin_id,
            )
        )
    return valid_seconds


async def schedule_bot_message_deletion(
    session: AsyncSession,
    sent_message: Message,
    category: str = "temp_notice",
    delay_seconds: Optional[int] = None,
    config: Optional[Config] = None,
) -> None:
    """
    Bot tomonidan yuborilgan vaqtinchalik xabarni belgilangan muddatdan keyin o'chirish uchun
    bazaga ro'yxatga oladi.
    """
    if delay_seconds is None:
        if config is not None:
            delay_seconds = await get_delete_delay_seconds(session, config)
        else:
            delay_seconds = 45

    delete_after = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
    record = ScheduledMessageDeletion(
        chat_id=sent_message.chat.id,
        message_id=sent_message.message_id,
        category=category,
        delete_after=delete_after,
        is_deleted=False,
    )
    session.add(record)


async def safe_delete_bot_message(
    bot: Bot, chat_id: int, message_id: Optional[int]
) -> bool:
    """Botning o'zi yuborgan xabarini xavfsiz o'chiradi."""
    if not message_id:
        return False
    try:
        await bot.delete_message(chat_id=chat_id, message_id=message_id)
        return True
    except TelegramAPIError as exc:
        logger.debug(
            "Xabarni o'chirishning imkoni bo'lmadi (chat=%s, msg=%s): %s",
            chat_id,
            message_id,
            exc,
        )
        return False


async def cleanup_expired_messages_worker(
    bot: Bot, db: DatabaseManager, stop_event: asyncio.Event
) -> None:
    """
    Orqa fonda ishlaydigan vazifa: muddati yetgan vaqtinchalik bot xabarlarini
    Telegram chatidan o'chirib boradi.
    """
    logger.info("Vaqtinchalik xabarlarni tozalash xizmati (cleanup worker) ishga tushdi.")
    while not stop_event.is_set():
        try:
            now = datetime.now(timezone.utc)
            async with db.session() as session:
                stmt = (
                    select(ScheduledMessageDeletion)
                    .where(
                        ScheduledMessageDeletion.is_deleted.is_(False),
                        ScheduledMessageDeletion.delete_after <= now,
                    )
                    .limit(50)
                )
                expired_items = (await session.scalars(stmt)).all()
                for item in expired_items:
                    await safe_delete_bot_message(bot, item.chat_id, item.message_id)
                    item.is_deleted = True
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Cleanup worker xatoligi: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            continue
    logger.info("Vaqtinchalik xabarlarni tozalash xizmati to'xtatildi.")
