"""
WORKING CODE — Asosiy Admin boshqaruv paneli:
- 📊 Statistika (12 ta ko'rsatkich, haqiqiy baza ma'lumotlari asosida)
- 👥 Foydalanuvchilar (bittadan sahifalash, ID bo'yicha qidirish, maxfiy ma'lumotlar — faqat asosiy admin uchun)
- 🔐 Maxfiy kod va sozlamalar (30 daqiqalik vaqtinchalik admin kodi, o'chirish muddati, audit loglar)
"""

from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta, timezone

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import Config
from handlers.states import AdminUserSearchStates, SecuritySettingsStates
from keyboards.admin_kb import (
    BTN_SECURITY_SETTINGS,
    BTN_STATS,
    BTN_USERS,
    build_main_admin_kb,
    build_security_settings_kb,
    build_temp_admin_alert_kb,
    build_temp_admin_kb,
    build_users_pagination_kb,
)
from keyboards.user_kb import remove_kb
from models import (
    AuditLog,
    BotSetting,
    Broadcast,
    Content,
    ContentAccessLog,
    TemporaryAdmin,
    User,
)
from services.audit import log_admin_action
from services.cleanup import get_delete_delay_seconds, set_delete_delay_seconds
from services.security import (
    TEMP_ADMIN_PLAIN_HINT_KEY,
    set_temp_admin_code,
)

logger = logging.getLogger(__name__)
router = Router(name="admin_router")


def _format_dt(dt: datetime | None, config: Config) -> str:
    if dt is None:
        return "Mavjud emas"
    return dt.astimezone(config.tz).strftime("%d.%m.%Y %H:%M:%S")


async def _format_user_card(
    session: AsyncSession, user: User, index: int, total: int, config: Config
) -> str:
    """
    8.2. FOYDALANUVCHILAR bo'limi uchun bitta foydalanuvchining barcha ma'lumotlarini formatlaydi.
    """
    now = datetime.now(timezone.utc)
    active_temp = await session.scalar(
        select(TemporaryAdmin)
        .where(
            TemporaryAdmin.telegram_id == user.telegram_id,
            TemporaryAdmin.is_active.is_(True),
            TemporaryAdmin.expires_at > now,
        )
        .order_by(TemporaryAdmin.expires_at.desc())
    )

    if active_temp:
        temp_status = f"✅ Faol ({_format_dt(active_temp.expires_at, config)} gacha)"
    else:
        temp_status = "❌ Yo‘q"

    username_display = f"@{html.escape(user.username)}" if user.username else "Mavjud emas"
    last_name_display = html.escape(user.last_name) if user.last_name else "—"
    phone_display = html.escape(user.phone_number) if user.phone_number else "Tasdiqlanmagan"

    return (
        f"👤 <b>Foydalanuvchi ma’lumotlari ({index + 1} / {max(1, total)})</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🆔 <b>Telegram ID:</b> <code>{user.telegram_id}</code>\n"
        f"🙍‍♂️ <b>Ism:</b> {html.escape(user.first_name)}\n"
        f"🙍‍♂️ <b>Familiya:</b> {last_name_display}\n"
        f"🔗 <b>Username:</b> {username_display}\n"
        f"📞 <b>Telefon raqami:</b> <code>{phone_display}</code>\n"
        f"📅 <b>Birinchi kirgan vaqti:</b> {_format_dt(user.joined_at, config)}\n"
        f"🕒 <b>Oxirgi faolligi:</b> {_format_dt(user.last_active_at, config)}\n"
        f"📡 <b>Kanal obunasi holati:</b> {'✅ Obuna bo‘lgan' if user.is_subscribed_all else '❌ Obuna bo‘lmagan'}\n"
        f"📱 <b>Telefon tasdig‘i holati:</b> {'✅ Tasdiqlangan' if user.is_phone_verified else '❌ Tasdiqlanmagan'}\n"
        f"🛡 <b>Vaqtinchalik admin huquqi:</b> {temp_status}"
    )


@router.message(F.text == BTN_STATS)
async def show_statistics_handler(
    message: Message,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    """
    8.1. STATISTIKA:
    Bazadagi haqiqiy ma'lumotlar asosida barcha ko'rsatkichlarni hisoblaydi.
    """
    if not is_main_admin and temp_admin is None:
        await message.answer(
            "⛔️ Sizda ushbu bo‘limni ko‘rish huquqi yo‘q.",
            reply_markup=remove_kb(),
        )
        return

    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(config.tz)
    start_of_today_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_today_utc = start_of_today_local.astimezone(timezone.utc)
    active_threshold_utc = now_utc - timedelta(days=7)

    total_users = await session.scalar(select(func.count(User.id))) or 0
    today_users = (
        await session.scalar(
            select(func.count(User.id)).where(User.joined_at >= start_of_today_utc)
        )
        or 0
    )
    sub_users = (
        await session.scalar(
            select(func.count(User.id)).where(User.is_subscribed_all.is_(True))
        )
        or 0
    )
    unsub_users = max(0, total_users - sub_users)

    phone_verified = (
        await session.scalar(
            select(func.count(User.id)).where(User.is_phone_verified.is_(True))
        )
        or 0
    )
    phone_unverified = max(0, total_users - phone_verified)

    active_users = (
        await session.scalar(
            select(func.count(User.id)).where(
                User.is_blocked.is_(False),
                User.last_active_at >= active_threshold_utc,
            )
        )
        or 0
    )

    temp_admins_count = (
        await session.scalar(
            select(func.count(TemporaryAdmin.id)).where(
                TemporaryAdmin.is_active.is_(True),
                TemporaryAdmin.expires_at > now_utc,
            )
        )
        or 0
    )

    total_contents = await session.scalar(select(func.count(Content.id))) or 0
    total_deliveries = await session.scalar(select(func.count(ContentAccessLog.id))) or 0

    total_broadcasts = await session.scalar(select(func.count(Broadcast.id))) or 0
    bc_sent = await session.scalar(select(func.coalesce(func.sum(Broadcast.sent_count), 0))) or 0
    bc_blocked = (
        await session.scalar(select(func.coalesce(func.sum(Broadcast.blocked_count), 0))) or 0
    )
    bc_failed = (
        await session.scalar(select(func.coalesce(func.sum(Broadcast.failed_count), 0))) or 0
    )

    if temp_admin is not None and not is_main_admin:
        await log_admin_action(
            session=session,
            actor_telegram_id=temp_admin.telegram_id,
            actor_role="temp_admin",
            action="VIEW_STATISTICS",
            details="Vaqtinchalik admin statistikani ko'rdi",
        )

    stats_text = (
        f"📊 <b>WORKING CODE — Tizim Statistikasi</b>\n"
        f"🕒 Sana: <code>{now_local.strftime('%d.%m.%Y %H:%M')}</code>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👥 <b>Foydalanuvchilar:</b>\n"
        f"• Jami ro‘yxatdan o‘tganlar: <b>{total_users}</b> ta\n"
        f"• Bugun qo‘shilganlar: <b>{today_users}</b> ta\n"
        f"• Barcha kanallarga obuna bo‘lganlar: <b>{sub_users}</b> ta\n"
        f"• Obuna bo‘lmaganlar: <b>{unsub_users}</b> ta\n"
        f"• Telefon raqamini tasdiqlaganlar: <b>{phone_verified}</b> ta\n"
        f"• Telefon raqamini tasdiqlamaganlar: <b>{phone_unverified}</b> ta\n"
        f"• Faol foydalanuvchilar: <b>{active_users}</b> ta\n"
        f"• Vaqtinchalik adminlar (faol): <b>{temp_admins_count}</b> ta\n\n"
        f"📂 <b>Kontent va Kodlar:</b>\n"
        f"• Jami kontentlar va kodlar: <b>{total_contents}</b> ta\n"
        f"• Kontent yuborilishlari soni: <b>{total_deliveries}</b> marta\n\n"
        f"📢 <b>Reklama yuborish statistikasi:</b>\n"
        f"• Jami reklama kampaniyalari: <b>{total_broadcasts}</b> ta\n"
        f"• Muvaffaqiyatli yetkazilgan: <b>{bc_sent}</b> ta\n"
        f"• Botni bloklagan foydalanuvchilar: <b>{bc_blocked}</b> ta\n"
        f"• Xatolik qaytarganlar: <b>{bc_failed}</b> ta"
    )
    await message.answer(stats_text)


@router.message(F.text == BTN_USERS)
async def show_users_handler(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    """
    8.2. FOYDALANUVCHILAR:
    Faqat asosiy admin ko'ra oladi. Vaqtinchalik adminlarga ruxsat berilmaydi.
    """
    if not is_main_admin:
        await message.answer(
            "⛔️ <b>Ruxsat yo‘q!</b> Foydalanuvchilarning shaxsiy ma’lumotlari va telefon raqamlarini "
            "faqat Asosiy Administrator ko‘ra oladi."
        )
        return

    await state.clear()
    total = await session.scalar(select(func.count(User.id))) or 0
    if total == 0:
        await message.answer("👥 Bazada hozircha ro‘yxatdan o‘tgan foydalanuvchilar yo‘q.")
        return

    first_user = await session.scalar(select(User).order_by(User.id.asc()).offset(0).limit(1))
    if not first_user:
        await message.answer("👥 Foydalanuvchilar topilmadi.")
        return

    card_text = await _format_user_card(session, first_user, 0, total, config)
    await message.answer(
        card_text,
        reply_markup=build_users_pagination_kb(0, total, first_user.telegram_id),
    )


@router.callback_query(F.data.startswith("adm_users:"))
async def cb_admin_users_navigation(
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

    if action == "noop":
        await callback.answer()
        return

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

    if action == "search":
        await state.set_state(AdminUserSearchStates.waiting_for_user_id)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                "🔎 <b>Qidirilayotgan foydalanuvchining Telegram ID raqamini yuboring:</b>\n\n"
                "<i>Bekor qilish uchun /start bosing.</i>"
            )
        return

    if action == "page" and len(parts) >= 3:
        idx = max(0, int(parts[2]))
        total = await session.scalar(select(func.count(User.id))) or 0
        if total == 0:
            await callback.answer("Foydalanuvchilar yo‘q", show_alert=True)
            return
        if idx >= total:
            idx = total - 1

        target_user = await session.scalar(
            select(User).order_by(User.id.asc()).offset(idx).limit(1)
        )
        if not target_user or not callback.message:
            await callback.answer("Foydalanuvchi topilmadi", show_alert=True)
            return

        card_text = await _format_user_card(session, target_user, idx, total, config)
        await callback.message.edit_text(
            card_text,
            reply_markup=build_users_pagination_kb(idx, total, target_user.telegram_id),
        )
        await callback.answer()


@router.message(AdminUserSearchStates.waiting_for_user_id)
async def handle_admin_user_id_search(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    raw = (message.text or "").strip()
    if not raw.isdigit():
        await message.answer("❌ Telegram ID faqat raqamlardan iborat bo‘lishi kerak. Qaytadan kiriting:")
        return

    tg_id = int(raw)
    target_user = await session.scalar(select(User).where(User.telegram_id == tg_id))
    if target_user is None:
        await message.answer(f"❌ <code>{tg_id}</code> ID raqamli foydalanuvchi bazada topilmadi.")
        return

    await state.clear()
    total = await session.scalar(select(func.count(User.id))) or 1
    rank = (
        await session.scalar(select(func.count(User.id)).where(User.id < target_user.id))
        or 0
    )
    card_text = await _format_user_card(session, target_user, rank, total, config)
    await message.answer(
        card_text,
        reply_markup=build_users_pagination_kb(rank, total, target_user.telegram_id),
    )


@router.message(F.text == BTN_SECURITY_SETTINGS)
async def show_security_settings_menu(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await message.answer("⛔️ Ushbu bo‘lim faqat Asosiy Administrator uchun mo‘ljallangan!")
        return

    await state.clear()
    masked_setting = await session.scalar(
        select(BotSetting).where(BotSetting.key == TEMP_ADMIN_PLAIN_HINT_KEY)
    )
    masked_code = masked_setting.value if masked_setting else "O‘rnatilmagan"
    del_delay = await get_delete_delay_seconds(session, config)

    now = datetime.now(timezone.utc)
    active_temps = (
        await session.scalar(
            select(func.count(TemporaryAdmin.id)).where(
                TemporaryAdmin.is_active.is_(True),
                TemporaryAdmin.expires_at > now,
            )
        )
        or 0
    )

    await message.answer(
        f"🔐 <b>Maxfiy kod va xavfsizlik sozlamalari</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔑 <b>30 daqiqalik admin kodi:</b> <code>{html.escape(masked_code)}</code>\n"
        f"⏱ <b>Faol vaqtinchalik adminlar:</b> <b>{active_temps}</b> ta\n"
        f"⏳ <b>Vaqtinchalik xabarlarni o‘chirish muddati:</b> <b>{del_delay} soniya</b>\n\n"
        f"Kerakli amalni tanlang:",
        reply_markup=build_security_settings_kb(),
    )


@router.callback_query(F.data.startswith("adm_sec:"))
async def cb_security_settings_actions(
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

    if action == "set_temp_code":
        await state.set_state(SecuritySettingsStates.waiting_for_temp_admin_code)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                "🔑 <b>30 daqiqalik vaqtinchalik admin uchun yangi maxfiy kodni yuboring:</b>\n\n"
                "• Kod oddiy kontent kodlari bilan bir xil bo‘lmasligi shart.\n"
                "• Kod xavfsiz xeshlangan (HMAC-SHA256) holda bazada saqlanadi."
            )
        return

    if action == "set_del_delay":
        await state.set_state(SecuritySettingsStates.waiting_for_delete_delay)
        await callback.answer()
        if callback.message:
            await callback.message.answer(
                "⏳ <b>Vaqtinchalik ogohlantirish xabarlarini o‘chirish vaqtini (soniyada) kiriting:</b>\n"
                "Masalan: <code>45</code> (5 dan 3600 gacha)"
            )
        return

    if action == "revoke_all_temp":
        now = datetime.now(timezone.utc)
        await session.execute(
            update(TemporaryAdmin)
            .where(TemporaryAdmin.is_active.is_(True))
            .values(is_active=False, revoked_at=now)
        )
        await log_admin_action(
            session=session,
            actor_telegram_id=config.admin_id,
            actor_role="main_admin",
            action="REVOKE_ALL_TEMP_ADMINS",
            details="Barcha faol vaqtinchalik adminlar muddatidan oldin bekor qilindi",
        )
        await callback.answer("✅ Barcha vaqtinchalik adminlar bekor qilindi!", show_alert=True)
        return

    if action == "audit_logs":
        logs = list(
            (
                await session.scalars(
                    select(AuditLog).order_by(AuditLog.id.desc()).limit(15)
                )
            ).all()
        )
        await callback.answer()
        if not logs:
            if callback.message:
                await callback.message.answer("📜 Audit loglar hozircha bo‘sh.")
            return

        lines = ["📜 <b>Oxirgi 15 ta xavfsizlik va admin harakatlari (Audit Log):</b>\n"]
        for item in logs:
            dt_str = _format_dt(item.created_at, config)
            lines.append(
                f"• <code>{dt_str}</code> | <b>{html.escape(item.actor_role)}</b> "
                f"(<code>{item.actor_telegram_id}</code>) ➡️ <b>{html.escape(item.action)}</b>\n"
                f"  <i>{html.escape(item.details or '')}</i>"
            )
        if callback.message:
            await callback.message.answer("\n".join(lines))


@router.message(SecuritySettingsStates.waiting_for_temp_admin_code)
async def save_new_temp_admin_code(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    ok, msg = await set_temp_admin_code(
        session=session,
        raw_code=message.text or "",
        admin_id=config.admin_id,
        config=config,
    )
    if not ok:
        await message.answer(msg)
        return

    await log_admin_action(
        session=session,
        actor_telegram_id=config.admin_id,
        actor_role="main_admin",
        action="SET_TEMP_ADMIN_CODE",
        details=msg,
    )
    await state.clear()
    await message.answer(msg, reply_markup=build_main_admin_kb())


@router.message(SecuritySettingsStates.waiting_for_delete_delay)
async def save_new_delete_delay(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    if not is_main_admin:
        await state.clear()
        return

    raw = (message.text or "").strip()
    if not raw.isdigit() or not (5 <= int(raw) <= 3600):
        await message.answer("❌ Iltimos, 5 dan 3600 gacha bo‘lgan son kiriting:")
        return

    new_sec = await set_delete_delay_seconds(session, int(raw), config.admin_id)
    await log_admin_action(
        session=session,
        actor_telegram_id=config.admin_id,
        actor_role="main_admin",
        action="SET_DELETE_DELAY",
        details=f"Vaqtinchalik xabarlarni o'chirish muddati {new_sec} soniyaga o'zgartirildi",
    )
    await state.clear()
    await message.answer(
        f"✅ Vaqtinchalik xabarlarni avtomatik o‘chirish muddati <b>{new_sec} soniya</b> etib belgilandi.",
        reply_markup=build_main_admin_kb(),
    )


@router.callback_query(F.data.startswith("adm_temp_alert:"))
async def cb_temp_admin_alert_actions(
    callback: CallbackQuery,
    session: AsyncSession,
    config: Config,
    is_main_admin: bool,
) -> None:
    """
    Vaqtinchalik admin tizimga kirganda Asosiy Adminga kelgan xabardagi
    «✅ Qoldirish» va «🚫 Bekor qilish» tugmalari handleri.
    """
    if not is_main_admin:
        await callback.answer("⛔️ Faqat Asosiy Admin uchun!", show_alert=True)
        return

    parts = (callback.data or "").split(":")
    if len(parts) < 4:
        await callback.answer("Noto‘g‘ri so‘rov", show_alert=True)
        return

    action = parts[1]
    temp_admin_id = int(parts[2]) if parts[2].isdigit() else 0
    target_tg_id = int(parts[3]) if parts[3].isdigit() else 0
    now = datetime.now(timezone.utc)
    now_local_str = now.astimezone(config.tz).strftime("%d.%m.%Y %H:%M:%S")

    if action == "keep":
        active_record = await session.scalar(
            select(TemporaryAdmin).where(
                TemporaryAdmin.telegram_id == target_tg_id,
                TemporaryAdmin.is_active.is_(True),
                TemporaryAdmin.expires_at > now,
            )
        )
        if active_record is None:
            await callback.answer(
                "⌛️ Ushbu foydalanuvchining vaqtinchalik admin muddati allaqachon tugagan yoki bekor qilingan.",
                show_alert=True,
            )
            if callback.message:
                try:
                    await callback.message.edit_reply_markup(reply_markup=None)
                except TelegramAPIError:
                    pass
            return

        await log_admin_action(
            session=session,
            actor_telegram_id=config.admin_id,
            actor_role="main_admin",
            action="KEEP_TEMP_ADMIN",
            target_type="user",
            target_id=str(target_tg_id),
            details=f"Vaqtinchalik admin ({target_tg_id}) huquqi asosiy admin tomonidan qoldirildi",
        )
        await callback.answer("✅ Vaqtinchalik admin huquqi o‘z kuchida qoldirildi!")
        if callback.message:
            base_html = callback.message.html_text or ""
            updated_text = (
                f"{base_html}\n\n"
                f"✅ <b>Qaror:</b> Asosiy admin tomonidan <b>QOLDIRILDI</b> (<code>{now_local_str}</code>)."
            )
            try:
                await callback.message.edit_text(
                    updated_text,
                    reply_markup=build_temp_admin_alert_kb(
                        temp_admin_id=active_record.id,
                        target_telegram_id=target_tg_id,
                        kept=True,
                    ),
                )
            except TelegramAPIError:
                pass
        return

    if action == "revoke":
        await session.execute(
            update(TemporaryAdmin)
            .where(
                TemporaryAdmin.telegram_id == target_tg_id,
                TemporaryAdmin.is_active.is_(True),
            )
            .values(is_active=False, revoked_at=now)
        )
        await log_admin_action(
            session=session,
            actor_telegram_id=config.admin_id,
            actor_role="main_admin",
            action="REVOKE_TEMP_ADMIN",
            target_type="user",
            target_id=str(target_tg_id),
            details=f"Vaqtinchalik admin ({target_tg_id}) huquqi asosiy admin tomonidan darhol bekor qilindi",
        )
        await callback.answer("🚫 Vaqtinchalik admin huquqi bekor qilindi!", show_alert=True)

        if callback.message:
            base_html = callback.message.html_text or ""
            updated_text = (
                f"{base_html}\n\n"
                f"🚫 <b>Qaror:</b> Asosiy admin tomonidan <b>BEKOR QILINDI</b> (<code>{now_local_str}</code>)."
            )
            try:
                await callback.message.edit_text(updated_text, reply_markup=None)
            except TelegramAPIError:
                pass

        try:
            await callback.bot.send_message(
                chat_id=target_tg_id,
                text=(
                    "🚫 <b>Sizning vaqtinchalik admin huquqingiz Asosiy Administrator tomonidan bekor qilindi!</b>\n\n"
                    "👤 Siz oddiy foydalanuvchi rejimiga o‘tkazildingiz. Maxsus kodlarni yozib yuborishingiz mumkin:"
                ),
                reply_markup=remove_kb(),
            )
        except TelegramAPIError as exc:
            logger.debug("Bekor qilingan vaqtinchalik adminga xabar yuborib bo'lmadi: %s", exc)

