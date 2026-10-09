"""
WORKING CODE — Ommaviy reklama (Broadcast) navbat tizimi va qayta tiklash xizmati.
Talablar:
- copyMessage yoki mos media yuborish metodlaridan foydalanish
- protect_content=True qo'llash
- Bloklagan va xatolik bergan foydalanuvchilarni hisobga olish
- Telegram API tezlik cheklovlariga (RetryAfter) rioya qilish
- Bot qayta ishga tushsa, tugallanmagan reklamani kelgan joyidan davom ettirish
- Yakunda asosiy adminga batafsil o'zbek tilida hisobot yuborish
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from aiogram import Bot
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramRetryAfter,
    TelegramAPIError,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from database import DatabaseManager
from models import Broadcast, BroadcastRecipient, User

logger = logging.getLogger(__name__)


async def create_broadcast_job(
    session: AsyncSession,
    admin_id: int,
    content_type: str,
    from_chat_id: int,
    message_id: int,
    file_id: str | None,
    caption_or_text: str | None,
) -> Broadcast:
    """
    Yangi reklama kampaniyasini yaratadi va bazadagi barcha foydalanuvchilarni
    navbatga (broadcast_recipients) qo'shadi.
    """
    users = list((await session.scalars(select(User).order_by(User.id.asc()))).all())

    broadcast = Broadcast(
        created_by=admin_id,
        content_type=content_type,
        from_chat_id=from_chat_id,
        message_id=message_id,
        file_id=file_id,
        caption_or_text=caption_or_text,
        status="running",
        total_users=len(users),
        sent_count=0,
        blocked_count=0,
        failed_count=0,
        started_at=datetime.now(timezone.utc),
    )
    session.add(broadcast)
    await session.flush()

    for user in users:
        session.add(
            BroadcastRecipient(
                broadcast_id=broadcast.id,
                user_id=user.id,
                telegram_id=user.telegram_id,
                status="pending",
            )
        )

    await session.flush()
    return broadcast


async def _send_single_broadcast_message(
    bot: Bot, broadcast: Broadcast, target_telegram_id: int
) -> None:
    """
    Foydalanuvchiga reklama xabarini protect_content=True bilan yuboradi.
    Avval copy_message ishlatiladi; agar xabar manbasi o'chirilgan bo'lsa,
    saqlangan file_id / matn orqali yuboriladi.
    """
    try:
        await bot.copy_message(
            chat_id=target_telegram_id,
            from_chat_id=broadcast.from_chat_id,
            message_id=broadcast.message_id,
            protect_content=True,
        )
        return
    except TelegramBadRequest as exc:
        # Agar asl xabar chatdan o'chib ketgan bo'lsa, zaxira (fallback) sifatida file_id orqali yuboramiz
        if "message to copy not found" not in str(exc).lower():
            raise

    ctype = broadcast.content_type
    text = broadcast.caption_or_text or ""
    fid = broadcast.file_id

    if ctype == "text":
        await bot.send_message(chat_id=target_telegram_id, text=text, protect_content=True)
    elif ctype == "photo" and fid:
        await bot.send_photo(chat_id=target_telegram_id, photo=fid, caption=text or None, protect_content=True)
    elif ctype == "video" and fid:
        await bot.send_video(chat_id=target_telegram_id, video=fid, caption=text or None, protect_content=True)
    elif ctype == "audio" and fid:
        await bot.send_audio(chat_id=target_telegram_id, audio=fid, caption=text or None, protect_content=True)
    elif ctype == "voice" and fid:
        await bot.send_voice(chat_id=target_telegram_id, voice=fid, caption=text or None, protect_content=True)
    elif ctype == "animation" and fid:
        await bot.send_animation(chat_id=target_telegram_id, animation=fid, caption=text or None, protect_content=True)
    elif ctype == "document" and fid:
        await bot.send_document(chat_id=target_telegram_id, document=fid, caption=text or None, protect_content=True)
    elif ctype == "sticker" and fid:
        await bot.send_sticker(chat_id=target_telegram_id, sticker=fid, protect_content=True)
    else:
        await bot.send_message(chat_id=target_telegram_id, text=text or "📢 Reklama xabari", protect_content=True)


async def _process_broadcast(
    bot: Bot, db: DatabaseManager, config: Config, broadcast_id: int
) -> None:
    """Bitta reklama jo'natmasining barcha 'pending' qabul qiluvchilarini navbat bilan ishlaydi."""
    logger.info("Reklama jo'natmasi #%d bajarilmoqda...", broadcast_id)

    while True:
        async with db.session() as session:
            broadcast = await session.get(Broadcast, broadcast_id)
            if not broadcast or broadcast.status != "running":
                return

            stmt = (
                select(BroadcastRecipient)
                .where(
                    BroadcastRecipient.broadcast_id == broadcast_id,
                    BroadcastRecipient.status == "pending",
                )
                .order_by(BroadcastRecipient.id.asc())
                .limit(25)
            )
            batch = list((await session.scalars(stmt)).all())

            if not batch:
                broadcast.status = "completed"
                broadcast.completed_at = datetime.now(timezone.utc)
                summary_text = (
                    f"✅ <b>Reklama jo‘natmasi #{broadcast.id} yakunlandi!</b>\n\n"
                    f"👥 Jami qabul qiluvchilar: <b>{broadcast.total_users}</b> ta\n"
                    f"📬 Muvaffaqiyatli yetkazildi: <b>{broadcast.sent_count}</b> ta\n"
                    f"🚫 Botni bloklaganlar: <b>{broadcast.blocked_count}</b> ta\n"
                    f"⚠️ Xatolik yuz berganlar: <b>{broadcast.failed_count}</b> ta"
                )
                try:
                    await bot.send_message(chat_id=config.admin_id, text=summary_text)
                except TelegramAPIError as exc:
                    logger.warning("Adminga reklama hisobotini yuborishda xato: %s", exc)
                return

            for recipient in batch:
                now = datetime.now(timezone.utc)
                try:
                    await _send_single_broadcast_message(bot, broadcast, recipient.telegram_id)
                    recipient.status = "sent"
                    recipient.processed_at = now
                    broadcast.sent_count += 1
                    await session.execute(
                        update(User)
                        .where(User.id == recipient.user_id)
                        .values(is_blocked=False)
                    )
                except TelegramRetryAfter as retry_exc:
                    wait_sec = float(retry_exc.retry_after) + 1.0
                    logger.warning("Telegram flood limit! %.1f soniya kutilmoqda...", wait_sec)
                    await asyncio.sleep(wait_sec)
                    # Qayta urinib ko'ramiz
                    try:
                        await _send_single_broadcast_message(bot, broadcast, recipient.telegram_id)
                        recipient.status = "sent"
                        recipient.processed_at = datetime.now(timezone.utc)
                        broadcast.sent_count += 1
                    except Exception as inner_exc:
                        recipient.status = "failed"
                        recipient.error_message = str(inner_exc)[:500]
                        recipient.processed_at = datetime.now(timezone.utc)
                        broadcast.failed_count += 1
                except TelegramForbiddenError as exc:
                    recipient.status = "blocked"
                    recipient.error_message = str(exc)[:500]
                    recipient.processed_at = now
                    broadcast.blocked_count += 1
                    await session.execute(
                        update(User)
                        .where(User.id == recipient.user_id)
                        .values(is_blocked=True)
                    )
                except Exception as exc:
                    recipient.status = "failed"
                    recipient.error_message = str(exc)[:500]
                    recipient.processed_at = now
                    broadcast.failed_count += 1

                await asyncio.sleep(config.broadcast_delay_seconds)


async def broadcast_queue_worker(
    bot: Bot, db: DatabaseManager, config: Config, stop_event: asyncio.Event
) -> None:
    """
    Orqa fonda doimiy ishlovchi navbat tizimi.
    Bot qayta ishga tushganda 'running' yoki 'pending' holatdagi reklamalarni
    avtomatik topib, to'xtagan joyidan davom ettiradi.
    """
    logger.info("Reklama navbat tizimi (broadcast worker) ishga tushdi.")
    while not stop_event.is_set():
        try:
            async with db.session() as session:
                active_broadcast = await session.scalar(
                    select(Broadcast)
                    .where(Broadcast.status.in_(["running", "pending"]))
                    .order_by(Broadcast.id.asc())
                    .limit(1)
                )
                if active_broadcast:
                    if active_broadcast.status == "pending":
                        active_broadcast.status = "running"
                        active_broadcast.started_at = datetime.now(timezone.utc)
                    b_id = active_broadcast.id
                else:
                    b_id = None

            if b_id is not None:
                await _process_broadcast(bot, db, config, b_id)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Broadcast worker xatoligi: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            continue
    logger.info("Reklama navbat tizimi to'xtatildi.")
