"""
WORKING CODE — 8.5. XABARLAR (Kontentlar va Maxsus Kodlar) bo'limi.
- Matn, rasm, video, audio, ovozli xabar, animatsiya, hujjat, stiker va albomlarni saqlash
- Noyob maxsus kod biriktirish
- Mavjud xabarlarni sahifalab ko'rish, qidirish, kodni o'zgartirish va o'chirish
- Har bir harakatni AuditLog'ga yozish
"""

from __future__ import annotations

import html
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import Config
from handlers.states import ContentManageStates
from handlers.user import _send_content_to_user
from keyboards.admin_kb import (
    BTN_MESSAGES,
    build_content_collect_kb,
    build_content_detail_kb,
    build_contents_list_kb,
    build_main_admin_kb,
    build_messages_menu_kb,
    build_temp_admin_kb,
)
from keyboards.user_kb import remove_kb
from models import Content, ContentItem, TemporaryAdmin
from services.audit import log_admin_action
from services.security import (
    is_code_conflicting_with_temp_admin,
    is_valid_code_format,
    normalize_code,
)

logger = logging.getLogger(__name__)
router = Router(name="contents_router")

PAGE_SIZE = 8


def _extract_media_from_message(message: Message) -> Optional[Dict[str, Any]]:
    """Telegram xabaridan media turi, file_id va matn/izohni ajratib oladi."""
    if message.photo:
        return {
            "media_type": "photo",
            "file_id": message.photo[-1].file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.video:
        return {
            "media_type": "video",
            "file_id": message.video.file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.audio:
        return {
            "media_type": "audio",
            "file_id": message.audio.file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.voice:
        return {
            "media_type": "voice",
            "file_id": message.voice.file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.animation:
        return {
            "media_type": "animation",
            "file_id": message.animation.file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.document:
        return {
            "media_type": "document",
            "file_id": message.document.file_id,
            "caption": message.html_text if message.caption else None,
            "text_content": None,
        }
    if message.sticker:
        return {
            "media_type": "sticker",
            "file_id": message.sticker.file_id,
            "caption": None,
            "text_content": None,
        }
    if message.text and not message.text.startswith("/"):
        return {
            "media_type": "text",
            "file_id": None,
            "caption": None,
            "text_content": message.html_text,
        }
    return None


def _determine_overall_content_type(items: List[Dict[str, Any]]) -> Tuple[str, bool]:
    if not items:
        return "text", False
    if len(items) == 1:
        return items[0]["media_type"], False
    unique_types = {it["media_type"] for it in items}
    if unique_types.issubset({"photo", "video"}):
        return "album", True
    if len(unique_types) == 1:
        return f"{items[0]['media_type']}_album", True
    return "mixed", True


async def _render_content_detail_text(content: Content, config: Config) -> str:
    dt_str = content.created_at.astimezone(config.tz).strftime("%d.%m.%Y %H:%M")
    return (
        f"📂 <b>Kontent ma’lumotlari</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔑 <b>Maxsus kod:</b> <code>{html.escape(content.code)}</code>\n"
        f"📦 <b>Kontent turi:</b> <b>{html.escape(content.content_type.upper())}</b>\n"
        f"🗂 <b>Elementlar soni:</b> <b>{len(content.items)}</b> ta\n"
        f"👁 <b>Foydalanish statistikasi:</b> <b>{content.usage_count}</b> marta olingan\n"
        f"📅 <b>Qo‘shilgan sana:</b> {dt_str}\n"
        f"👤 <b>Qo‘shgan admin ID:</b> <code>{content.created_by}</code>"
    )


@router.message(F.text == BTN_MESSAGES)
async def show_messages_menu(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await message.answer(
            "⛔️ Sizda ushbu bo‘limga kirish huquqi yo‘q.",
            reply_markup=remove_kb(),
        )
        return

    await state.clear()
    total_codes = await session.scalar(select(func.count(Content.id))) or 0
    await message.answer(
        f"📂 <b>Xabarlar va Maxsus Kodlar bo‘limi</b>\n\n"
        f"• Bazadagi jami kodlar soni: <b>{total_codes}</b> ta.\n"
        f"Quyidagi amallardan birini tanlang:",
        reply_markup=build_messages_menu_kb(),
    )


@router.callback_query(F.data.startswith("adm_msg:"))
async def cb_messages_actions(
    callback: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await callback.answer("⛔️ Ruxsat yo‘q!", show_alert=True)
        return

    actor_role = "main_admin" if is_main_admin else "temp_admin"
    parts = (callback.data or "").split(":")
    action = parts[1] if len(parts) > 1 else ""

    if action == "noop":
        await callback.answer()
        return

    if action == "back":
        await state.clear()
        await callback.answer("Bosh menyu")
        if callback.message:
            await callback.message.delete()
            kb = build_main_admin_kb() if is_main_admin else build_temp_admin_kb()
            await callback.bot.send_message(
                chat_id=callback.from_user.id,
                text="🏠 <b>Boshqaruv paneli:</b>",
                reply_markup=kb,
            )
        return

    if action == "menu":
        await state.clear()
        total_codes = await session.scalar(select(func.count(Content.id))) or 0
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                f"📂 <b>Xabarlar va Maxsus Kodlar bo‘limi ({total_codes} ta kod):</b>",
                reply_markup=build_messages_menu_kb(),
            )
        return

    if action == "add":
        await state.clear()
        await state.update_data(collected_items=[])
        await state.set_state(ContentManageStates.collecting_items)
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                "➕ <b>Yangi xabar (kontent) qo‘shish:</b>\n\n"
                "1️⃣ Menga saqlamoqchi bo‘lgan kontentingizni yuboring:\n"
                "   • Matn, rasm, video, audio, ovozli xabar, animatsiya (GIF), hujjat yoki stiker;\n"
                "   • Bir nechta fayl yoki albom yuborishingiz ham mumkin.\n\n"
                "2️⃣ Barcha fayllarni yuborib bo‘lgach, <b>«✅ Tayyor — Kod biriktirish»</b> tugmasini bosing.",
                reply_markup=build_content_collect_kb(0),
            )
        return

    if action == "cancel_add":
        await state.clear()
        await callback.answer("Bekor qilindi")
        if callback.message:
            await callback.message.edit_text(
                "❌ Xabar qo‘shish bekor qilindi.",
                reply_markup=build_messages_menu_kb(),
            )
        return

    if action == "finish_items":
        data = await state.get_data()
        items: List[Dict[str, Any]] = data.get("collected_items", [])
        if not items:
            await callback.answer("Avval kamida 1 ta xabar yoki fayl yuboring!", show_alert=True)
            return

        await state.set_state(ContentManageStates.waiting_for_code)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                f"🔑 <b>Endi ushbu {len(items)} ta element uchun noyob MAXSUS KOD kiriting:</b>\n\n"
                f"Masalan: <code>VIDEO2026</code> yoki <code>DARS_01</code>\n"
                f"<i>(Katta-kichik harflar farq qilmaydi, bazada avtomatik katta harflarda saqlanadi)</i>"
            )
        return

    if action == "list":
        page = int(parts[2]) if len(parts) >= 3 and parts[2].isdigit() else 0
        total = await session.scalar(select(func.count(Content.id))) or 0
        if total == 0:
            await callback.answer()
            if callback.message:
                await callback.message.edit_text(
                    "📋 <b>Hozircha saqlangan xabarlar va kodlar mavjud emas.</b>",
                    reply_markup=build_messages_menu_kb(),
                )
            return

        total_pages = max(1, math.ceil(total / PAGE_SIZE))
        page = max(0, min(page, total_pages - 1))

        stmt = (
            select(Content)
            .options(selectinload(Content.items))
            .order_by(Content.id.desc())
            .offset(page * PAGE_SIZE)
            .limit(PAGE_SIZE)
        )
        contents = list((await session.scalars(stmt)).all())

        lines = [f"📋 <b>Mavjud xabarlar ro‘yxati (Jami: {total} ta):</b>\n"]
        for c in contents:
            dt_s = c.created_at.astimezone(config.tz).strftime("%d.%m.%Y")
            lines.append(
                f"• <code>{html.escape(c.code)}</code> — {html.escape(c.content_type.upper())} "
                f"({len(c.items)} el.) | 📅 {dt_s} | 👁 {c.usage_count}"
            )
        lines.append("\n👇 Batafsil ko‘rish yoki tahrirlash uchun kod ustiga bosing:")

        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                "\n".join(lines),
                reply_markup=build_contents_list_kb(contents, page, total_pages),
            )
        return

    if action == "view" and len(parts) >= 3:
        content_id = int(parts[2])
        page = int(parts[3]) if len(parts) >= 4 and parts[3].isdigit() else 0
        content = await session.scalar(
            select(Content)
            .options(selectinload(Content.items))
            .where(Content.id == content_id)
        )
        if not content:
            await callback.answer("Kontent topilmadi!", show_alert=True)
            return

        detail_text = await _render_content_detail_text(content, config)
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                detail_text,
                reply_markup=build_content_detail_kb(content.id, page),
            )
        return

    if action == "preview" and len(parts) >= 3:
        content_id = int(parts[2])
        content = await session.scalar(
            select(Content)
            .options(selectinload(Content.items))
            .where(Content.id == content_id)
        )
        if not content:
            await callback.answer("Kontent topilmadi!", show_alert=True)
            return

        await callback.answer("Kontent yuborilmoqda...")
        await _send_content_to_user(callback.bot, callback.from_user.id, content)
        return

    if action == "editcode" and len(parts) >= 3:
        content_id = int(parts[2])
        page = int(parts[3]) if len(parts) >= 4 and parts[3].isdigit() else 0
        content = await session.get(Content, content_id)
        if not content:
            await callback.answer("Kontent topilmadi!", show_alert=True)
            return

        await state.update_data(edit_content_id=content.id, edit_content_page=page)
        await state.set_state(ContentManageStates.waiting_for_new_code_edit)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                f"✏️ <b>«{html.escape(content.code)}»</b> kodi uchun yangi noyob kodni yozib yuboring:"
            )
        return

    if action == "del" and len(parts) >= 3:
        content_id = int(parts[2])
        page = int(parts[3]) if len(parts) >= 4 and parts[3].isdigit() else 0
        content = await session.get(Content, content_id)
        if not content:
            await callback.answer("Kontent topilmadi!", show_alert=True)
            return

        deleted_code = content.code
        await session.delete(content)
        await session.flush()

        await log_admin_action(
            session=session,
            actor_telegram_id=callback.from_user.id,
            actor_role=actor_role,
            action="DELETE_CONTENT",
            target_type="content",
            target_id=deleted_code,
            details=f"«{deleted_code}» kodi va unga biriktirilgan kontent o'chirildi",
        )
        await callback.answer(f"🗑 «{deleted_code}» o‘chirildi!", show_alert=True)
        if callback.message:
            await callback.message.edit_text(
                f"✅ <b>«{html.escape(deleted_code)}»</b> kodi va uning barcha fayllari bazadan o‘chirildi.",
                reply_markup=build_messages_menu_kb(),
            )
        return

    if action == "search":
        await state.set_state(ContentManageStates.waiting_for_search_code)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                "🔎 <b>Qidirilayotgan maxsus kodni yozib yuboring:</b>"
            )
        return


@router.message(ContentManageStates.collecting_items)
async def collect_content_item_handler(
    message: Message,
    state: FSMContext,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await state.clear()
        return

    item_data = _extract_media_from_message(message)
    if item_data is None:
        await message.answer(
            "⚠️ Ushbu xabar turi qo‘llab-quvvatlanmaydi. Matn, rasm, video, audio, ovozli xabar, "
            "animatsiya, hujjat yoki stiker yuboring."
        )
        return

    data = await state.get_data()
    items: List[Dict[str, Any]] = list(data.get("collected_items", []))
    items.append(item_data)
    await state.update_data(collected_items=items)

    await message.answer(
        f"✅ <b>{len(items)}-element qabul qilindi ({item_data['media_type'].upper()}).</b>\n\n"
        f"• Albom yoki qo‘shimcha fayl bo‘lsa, yana yuborishda davom eting.\n"
        f"• Tugatgan bo‘lsangiz, pastdagi <b>«✅ Tayyor — Kod biriktirish»</b> tugmasini bosing:",
        reply_markup=build_content_collect_kb(len(items)),
    )


@router.message(ContentManageStates.waiting_for_code)
async def save_content_with_code_handler(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await state.clear()
        return

    code = normalize_code(message.text or "")
    if not is_valid_code_format(code):
        await message.answer(
            "❌ <b>Kod formati noto‘g‘ri!</b>\n"
            "Kod 2 tadan 64 tagacha harf, raqam, '-' yoki '_' belgilaridan iborat bo‘lishi kerak. Qaytadan kiriting:"
        )
        return

    if await is_code_conflicting_with_temp_admin(session, code, config):
        await message.answer(
            "❌ Ushbu kod vaqtinchalik admin maxfiy kodi sifatida band qilingan! Boshqa kod kiriting:"
        )
        return

    existing = await session.scalar(select(Content).where(Content.code == code))
    if existing is not None:
        await message.answer(
            f"❌ <b>«{html.escape(code)}»</b> kodi allaqachon mavjud! "
            f"Kod takrorlanmasligi shart. Iltimos, boshqa noyob kod kiriting:"
        )
        return

    data = await state.get_data()
    items: List[Dict[str, Any]] = list(data.get("collected_items", []))
    if not items:
        await state.clear()
        await message.answer("❌ Saqlash uchun kontent topilmadi.", reply_markup=build_messages_menu_kb())
        return

    overall_type, is_album = _determine_overall_content_type(items)
    new_content = Content(
        code=code,
        content_type=overall_type,
        is_album=is_album,
        usage_count=0,
        created_by=message.from_user.id,
    )
    session.add(new_content)
    await session.flush()

    for idx, it in enumerate(items):
        session.add(
            ContentItem(
                content_id=new_content.id,
                item_order=idx,
                media_type=it["media_type"],
                file_id=it["file_id"],
                text_content=it["text_content"],
                caption=it["caption"],
            )
        )

    await session.flush()
    actor_role = "main_admin" if is_main_admin else "temp_admin"
    await log_admin_action(
        session=session,
        actor_telegram_id=message.from_user.id,
        actor_role=actor_role,
        action="CREATE_CONTENT",
        target_type="content",
        target_id=code,
        details=f"Yangi kontent saqlandi: code={code}, type={overall_type}, items={len(items)}",
    )

    await state.clear()
    await message.answer(
        f"🎉 <b>Kontent va maxsus kod muvaffaqiyatli saqlandi!</b>\n\n"
        f"🔑 <b>Maxsus kod:</b> <code>{html.escape(code)}</code>\n"
        f"📦 <b>Kontent turi:</b> {html.escape(overall_type.upper())}\n"
        f"🗂 <b>Elementlar soni:</b> {len(items)} ta",
        reply_markup=build_messages_menu_kb(),
    )


@router.message(ContentManageStates.waiting_for_new_code_edit)
async def handle_edit_content_code(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await state.clear()
        return

    new_code = normalize_code(message.text or "")
    if not is_valid_code_format(new_code):
        await message.answer("❌ Kod formati noto‘g‘ri! 2..64 ta harf yoki raqam kiriting:")
        return

    if await is_code_conflicting_with_temp_admin(session, new_code, config):
        await message.answer("❌ Ushbu kod maxfiy tizim kodi bilan to‘qnashadi. Boshqa kod tanlang:")
        return

    data = await state.get_data()
    content_id = data.get("edit_content_id")
    page = data.get("edit_content_page", 0)

    content = await session.scalar(
        select(Content).options(selectinload(Content.items)).where(Content.id == content_id)
    )
    if not content:
        await state.clear()
        await message.answer("❌ Kontent topilmadi.", reply_markup=build_messages_menu_kb())
        return

    duplicate = await session.scalar(
        select(Content).where(Content.code == new_code, Content.id != content.id)
    )
    if duplicate:
        await message.answer(f"❌ «{html.escape(new_code)}» kodi boshqa kontentda band! Yangi kod kiriting:")
        return

    old_code = content.code
    content.code = new_code
    await session.flush()

    actor_role = "main_admin" if is_main_admin else "temp_admin"
    await log_admin_action(
        session=session,
        actor_telegram_id=message.from_user.id,
        actor_role=actor_role,
        action="EDIT_CONTENT_CODE",
        target_type="content",
        target_id=new_code,
        details=f"Kontent kodi o'zgartirildi: {old_code} -> {new_code}",
    )

    await state.clear()
    detail_text = await _render_content_detail_text(content, config)
    await message.answer(
        f"✅ Kod <b>{html.escape(old_code)}</b> dan <b>{html.escape(new_code)}</b> ga muvaffaqiyatli o‘zgartirildi!\n\n"
        + detail_text,
        reply_markup=build_content_detail_kb(content.id, page),
    )


@router.message(ContentManageStates.waiting_for_search_code)
async def handle_search_content_by_code(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    if not is_main_admin and temp_admin is None:
        await state.clear()
        return

    code = normalize_code(message.text or "")
    content = await session.scalar(
        select(Content).options(selectinload(Content.items)).where(Content.code == code)
    )
    if not content:
        await message.answer(
            f"🔍 <b>«{html.escape(code)}»</b> kodi bazadan topilmadi. Boshqa kod yozing yoki /start bosing:"
        )
        return

    await state.clear()
    detail_text = await _render_content_detail_text(content, config)
    await message.answer(
        detail_text,
        reply_markup=build_content_detail_kb(content.id, 0),
    )
