"""
WORKING CODE — Xavfsizlik, telefon raqamini formatlash, brute-force himoyasi
va vaqtinchalik admin huquqlarini boshqarish xizmati.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from models import BotSetting, Content, TemporaryAdmin, User

logger = logging.getLogger(__name__)

TEMP_ADMIN_CODE_SETTING_KEY = "temp_admin_secret_code_hash"
TEMP_ADMIN_PLAIN_HINT_KEY = "temp_admin_code_masked"


class SensitiveTokenFilter(logging.Filter):
    """Loglarga BOT_TOKEN yoki maxfiy kalitlar tushib qolishini oldini oladi."""

    def __init__(self, secret_token: str) -> None:
        super().__init__()
        self.secret_token = secret_token

    def filter(self, record: logging.LogRecord) -> bool:
        if self.secret_token and isinstance(record.msg, str):
            record.msg = record.msg.replace(self.secret_token, "[MAXFIY_TOKEN_YASHIRILDI]")
        if record.args:
            cleaned_args = []
            for arg in record.args:
                if isinstance(arg, str) and self.secret_token in arg:
                    cleaned_args.append(arg.replace(self.secret_token, "[MAXFIY_TOKEN_YASHIRILDI]"))
                else:
                    cleaned_args.append(arg)
            record.args = tuple(cleaned_args)
        return True


def normalize_phone_international(raw_phone: str) -> str:
    """Telefon raqamini xalqaro E.164 (+998901234567) formatiga keltiradi."""
    digits = re.sub(r"[^\d]", "", raw_phone or "")
    if not digits:
        return ""
    return f"+{digits}"


def normalize_code(raw_code: str) -> str:
    """Kodni katta-kichik harflarga bog'liq bo'lmasligi uchun UPPERCASE formatga o'tkazadi."""
    return re.sub(r"\s+", "", (raw_code or "").strip()).upper()


def is_valid_code_format(code: str) -> bool:
    """Kod faqat harf, raqam, tire va pastki chiziqdan iborat bo'lishi kerak (2..64 belgi)."""
    return bool(re.fullmatch(r"[A-Z0-9_\-]{2,64}", code))


def _hash_secret_code(normalized_code: str, salt: str) -> str:
    return hmac.new(salt.encode("utf-8"), normalized_code.encode("utf-8"), hashlib.sha256).hexdigest()


async def set_temp_admin_code(
    session: AsyncSession,
    raw_code: str,
    admin_id: int,
    config: Config,
) -> Tuple[bool, str]:
    """
    Asosiy admin tomonidan 30 daqiqalik vaqtinchalik admin kodini o'rnatish.
    Oddiy kontent kodlari bilan to'qnashmasligini tekshiradi va SHA-256 HMAC ko'rinishida saqlaydi.
    """
    clean_code = normalize_code(raw_code)
    if not is_valid_code_format(clean_code):
        return (
            False,
            "❌ Kod formati noto‘g‘ri! Kod 2 tadan 64 tagacha harf, raqam, '-' yoki '_' belgilaridan iborat bo‘lishi kerak.",
        )

    # Oddiy kontent kodlari bilan to'qnashmasligini tekshirish
    existing_content = await session.scalar(select(Content).where(Content.code == clean_code))
    if existing_content is not None:
        return (
            False,
            f"❌ «{clean_code}» kodi allaqachon oddiy kontent kodi sifatida mavjud! Boshqa maxfiy kod tanlang.",
        )

    code_hash = _hash_secret_code(clean_code, str(config.admin_id))
    masked = (
        f"{clean_code[:2]}***{clean_code[-2:]}"
        if len(clean_code) > 4
        else f"{clean_code[0]}***"
    )

    for key, val in (
        (TEMP_ADMIN_CODE_SETTING_KEY, code_hash),
        (TEMP_ADMIN_PLAIN_HINT_KEY, masked),
    ):
        setting = await session.scalar(select(BotSetting).where(BotSetting.key == key))
        if setting:
            setting.value = val
            setting.updated_by = admin_id
            setting.updated_at = datetime.now(timezone.utc)
        else:
            session.add(BotSetting(key=key, value=val, updated_by=admin_id))

    return True, f"✅ Vaqtinchalik admin maxfiy kodi muvaffaqiyatli yangilandi ({masked})."


async def verify_temp_admin_code(session: AsyncSession, raw_code: str, config: Config) -> bool:
    """Yuborilgan kod vaqtinchalik admin kodi ekanligini tekshiradi."""
    clean_code = normalize_code(raw_code)
    if not clean_code:
        return False
    setting = await session.scalar(
        select(BotSetting).where(BotSetting.key == TEMP_ADMIN_CODE_SETTING_KEY)
    )
    if not setting or not setting.value:
        return False
    candidate_hash = _hash_secret_code(clean_code, str(config.admin_id))
    return hmac.compare_digest(setting.value, candidate_hash)


async def is_code_conflicting_with_temp_admin(
    session: AsyncSession, raw_code: str, config: Config
) -> bool:
    """Oddiy kontent kodi qo'shilayotganda vaqtinchalik admin kodi bilan to'qnashmasligini tekshiradi."""
    return await verify_temp_admin_code(session, raw_code, config)


async def grant_temporary_admin(
    session: AsyncSession, user: User, config: Config
) -> TemporaryAdmin:
    """Foydalanuvchiga 30 daqiqalik vaqtinchalik admin huquqini beradi."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=config.temp_admin_duration_minutes)

    # Avvalgi aktiv yozuvlarni yopamiz
    await session.execute(
        update(TemporaryAdmin)
        .where(
            TemporaryAdmin.telegram_id == user.telegram_id,
            TemporaryAdmin.is_active.is_(True),
        )
        .values(is_active=False, revoked_at=now)
    )

    temp_admin = TemporaryAdmin(
        user_id=user.id,
        telegram_id=user.telegram_id,
        granted_at=now,
        expires_at=expires_at,
        is_active=True,
    )
    session.add(temp_admin)
    await session.flush()
    return temp_admin


async def get_active_temp_admin(
    session: AsyncSession, telegram_id: int
) -> Optional[TemporaryAdmin]:
    """
    Foydalanuvchining 30 daqiqalik vaqtinchalik admin muddati tugamaganligini tekshiradi.
    Muddati o'tgan bo'lsa avtomatik ravishda is_active=False qiladi.
    """
    now = datetime.now(timezone.utc)
    await session.execute(
        update(TemporaryAdmin)
        .where(
            TemporaryAdmin.telegram_id == telegram_id,
            TemporaryAdmin.is_active.is_(True),
            TemporaryAdmin.expires_at <= now,
        )
        .values(is_active=False, revoked_at=now)
    )

    return await session.scalar(
        select(TemporaryAdmin)
        .where(
            TemporaryAdmin.telegram_id == telegram_id,
            TemporaryAdmin.is_active.is_(True),
            TemporaryAdmin.expires_at > now,
        )
        .order_by(TemporaryAdmin.expires_at.desc())
    )


async def check_and_record_code_attempt(
    session: AsyncSession, user: User, success: bool, config: Config
) -> Tuple[bool, Optional[int]]:
    """
    Brute-force himoyasi:
    Agar foydalanuvchi bloklangan bo'lsa, qolgan soniyani qaytaradi.
    Noto'g'ri kod kiritilsa, urinishlar sonini oshiradi va limitdan oshsa bloklaydi.
    """
    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        remaining = int((user.locked_until - now).total_seconds())
        return False, max(1, remaining)

    if success:
        user.failed_code_attempts = 0
        user.locked_until = None
        return True, None

    user.failed_code_attempts = (user.failed_code_attempts or 0) + 1
    if user.failed_code_attempts >= config.rate_limit_max_attempts:
        user.locked_until = now + timedelta(seconds=config.rate_limit_lock_seconds)
        user.failed_code_attempts = 0
        return False, config.rate_limit_lock_seconds

    return True, None
