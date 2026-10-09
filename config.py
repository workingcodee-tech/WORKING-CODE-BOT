"""
WORKING CODE — Telegram Bot konfiguratsiya moduli.
Faqat BOT_TOKEN va ADMIN_ID kiritilganda ham 100% avtomatik ishlaydi!
Agar DATABASE_URL berilgan bo'lsa PostgreSQL (asyncpg) ga ulanadi,
berilmagan bo'lsa avtomatik mahalliy SQLite (aiosqlite) bazasini yaratib ishlaydi.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv()


def _clean_env(value: str | None, default: str = "") -> str:
    """Environment variable qiymatini bo'shliqlar va ortiqcha qo'shtirnoqlardan tozalaydi."""
    if value is None:
        return default
    cleaned = value.strip()
    if len(cleaned) >= 2 and (
        (cleaned.startswith('"') and cleaned.endswith('"'))
        or (cleaned.startswith("'") and cleaned.endswith("'"))
    ):
        cleaned = cleaned[1:-1].strip()
    return cleaned or default


def _resolve_async_database_url() -> str:
    """
    1. Agar Railway PostgreSQL ulanish o'zgaruvchilari (DATABASE_URL, DATABASE_PRIVATE_URL,
       POSTGRES_URL yoki PGHOST/PGUSER/PGPASSWORD/PGDATABASE) mavjud bo'lsa,
       ularni avtomatik 'postgresql+asyncpg://' formatiga o'tkazadi.
    2. Agar foydalanuvchi Railway'ga faqat BOT_TOKEN va ADMIN_ID kiritgan bo'lsa
       (DATABASE_URL kiritmagan bo'lsa), hech qanday xato bermasdan avtomatik ravishda
       doimiy 'sqlite+aiosqlite:///./data/working_code.db' bazasidan foydalanadi.
    """
    candidates = [
        _clean_env(os.getenv("DATABASE_URL")),
        _clean_env(os.getenv("DATABASE_PRIVATE_URL")),
        _clean_env(os.getenv("DATABASE_PUBLIC_URL")),
        _clean_env(os.getenv("POSTGRES_URL")),
        _clean_env(os.getenv("POSTGRESQL_URL")),
    ]
    raw_url = next((u for u in candidates if u and not u.startswith("${{")), "")

    if not raw_url:
        pghost = _clean_env(os.getenv("PGHOST"))
        pguser = _clean_env(os.getenv("PGUSER"))
        pgpassword = _clean_env(os.getenv("PGPASSWORD"))
        pgdatabase = _clean_env(os.getenv("PGDATABASE"))
        pgport = _clean_env(os.getenv("PGPORT"), "5432")
        if pghost and pguser and pgpassword and pgdatabase:
            raw_url = f"postgresql+asyncpg://{pguser}:{pgpassword}@{pghost}:{pgport}/{pgdatabase}"

    if raw_url:
        if raw_url.startswith("postgres://"):
            return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
        if raw_url.startswith("postgresql://"):
            return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if raw_url.startswith("postgresql+psycopg2://"):
            return raw_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
        return raw_url

    # DATABASE_URL kiritilmagan taqdirda avtomatik SQLite (aiosqlite) bazasi yaratiladi
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{(data_dir / 'working_code.db').as_posix()}"


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
    broadcast_delay_seconds: float = 0.05

    @property
    def tz(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone_name)
        except Exception:
            return ZoneInfo("Asia/Tashkent")


def load_config() -> Config:
    bot_token = _clean_env(os.getenv("BOT_TOKEN"))
    if not bot_token:
        raise RuntimeError(
            "BOT_TOKEN environment variable kiritilmagan! "
            "Railway Variables bo'limiga BOT_TOKEN ni kiriting."
        )

    admin_id_raw = _clean_env(os.getenv("ADMIN_ID"))
    # Agar vergul bilan bir nechta yozilgan bo'lsa birinchisini olamiz
    if "," in admin_id_raw:
        admin_id_raw = admin_id_raw.split(",")[0].strip()

    if not admin_id_raw or not admin_id_raw.lstrip("-").isdigit():
        raise RuntimeError(
            "ADMIN_ID environment variable to'g'ri raqam bo'lishi shart! "
            "Railway Variables bo'limiga ADMIN_ID (Telegram ID raqamingizni) kiriting."
        )

    database_url = _resolve_async_database_url()
    timezone_name = _clean_env(os.getenv("TIMEZONE"), "Asia/Tashkent")
    log_level = _clean_env(os.getenv("LOG_LEVEL"), "INFO").upper()

    try:
        temp_msg_delete_seconds = max(10, int(_clean_env(os.getenv("TEMP_MSG_DELETE_SECONDS"), "45")))
    except ValueError:
        temp_msg_delete_seconds = 45

    try:
        rate_limit_max_attempts = max(3, int(_clean_env(os.getenv("RATE_LIMIT_MAX_ATTEMPTS"), "5")))
    except ValueError:
        rate_limit_max_attempts = 5

    try:
        rate_limit_lock_seconds = max(30, int(_clean_env(os.getenv("RATE_LIMIT_LOCK_SECONDS"), "300")))
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
