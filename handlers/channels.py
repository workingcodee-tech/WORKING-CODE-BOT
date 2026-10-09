"""
WORKING CODE — 8.4. KANALLAR bo'limi (1 tadan 10 tagacha majburiy kanalni qo'shish,
ko'rish, o'zgartirish va o'chirish).
Faqat Asosiy Admin (ADMIN_ID) boshqara oladi.
"""

from __future__ import annotations

import html
import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from handlers.states import ChannelManageStates
from keyboards.admin_kb import (
    BTN_CHANNELS,
    build_channel_selector_kb,
    build_channels_menu_kb,
    build_main_admin_kb,
)
from models import Channel
from services.audit import log_admin_action
from services.subscription import get_active_channels, verify_and_resolve_channel

logger = logging.getLogger(__name__)
router = Router(name="channels_router")


@router.message(F.text == BTN_CHANNELS)
async def show_channels_menu(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await message.answer(
            "⛔️ <b>Ruxsat yo‘q!</b> Majburiy kanallarni faqat Asosiy Administrator boshqara oladi."
        )
        return

    await state.clear()
    channels = await get_active_channels(session)
    await message.answer(
        f"📡 <b>Majburiy kanallarni boshqarish bo‘limi</b>\n\n"
        f"• Faol kanallar soni: <b>{len(channels)} / {config.max_channels}</b> ta\n"
        f"• Ruxsat etilgan me’yor: <b>{config.min_channels}–{config.max_channels}</b> ta kanal.\n\n"
        f"Kerakli amalni tanlang:",
        reply_markup=build_channels_menu_kb(),
    )


@router.callback_query(F.data.startswith("adm_ch:"))
async def cb_channels_actions(
    callback: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await callback.answer("⛔️ Faqat Asosiy Admin uchun!", show_alert=True)
        return

    parts = (callback.data or "").split(":")
    action = parts[1] if len(parts) > 1 else ""

    if action == "back":
        await state.clear()
        await callback.answer("Asosiy menyu")
        if callback.message:
            await callback.message.delete()
            await callback.bot.send_message(
                chat_id=callback.from_user.id,
                text="🏠 <b>Asosiy Admin bosh menyusi:</b>",
                reply_markup=build_main_admin_kb(),
            )
        return

    if action == "menu":
        await state.clear()
        channels = await get_active_channels(session)
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                f"📡 <b>Majburiy kanallarni boshqarish ({len(channels)}/{config.max_channels}):</b>",
                reply_markup=build_channels_menu_kb(),
            )
        return

    if action == "list":
        channels = await get_active_channels(session)
        await callback.answer()
        if not channels:
            if callback.message:
                await callback.message.edit_text(
                    "📋 <b>Hozircha majburiy kanallar qo‘shilmagan.</b>\n\n"
                    "Yangi kanal qo‘shish uchun <b>«➕ Kanal qo‘shish»</b> tugmasini bosing:",
                    reply_markup=build_channels_menu_kb(),
                )
            return

        lines = [f"📋 <b>Majburiy kanallar ro‘yxati ({len(channels)}/{config.max_channels}):</b>\n"]
        for idx, ch in enumerate(channels, start=1):
            uname = f"@{html.escape(ch.username)}" if ch.username else "Yopiq kanal"
            lines.append(
                f"{idx}. <b>{html.escape(ch.title)}</b>\n"
                f"   • ID: <code>{ch.channel_id}</code> | Username: {uname}\n"
                f"   • Havola: {html.escape(ch.invite_link)}"
            )
        if callback.message:
            await callback.message.edit_text(
                "\n\n".join(lines),
                reply_markup=build_channels_menu_kb(),
                disable_web_page_preview=True,
            )
        return

    if action == "add":
        count = (
            await session.scalar(
                select(func.count(Channel.id)).where(Channel.is_active.is_(True))
            )
            or 0
        )
        if count >= config.max_channels:
            await callback.answer(
                f"❌ Maksimal {config.max_channels} ta kanal qo‘shish mumkin! Avval birortasini o‘chiring.",
                show_alert=True,
            )
            return

        await state.set_state(ChannelManageStates.waiting_for_new_channel)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                "➕ <b>Yangi majburiy kanal qo‘shish:</b>\n\n"
                "1️⃣ Avval botni o‘sha kanalga <b>Administrator</b> qilib tayinlang.\n"
                "2️⃣ Kanalning <code>@username</code> manzilini, <code>https://t.me/kanal_nomi</code> "
                "havolasini yoki kanal ID raqamini (masalan: <code>-1001234567890</code>) yuboring:"
            )
        return

    if action == "edit_select":
        channels = await get_active_channels(session)
        if not channels:
            await callback.answer("O‘zgartirish uchun kanallar yo‘q!", show_alert=True)
            return
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                "✏️ <b>O‘zgartirmoqchi bo‘lgan kanalingizni tanlang:</b>",
                reply_markup=build_channel_selector_kb(channels, "adm_ch:edit_id"),
            )
        return

    if action == "edit_id" and len(parts) >= 3:
        ch_db_id = int(parts[2])
        ch = await session.get(Channel, ch_db_id)
        if not ch:
            await callback.answer("Kanal topilmadi!", show_alert=True)
            return
        await state.update_data(edit_channel_db_id=ch.id)
        await state.set_state(ChannelManageStates.waiting_for_edit_channel_data)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                f"✏️ <b>«{html.escape(ch.title)}» kanalini yangilash:</b>\n\n"
                f"Yangi kanal <code>@username</code> / havolasini yuboring (yoki mavjud kanalning "
                f"yangi taklif havolasini kiriting):"
            )
        return

    if action == "del_select":
        channels = await get_active_channels(session)
        if not channels:
            await callback.answer("O‘chirish uchun kanallar yo‘q!", show_alert=True)
            return
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                "🗑 <b>O‘chirmoqchi bo‘lgan kanalingizni tanlang:</b>",
                reply_markup=build_channel_selector_kb(channels, "adm_ch:del_id"),
            )
        return

    if action == "del_id" and len(parts) >= 3:
        ch_db_id = int(parts[2])
        ch = await session.get(Channel, ch_db_id)
        if not ch:
            await callback.answer("Kanal topilmadi!", show_alert=True)
            return

        title = ch.title
        cid = ch.channel_id
        await session.delete(ch)
        await session.flush()

        await log_admin_action(
            session=session,
            actor_telegram_id=config.admin_id,
            actor_role="main_admin",
            action="DELETE_CHANNEL",
            target_type="channel",
            target_id=str(cid),
            details=f"«{title}» kanali majburiy ro'yxatdan o'chirildi",
        )
        remaining = await get_active_channels(session)
        await callback.answer(f"🗑 «{title}» o‘chirildi!", show_alert=True)
        if callback.message:
            await callback.message.edit_text(
                f"✅ <b>«{html.escape(title)}» kanali o‘chirildi.</b>\n"
                f"Qolgan faol kanallar: <b>{len(remaining)}/{config.max_channels}</b> ta.",
                reply_markup=build_channels_menu_kb(),
            )


@router.message(ChannelManageStates.waiting_for_new_channel)
async def handle_add_channel_input(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    raw_input = (message.text or "").strip()
    count = (
        await session.scalar(
            select(func.count(Channel.id)).where(Channel.is_active.is_(True))
        )
        or 0
    )
    if count >= config.max_channels:
        await state.clear()
        await message.answer(
            f"❌ Maksimal {config.max_channels} ta kanal chegarasiga yetilgan!",
            reply_markup=build_channels_menu_kb(),
        )
        return

    ok, err_or_msg, info = await verify_and_resolve_channel(message.bot, raw_input)
    if not ok:
        await message.answer(err_or_msg)
        return

    existing = await session.scalar(
        select(Channel).where(Channel.channel_id == info["channel_id"])
    )
    if existing:
        existing.title = info["title"]
        existing.username = info["username"]
        existing.invite_link = info["invite_link"]
        existing.is_active = True
        await state.clear()
        await message.answer(
            f"ℹ️ <b>«{html.escape(info['title'])}»</b> kanali allaqachon bazada bor edi, ma’lumotlari yangilandi!",
            reply_markup=build_channels_menu_kb(),
        )
        return

    new_ch = Channel(
        channel_id=info["channel_id"],
        title=info["title"],
        username=info["username"],
        invite_link=info["invite_link"],
        is_active=True,
        added_by=config.admin_id,
    )
    session.add(new_ch)
    await session.flush()

    await log_admin_action(
        session=session,
        actor_telegram_id=config.admin_id,
        actor_role="main_admin",
        action="ADD_CHANNEL",
        target_type="channel",
        target_id=str(info["channel_id"]),
        details=f"Yangi majburiy kanal qo'shildi: {info['title']}",
    )
    await state.clear()
    await message.answer(
        f"✅ <b>Kanal muvaffaqiyatli qo‘shildi!</b>\n\n"
        f"• <b>Nomi:</b> {html.escape(info['title'])}\n"
        f"• <b>Kanal ID:</b> <code>{info['channel_id']}</code>\n"
        f"• <b>Havola:</b> {html.escape(info['invite_link'])}",
        reply_markup=build_channels_menu_kb(),
        disable_web_page_preview=True,
    )


@router.message(ChannelManageStates.waiting_for_edit_channel_data)
async def handle_edit_channel_input(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    data = await state.get_data()
    ch_db_id = data.get("edit_channel_db_id")
    ch = await session.get(Channel, ch_db_id) if ch_db_id else None
    if not ch:
        await state.clear()
        await message.answer("❌ Tahrirlanayotgan kanal topilmadi.", reply_markup=build_channels_menu_kb())
        return

    raw_input = (message.text or "").strip()
    ok, err_or_msg, info = await verify_and_resolve_channel(message.bot, raw_input)
    if not ok:
        await message.answer(err_or_msg)
        return

    # Boshqa kanal bilan ID to'qnashmasligini tekshiramiz
    duplicate = await session.scalar(
        select(Channel).where(
            Channel.channel_id == info["channel_id"],
            Channel.id != ch.id,
        )
    )
    if duplicate:
        await message.answer("❌ Ushbu kanal ro‘yxatda allaqachon mavjud!")
        return

    old_title = ch.title
    ch.channel_id = info["channel_id"]
    ch.title = info["title"]
    ch.username = info["username"]
    ch.invite_link = info["invite_link"]

    await log_admin_action(
        session=session,
        actor_telegram_id=config.admin_id,
        actor_role="main_admin",
        action="EDIT_CHANNEL",
        target_type="channel",
        target_id=str(ch.channel_id),
        details=f"Kanal o'zgartirildi: {old_title} -> {ch.title}",
    )
    await state.clear()
    await message.answer(
        f"✅ <b>Kanal muvaffaqiyatli yangilandi!</b>\n\n"
        f"• <b>Yangi nomi:</b> {html.escape(ch.title)}\n"
        f"• <b>Kanal ID:</b> <code>{ch.channel_id}</code>\n"
        f"• <b>Havola:</b> {html.escape(ch.invite_link)}",
        reply_markup=build_channels_menu_kb(),
        disable_web_page_preview=True,
    )
