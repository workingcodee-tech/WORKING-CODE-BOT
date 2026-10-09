"""
WORKING CODE — Majburiy kanallarga obuna bo'lishni tekshirish va kanallarni
tasdiqlash xizmati.
"""

from __future__ import annotations

import logging
import re
from typing import List, Tuple

from aiogram import Bot
from aiogram.enums import ChatMemberStatus, ChatType
from aiogram.exceptions import TelegramAPIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, User

logger = logging.getLogger(__name__)

SUBSCRIBED_STATUSES = {
    ChatMemberStatus.CREATOR,
    ChatMemberStatus.ADMINISTRATOR,
    ChatMemberStatus.MEMBER,
}


async def get_active_channels(session: AsyncSession) -> List[Channel]:
    """Barcha faol majburiy kanallar ro'yxatini qaytaradi."""
    stmt = (
        select(Channel)
        .where(Channel.is_active.is_(True))
        .order_by(Channel.id.asc())
    )
    return list((await session.scalars(stmt)).all())


async def check_user_subscriptions(
    bot: Bot, session: AsyncSession, telegram_id: int
) -> Tuple[bool, List[Channel]]:
    """
    Foydalanuvchining barcha faol majburiy kanallarga a'zo ekanligini Telegram API orqali tekshiradi.
    Qaytaradi: (barchasiga_a'zomi, obuna_bo'lmagan_kanallar_ro'yxati)
    """
    channels = await get_active_channels(session)
    if not channels:
        return True, []

    unsubscribed: List[Channel] = []
    for ch in channels:
        try:
            member = await bot.get_chat_member(chat_id=ch.channel_id, user_id=telegram_id)
            # RESTRICTED holatda is_member True bo'lsa ham a'zo hisoblanadi
            is_member = member.status in SUBSCRIBED_STATUSES or (
                member.status == ChatMemberStatus.RESTRICTED
                and getattr(member, "is_member", False)
            )
            if not is_member:
                unsubscribed.append(ch)
        except TelegramAPIError as exc:
            logger.warning(
                "Kanal obunasini tekshirishda xatolik (channel_id=%s, user_id=%s): %s",
                ch.channel_id,
                telegram_id,
                exc,
            )
            unsubscribed.append(ch)

    is_all_ok = len(unsubscribed) == 0
    user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    if user and user.is_subscribed_all != is_all_ok:
        user.is_subscribed_all = is_all_ok

    return is_all_ok, unsubscribed


def parse_channel_input(raw_input: str) -> str:
    """
    Admin yuborgan kanal manzilini (@username, https://t.me/username yoki -100... ID)
    Telegram API tushunadigan identifikatorga aylantiradi.
    """
    text = (raw_input or "").strip()
    if not text:
        return ""
    if text.lstrip("-").isdigit():
        return text

    # https://t.me/+invite yoki https://t.me/joinchat/... maxfiy havola bo'lsa
    if "t.me/+" in text or "t.me/joinchat/" in text:
        return text

    match = re.search(r"(?:https?://)?t\.me/([A-Za-z0-9_]{4,64})", text)
    if match:
        return f"@{match.group(1)}"

    if text.startswith("@"):
        return text

    if re.fullmatch(r"[A-Za-z0-9_]{4,64}", text):
        return f"@{text}"

    return text


async def verify_and_resolve_channel(
    bot: Bot, raw_identifier: str, custom_invite_link: str | None = None
) -> Tuple[bool, str, dict]:
    """
    Kanalni Telegram API orqali tekshiradi:
    1. Kanal mavjudligini va chat turi CHANNEL yoki SUPERGROUP ekanligini aniqlaydi.
    2. Bot o'sha kanalda administrator ekanligini tekshiradi.
    3. Obunani tekshirish va havola olish ruxsati borligini tasdiqlaydi.
    """
    parsed = parse_channel_input(raw_identifier)
    if not parsed:
        return False, "❌ Kanal manzili bo‘sh! @username, kanal ID (-100...) yoki t.me havolasini yuboring.", {}

    if parsed.startswith("http") and ("t.me/+" in parsed or "joinchat" in parsed):
        return (
            False,
            "❌ Maxfiy taklif havolasi orqali kanal ID raqamini bevosita aniqlab bo‘lmaydi.\n"
            "Iltimos, yopiq kanal uchun avval uning ID raqamini (masalan: <code>-1001234567890</code>) "
            "yoki ommaviy <code>@username</code> manzilini yuboring.",
            {},
        )

    try:
        chat_id_or_username: int | str = int(parsed) if parsed.lstrip("-").isdigit() else parsed
        chat = await bot.get_chat(chat_id=chat_id_or_username)
    except TelegramAPIError as exc:
        logger.warning("Kanalni aniqlashda xatolik (%s): %s", parsed, exc)
        return (
            False,
            "❌ Kanal topilmadi yoki bot ushbu kanalga qo‘shilmagan!\n"
            "Avval botni kanalga administrator qilib qo‘shing va qayta urinib ko‘ring.",
            {},
        )

    if chat.type not in {ChatType.CHANNEL, ChatType.SUPERGROUP}:
        return False, "❌ Kiritilgan manzil Telegram kanal yoki superguruh emas!", {}

    try:
        me = await bot.get_me()
        bot_member = await bot.get_chat_member(chat_id=chat.id, user_id=me.id)
    except TelegramAPIError as exc:
        logger.warning("Botning kanaldagi huquqini tekshirishda xatolik: %s", exc)
        return (
            False,
            "❌ Botning kanaldagi a’zolik holatini tekshirib bo‘lmadi. Bot kanalga admin qilinganiga ishonch hosil qiling.",
            {},
        )

    if bot_member.status not in {ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.CREATOR}:
        return (
            False,
            f"❌ Bot «{chat.title}» kanalida administrator emas!\n"
            "Obunalarni tekshirish uchun botni kanalga administrator qilib tayinlang.",
            {},
        )

    username = chat.username
    invite_link = custom_invite_link
    if not invite_link:
        if username:
            invite_link = f"https://t.me/{username}"
        elif chat.invite_link:
            invite_link = chat.invite_link
        else:
            try:
                created_link = await bot.create_chat_invite_link(chat_id=chat.id)
                invite_link = created_link.invite_link
            except TelegramAPIError:
                return (
                    False,
                    f"⚠️ Bot «{chat.title}» kanalida admin, ammo kanal yopiq va botda taklif havolasi "
                    "yaratish («Invite Users via Link») ruxsati yo‘q. Botga ushbu ruxsatni bering yoki ochiq @username o‘rnating.",
                    {},
                )

    return (
        True,
        "✅ Kanal muvaffaqiyatli tekshirildi.",
        {
            "channel_id": chat.id,
            "title": chat.title or str(chat.id),
            "username": username,
            "invite_link": invite_link,
        },
    )
