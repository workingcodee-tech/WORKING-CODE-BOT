"""
WORKING CODE — 8.3. REKLAMA (Ommaviy xabar yuborish) bo'limi.
Faqat Asosiy Admin (ADMIN_ID) foydalana oladi.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from handlers.contents import _extract_media_from_message
from handlers.states import BroadcastStates
from keyboards.admin_kb import (
    BTN_BROADCAST,
    build_broadcast_confirm_kb,
    build_main_admin_kb,
)
from models import User
from services.audit import log_admin_action
from services.broadcast import create_broadcast_job

logger = logging.getLogger(__name__)
router = Router(name="broadcast_router")


@router.message(F.text == BTN_BROADCAST)
async def start_broadcast_flow(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await message.answer(
            "⛔️ <b>Ruxsat yo‘q!</b> Ommaviy reklama yuborish huquqi faqat Asosiy Administratorda mavjud."
        )
        return

    total_users = await session.scalar(select(func.count(User.id))) or 0
    await state.set_state(BroadcastStates.waiting_for_broadcast_content)
    await message.answer(
        f"📢 <b>Reklama yuborish bo‘limi</b>\n\n"
        f"• Bazadagi jami qabul qiluvchilar: <b>{total_users}</b> ta foydalanuvchi.\n\n"
        f"Reklama uchun istalgan turdagi kontentni (matn, rasm, video, audio, hujjat, "
        f"animatsiya, ovozli xabar) yuboring.\n"
        f"<i>Bekor qilish uchun /start buyrug‘ini bosing.</i>"
    )


@router.message(BroadcastStates.waiting_for_broadcast_content)
async def preview_broadcast_content(
    message: Message,
    state: FSMContext,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    extracted = _extract_media_from_message(message)
    if extracted is None:
        await message.answer(
            "⚠️ Iltimos, reklama uchun matn, rasm, video, audio, ovozli xabar, animatsiya yoki hujjat yuboring:"
        )
        return

    await state.update_data(
        bc_content_type=extracted["media_type"],
        bc_from_chat_id=message.chat.id,
        bc_message_id=message.message_id,
        bc_file_id=extracted["file_id"],
        bc_caption_or_text=extracted["text_content"] or extracted["caption"],
    )
    await state.set_state(BroadcastStates.waiting_for_confirmation)

    # Adminga xabarni oldindan ko'rsatamiz (preview)
    try:
        await message.bot.copy_message(
            chat_id=message.chat.id,
            from_chat_id=message.chat.id,
            message_id=message.message_id,
            protect_content=True,
        )
    except TelegramAPIError as exc:
        logger.warning("Preview copy_message xatoligi: %s", exc)

    await message.answer(
        "👆 <b>Yuqoridagi xabar barcha foydalanuvchilarga reklama sifatida yuboriladi.</b>\n\n"
        "Tasdiqlaysizmi?",
        reply_markup=build_broadcast_confirm_kb(),
    )


@router.callback_query(BroadcastStates.waiting_for_confirmation, F.data.startswith("adm_bc:"))
async def confirm_or_cancel_broadcast(
    callback: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await callback.answer("⛔️ Faqat Asosiy Admin uchun!", show_alert=True)
        return

    action = (callback.data or "").split(":")[1]
    if action == "cancel":
        await state.clear()
        await callback.answer("Reklama bekor qilindi")
        if callback.message:
            await callback.message.edit_text("❌ <b>Reklama yuborish bekor qilindi.</b>")
        return

    if action == "confirm":
        data = await state.get_data()
        await state.clear()

        broadcast = await create_broadcast_job(
            session=session,
            admin_id=config.admin_id,
            content_type=data["bc_content_type"],
            from_chat_id=data["bc_from_chat_id"],
            message_id=data["bc_message_id"],
            file_id=data.get("bc_file_id"),
            caption_or_text=data.get("bc_caption_or_text"),
        )

        await log_admin_action(
            session=session,
            actor_telegram_id=config.admin_id,
            actor_role="main_admin",
            action="START_BROADCAST",
            target_type="broadcast",
            target_id=str(broadcast.id),
            details=f"Reklama #{broadcast.id} navbatga qo'yildi ({broadcast.total_users} ta foydalanuvchi)",
        )

        await callback.answer("🚀 Reklama navbatga qo‘yildi!")
        if callback.message:
            await callback.message.edit_text(
                f"🚀 <b>Reklama jo‘natmasi #{broadcast.id} boshlandi!</b>\n\n"
                f"👥 Jami navbatdagi foydalanuvchilar: <b>{broadcast.total_users}</b> ta.\n"
                f"🔒 Kontent himoyasi (<code>protect_content=True</code>) yoqilgan.\n"
                f"📊 Jarayon yakunida sizga to‘liq hisobot yuboriladi.",
            )
            await callback.bot.send_message(
                chat_id=config.admin_id,
                text="🏠 Bosh menyu:",
                reply_markup=build_main_admin_kb(),
            )
