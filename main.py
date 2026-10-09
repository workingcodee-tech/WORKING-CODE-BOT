"""
WORKING CODE — Telegram Botning asosiy kirish nuqtasi (main.py).
Python 3.12+ | aiogram 3.x | SQLAlchemy 2.x | asyncpg | Railway 24/7
"""

from __future__ import annotations

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import ErrorEvent

from config import Config, load_config
from database import DatabaseManager
from handlers import register_all_routers
from middlewares.auth_sub import DatabaseAndAccessMiddleware
from middlewares.throttling import ThrottlingMiddleware
from services.broadcast import broadcast_queue_worker
from services.cleanup import cleanup_expired_messages_worker
from services.security import SensitiveTokenFilter


def setup_logging(config: Config) -> None:
    level = getattr(logging, config.log_level.upper(), logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    handler.addFilter(SensitiveTokenFilter(config.bot_token))

    root_logger.handlers.clear()
    root_logger.addHandler(handler)


async def register_global_error_handler(dp: Dispatcher) -> None:
    @dp.error()
    async def global_error_handler(event: ErrorEvent) -> bool:
        logger = logging.getLogger("GlobalErrorHandler")
        logger.exception("Kutilmagan texnik xatolik yuz berdi: %s", event.exception)

        update = event.update
        try:
            if update.message:
                await update.message.answer(
                    "⚠️ <b>Texnik xatolik yuz berdi.</b>\n"
                    "Iltimos, birozdan so‘ng qayta urinib ko‘ring yoki /start buyrug‘ini bosing."
                )
            elif update.callback_query:
                await update.callback_query.answer(
                    "⚠️ Texnik xatolik yuz berdi. Qaytadan urinib ko‘ring.",
                    show_alert=True,
                )
        except TelegramAPIError:
            pass
        return True


async def main() -> None:
    config = load_config()
    setup_logging(config)
    logger = logging.getLogger("WorkingCodeBot")

    logger.info("WORKING CODE Telegram boti ishga tushirilmoqda...")

    db = DatabaseManager(config.database_url)
    await db.init_db()

    bot = Bot(
        token=config.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    # Webhook bilan to'qnashuv bo'lmasligi uchun webhookni o'chiramiz
    await bot.delete_webhook(drop_pending_updates=False)

    dp = Dispatcher(storage=MemoryStorage())

    # Chat_member hodisalarida ham bot va db mavjud bo'lishi uchun workflow_data ga qo'shamiz
    dp.workflow_data.update(
        {
            "db": db,
            "config": config,
        }
    )

    # Middleware'larni ulash
    dp.message.middleware(ThrottlingMiddleware(min_interval_seconds=0.35))
    dp.message.middleware(DatabaseAndAccessMiddleware(db=db, config=config))
    dp.callback_query.middleware(DatabaseAndAccessMiddleware(db=db, config=config))

    # Barcha routerlarni va xatolik ushlagichni ro'yxatdan o'tkazish
    await register_global_error_handler(dp)
    register_all_routers(dp)

    stop_event = asyncio.Event()
    cleanup_task = asyncio.create_task(
        cleanup_expired_messages_worker(bot=bot, db=db, stop_event=stop_event),
        name="cleanup_expired_messages_worker",
    )
    broadcast_task = asyncio.create_task(
        broadcast_queue_worker(bot=bot, db=db, config=config, stop_event=stop_event),
        name="broadcast_queue_worker",
    )

    try:
        me = await bot.get_me()
        logger.info(
            "Bot muvaffaqiyatli ishga tushdi: @%s (ID: %s) | Asosiy Admin ID: %s",
            me.username,
            me.id,
            config.admin_id,
        )
        await dp.start_polling(
            bot,
            allowed_updates=["message", "callback_query", "chat_member", "my_chat_member"],
        )
    finally:
        logger.info("Bot to'xtatilmoqda, orqa fon vazifalari va ulanishlar yopilmoqda...")
        stop_event.set()
        cleanup_task.cancel()
        broadcast_task.cancel()
        await asyncio.gather(cleanup_task, broadcast_task, return_exceptions=True)
        await bot.session.close()
        await db.close()
        logger.info("WORKING CODE boti xavfsiz tarzda to'xtatildi.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
