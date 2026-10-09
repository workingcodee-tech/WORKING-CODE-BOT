"""
WORKING CODE — PostgreSQL ulanishi, qayta ulanish va avtomatik jadval yaratish moduli.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
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


class DatabaseManager:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self.engine: AsyncEngine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=1800,
            pool_timeout=30,
            echo=False,
        )
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

    async def init_db(self, max_retries: int = 5, retry_delay: float = 3.0) -> None:
        """
        Ma'lumotlar bazasiga ulanishni tekshiradi va barcha jadvallarni avtomatik yaratadi.
        Railway'da konteyner bazadan oldinroq uyg'onsa, qayta ulanishni kutadi.
        """
        last_error: Exception | None = None
        for attempt in range(1, max_retries + 1):
            try:
                async with self.engine.begin() as conn:
                    await conn.execute(text("SELECT 1"))
                    await conn.run_sync(Base.metadata.create_all)
                logger.info("PostgreSQL ma'lumotlar bazasi muvaffaqiyatli ulandi va jadvallar tayyorlandi.")
                return
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "PostgreSQL ulanishida xatolik (%d/%d): %s. %.1f soniyadan so'ng qayta uriniladi...",
                    attempt,
                    max_retries,
                    exc,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)

        raise RuntimeError(f"PostgreSQL ma'lumotlar bazasiga ulanib bo'lmadi: {last_error}")

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
        """Bot to'xtatilganda PostgreSQL ulanish hovuzini xavfsiz yopadi."""
        await self.engine.dispose()
        logger.info("PostgreSQL ulanishlari xavfsiz yopildi.")
