"""
WORKING CODE — Foydalanuvchini bazada ro'yxatga olish, ma'lumotlarini yangilash,
admin/vaqtinchalik admin holatini aniqlash va majburiy obuna + telefon tasdig'ini
avtomatik tekshirish middleware'i.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware, Bot
from aiogram.types import CallbackQuery, Message, TelegramObject, User as TgUser
from sqlalchemy import select

from config import Config
from database import DatabaseManager
from keyboards.user_kb import build_phone_request_kb, build_subscription_inline_kb
from models import User
from services.cleanup import safe_delete_bot_message, schedule_bot_message_deletion
from services.security import get_active_temp_admin
from services.subscription import check_user_subscriptions

logger = logging.getLogger(__name__)


class DatabaseAndAccessMiddleware(BaseMiddleware):
    """
    Har bir Message va CallbackQuery uchun:
    1. PostgreSQL sessiyasini ochadi va `data["session"]` ga joylaydi.
    2. Foydalanuvchini bazadan topadi yoki yangi yaratadi (ism, familiya, username yangilanadi).
    3. `is_main_admin` va `temp_admin` huquqlarini tekshiradi.
    4. Oddiy foydalanuvchilar uchun /start va kontakt yuborishdan tashqari barcha
       harakatlardan oldin obuna holatini API orqali qayta tekshiradi.
    """

    def __init__(self, db: DatabaseManager, config: Config) -> None:
        super().__init__()
        self.db = db
        self.config = config

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        tg_user: TgUser | None = data.get("event_from_user")
        bot: Bot = data["bot"]

        async with self.db.session() as session:
            data["session"] = session
            data["config"] = self.config
            data["db"] = self.db

            if tg_user is None or tg_user.is_bot:
                return await handler(event, data)

            now = datetime.now(timezone.utc)
            db_user = await session.scalar(
                select(User).where(User.telegram_id == tg_user.id)
            )
            if db_user is None:
                db_user = User(
                    telegram_id=tg_user.id,
                    first_name=tg_user.first_name or "Foydalanuvchi",
                    last_name=tg_user.last_name,
                    username=tg_user.username,
                    is_phone_verified=False,
                    is_subscribed_all=False,
                    is_blocked=False,
                    joined_at=now,
                    last_active_at=now,
                )
                session.add(db_user)
                await session.flush()
            else:
                db_user.first_name = tg_user.first_name or db_user.first_name
                db_user.last_name = tg_user.last_name
                db_user.username = tg_user.username
                db_user.is_blocked = False
                db_user.last_active_at = now

            is_main_admin = tg_user.id == self.config.admin_id
            temp_admin = None
            if not is_main_admin:
                temp_admin = await get_active_temp_admin(session, tg_user.id)

            data["db_user"] = db_user
            data["is_main_admin"] = is_main_admin
            data["temp_admin"] = temp_admin
            data["is_any_admin"] = is_main_admin or (temp_admin is not None)

            # Asosiy admin uchun kanalga obuna va telefon tasdig'i talab qilinmaydi
            if is_main_admin:
                return await handler(event, data)

            # /start buyrug'i, kontakt yuborish va obunani tekshirish callback'i handlerning o'ziga o'tadi
            if isinstance(event, Message):
                text = (event.text or "").strip()
                if text.startswith("/start") or event.contact is not None:
                    return await handler(event, data)
            elif isinstance(event, CallbackQuery):
                if event.data and event.data.startswith("user:check_sub"):
                    return await handler(event, data)

            # 4-bo'lim talabi: Foydalanuvchi faoliyatidan oldin obuna holati API orqali qayta tekshirilsin
            is_sub_ok, unsubscribed_channels = await check_user_subscriptions(
                bot, session, tg_user.id
            )
            if not is_sub_ok:
                # Agar vaqtinchalik admin kanaldan chiqib ketsa ham funksiyalar darhol bloklanadi
                chat_id = (
                    event.chat.id
                    if isinstance(event, Message)
                    else (event.message.chat.id if isinstance(event, CallbackQuery) and event.message else tg_user.id)
                )
                if db_user.last_prompt_message_id:
                    await safe_delete_bot_message(bot, chat_id, db_user.last_prompt_message_id)

                warn_msg = await bot.send_message(
                    chat_id=chat_id,
                    text=(
                        "⚠️ <b>Diqqat, {name}!</b>\n\n"
                        "Botning asosiy funksiyalaridan foydalanish uchun quyidagi majburiy "
                        "kanallarga obuna bo‘lishingiz shart. Obuna bo‘lishingiz bilan bot "
                        "avtomatik ravishda qayta ochiladi:"
                    ).format(name=db_user.first_name),
                    reply_markup=build_subscription_inline_kb(unsubscribed_channels),
                )
                db_user.last_prompt_message_id = warn_msg.message_id
                await schedule_bot_message_deletion(
                    session, warn_msg, category="sub_warning", config=self.config
                )
                if isinstance(event, CallbackQuery):
                    await event.answer(
                        "Avval barcha majburiy kanallarga obuna bo‘ling!", show_alert=True
                    )
                return None

            # 5-bo'lim talabi: Telefon raqami tasdiqlanmaguncha kodlar bo'yicha kontent olishga ruxsat berilmasin
            if not db_user.is_phone_verified:
                chat_id = (
                    event.chat.id
                    if isinstance(event, Message)
                    else (event.message.chat.id if isinstance(event, CallbackQuery) and event.message else tg_user.id)
                )
                warn_msg = await bot.send_message(
                    chat_id=chat_id,
                    text=(
                        "📱 <b>Telefon raqamni tasdiqlash talab etiladi!</b>\n\n"
                        "Xavfsizlikni ta’minlash, soxta profillardan himoyalanish va maxsus kodlar "
                        "orqali fayllarni taqdim etish uchun o‘z Telegram kontaktingizni tasdiqlashingiz zarur.\n\n"
                        "👇 Pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini bosing:"
                    ),
                    reply_markup=build_phone_request_kb(),
                )
                await schedule_bot_message_deletion(
                    session, warn_msg, category="phone_warning", config=self.config
                )
                if isinstance(event, CallbackQuery):
                    await event.answer(
                        "Avval telefon raqamingizni tasdiqlang!", show_alert=True
                    )
                return None

            return await handler(event, data)
