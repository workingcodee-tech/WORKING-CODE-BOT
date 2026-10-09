"""
WORKING CODE — Telegram Bot konfiguratsiya moduli.
Barcha maxfiy kalitlar va sozlamalar faqat environment variables orqali o'qiladi.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv()


def _normalize_async_database_url(raw_url: str) -> str:
    """
    Railway PostgreSQL standart 'postgresql://' yoki 'postgres://' beradi.
    SQLAlchemy 2.x + asyncpg uchun uni 'postgresql+asyncpg://' formatiga o'tkazamiz.
    """
    url = (raw_url or "").strip()
    if not url:
        raise ValueError(
            "DATABASE_URL environment variable topilmadi! "
            "Railway PostgreSQL ulanish manzilini kiriting."
        )
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql+psycopg2://"):
        url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    return url


@dataclass(frozen=True)
class Config:
    bot_token: str
    admin_id: int
    database_url: str
    timezone_name: str
    log_level: str
    temp_msg_delete_seconds: int
    rate_limit_max_attempts: int
    rate_limit_lock_seconds: int
    min_channels: int = 1
    max_channels: int = 10
    temp_admin_duration_minutes: int = 30
    broadcast_delay_seconds: float = 0.05  # ~20 xabar/soniya (Telegram API limitidan xavfsiz)

    @property
    def tz(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone_name)
        except Exception:
            return ZoneInfo("Asia/Tashkent")


def load_config() -> Config:
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        raise RuntimeError("BOT_TOKEN environment variable kiritilmagan!")

    admin_id_raw = os.getenv("ADMIN_ID", "").strip()
    if not admin_id_raw or not admin_id_raw.lstrip("-").isdigit():
        raise RuntimeError("ADMIN_ID environment variable to'g'ri raqam bo'lishi shart!")

    database_url = _normalize_async_database_url(os.getenv("DATABASE_URL", ""))
    timezone_name = os.getenv("TIMEZONE", "Asia/Tashkent").strip() or "Asia/Tashkent"
    log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO"

    try:
        temp_msg_delete_seconds = max(10, int(os.getenv("TEMP_MSG_DELETE_SECONDS", "45")))
    except ValueError:
        temp_msg_delete_seconds = 45

    try:
        rate_limit_max_attempts = max(3, int(os.getenv("RATE_LIMIT_MAX_ATTEMPTS", "5")))
    except ValueError:
        rate_limit_max_attempts = 5

    try:
        rate_limit_lock_seconds = max(30, int(os.getenv("RATE_LIMIT_LOCK_SECONDS", "300")))
    except ValueError:
        rate_limit_lock_seconds = 300

    return Config(
        bot_token=bot_token,
        admin_id=int(admin_id_raw),
        database_url=database_url,
        timezone_name=timezone_name,
        log_level=log_level,
        temp_msg_delete_seconds=temp_msg_delete_seconds,
        rate_limit_max_attempts=rate_limit_max_attempts,
        rate_limit_lock_seconds=rate_limit_lock_seconds,
    )
