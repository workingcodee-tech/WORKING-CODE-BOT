"""
WORKING CODE — Ma'lumotlar bazasiga ulanish, qayta ulanish va avtomatik jadval yaratish moduli.
PostgreSQL (asyncpg) ulanmasa yoki DATABASE_URL berilmagan bo'lsa, avtomatik ravishda
SQLite (aiosqlite) bazasiga o'tadi — bot hech qachon bazasiz qolib to'xtab qolmaydi.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from models import Base

logger = logging.getLogger(__name__)


def _build_engine(database_url: str) -> AsyncEngine:
    if database_url.startswith("sqlite"):
        return create_async_engine(
            database_url,
            connect_args={"check_same_thread": False},
            echo=False,
        )
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        pool_timeout=30,
        echo=False,
    )


class DatabaseManager:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self.engine: AsyncEngine = _build_engine(database_url)
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

    async def init_db(self, max_retries: int = 3, retry_delay: float = 2.0) -> None:
        """
        Ma'lumotlar bazasiga ulanishni tekshiradi va barcha jadvallarni avtomatik yaratadi.
        Agar PostgreSQL ulanishi muvaffaqiyatsiz bo'lsa, avtomatik ravishda mahalliy
        SQLite bazasiga zaxira (fallback) ulanishni amalga oshiradi.
        """
        for attempt in range(1, max_retries + 1):
            try:
                async with self.engine.begin() as conn:
                    await conn.execute(text("SELECT 1"))
                    await conn.run_sync(Base.metadata.create_all)
                db_type = "SQLite (Avtomatik)" if self.database_url.startswith("sqlite") else "PostgreSQL"
                logger.info("%s ma'lumotlar bazasi ulandi va barcha jadvallar tayyorlandi.", db_type)
                return
            except Exception as exc:
                logger.warning(
                    "Baza ulanishida xatolik (%d/%d): %s",
                    attempt,
                    max_retries,
                    exc,
                )
                if attempt < max_retries:
                    await asyncio.sleep(retry_delay)

        # Agar PostgreSQL ulanmagan bo'lsa, avtomatik SQLite bazasiga o'tamiz
        if not self.database_url.startswith("sqlite"):
            logger.warning(
                "PostgreSQL ulanishi amalga oshmadi. Bot to'xtab qolmasligi uchun "
                "avtomatik mahalliy SQLite (data/working_code.db) bazasiga o'tilmoqda..."
            )
            await self.engine.dispose()
            data_dir = Path("data")
            data_dir.mkdir(parents=True, exist_ok=True)
            fallback_url = f"sqlite+aiosqlite:///{(data_dir / 'working_code.db').as_posix()}"
            self.database_url = fallback_url
            self.engine = _build_engine(fallback_url)
            self.session_factory = async_sessionmaker(
                bind=self.engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,
            )
            async with self.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Zaxira SQLite ma'lumotlar bazasi muvaffaqiyatli ishga tushirildi.")

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self.session_factory()
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

    async def close(self) -> None:
        await self.engine.dispose()
        logger.info("Ma'lumotlar bazasi ulanishlari xavfsiz yopildi.")
