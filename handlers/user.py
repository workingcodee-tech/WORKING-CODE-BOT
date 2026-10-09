"""
WORKING CODE — Asosiy foydalanuvchi oqimi:
- /start buyrug'i
- chat_member orqali kanalga kirish/chiqishni avtomatik kuzatish
- Telefon raqamini request_contact=True orqali tasdiqlash
- Maxsus kod orqali kontent (matn, media, albom) olish (protect_content=True bilan)
- 30 daqiqalik vaqtinchalik admin kodini faollashtirish
"""

from __future__ import annotations

import html
import logging
from datetime import datetime
from typing import List

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    ChatMemberUpdated,
    InputMediaAudio,
    InputMediaDocument,
    InputMediaPhoto,
    InputMediaVideo,
    Message,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import Config
from database import DatabaseManager
from handlers.states import UserStates
from keyboards.admin_kb import build_main_admin_kb, build_temp_admin_kb
from keyboards.user_kb import (
    build_phone_request_kb,
    build_subscription_inline_kb,
    build_verified_user_kb,
)
from models import Channel, Content, ContentAccessLog, ContentItem, TemporaryAdmin, User
from services.audit import log_admin_action
from services.cleanup import safe_delete_bot_message, schedule_bot_message_deletion
from services.security import (
    check_and_record_code_attempt,
    grant_temporary_admin,
    normalize_code,
    normalize_phone_international,
    verify_temp_admin_code,
)
from services.subscription import check_user_subscriptions

logger = logging.getLogger(__name__)
router = Router(name="user_router")


async def _send_content_to_user(
    bot: Bot, chat_id: int, content: Content
) -> None:
    """
    Maxsus kodga biriktirilgan kontentni (yakka xabar yoki media albomni)
    protect_content=True parametri bilan foydalanuvchiga yuboradi.
    """
    items: List[ContentItem] = list(content.items)
    if not items:
        await bot.send_message(
            chat_id=chat_id,
            text="⚠️ Ushbu kodga biriktirilgan fayllar topilmadi.",
        )
        return

    # Agar albom bo'lsa va ichida 2+ rasm/video/audio/hujjat bo'lsa
    album_Grouping_types = {"photo", "video", "audio", "document"}
    if len(items) > 1 and all(it.media_type in album_Grouping_types and it.file_id for it in items):
        # Rasm va videolar bir media guruhda bo'la oladi; hujjatlar alohida, audiolar alohida
        media_group = []
        for idx, it in enumerate(items):
            cap = it.caption if idx == 0 else (it.caption or None)
            if it.media_type == "photo" and it.file_id:
                media_group.append(InputMediaPhoto(media=it.file_id, caption=cap))
            elif it.media_type == "video" and it.file_id:
                media_group.append(InputMediaVideo(media=it.file_id, caption=cap))
            elif it.media_type == "audio" and it.file_id:
                media_group.append(InputMediaAudio(media=it.file_id, caption=cap))
            elif it.media_type == "document" and it.file_id:
                media_group.append(InputMediaDocument(media=it.file_id, caption=cap))

        try:
            await bot.send_media_group(
                chat_id=chat_id,
                media=media_group,
                protect_content=True,
            )
            return
        except TelegramAPIError as exc:
            logger.warning("Albom sifatida yuborishda xato, ketma-ket yuboriladi: %s", exc)

    # Yakka elementlar yoki aralash kontent turlari ketma-ket protect_content=True bilan yuboriladi
    for it in items:
        mtype = it.media_type
        fid = it.file_id
        cap = it.caption
        if mtype == "text":
            await bot.send_message(
                chat_id=chat_id,
                text=it.text_content or "",
                protect_content=True,
            )
        elif mtype == "photo" and fid:
            await bot.send_photo(chat_id=chat_id, photo=fid, caption=cap, protect_content=True)
        elif mtype == "video" and fid:
            await bot.send_video(chat_id=chat_id, video=fid, caption=cap, protect_content=True)
        elif mtype == "audio" and fid:
            await bot.send_audio(chat_id=chat_id, audio=fid, caption=cap, protect_content=True)
        elif mtype == "voice" and fid:
            await bot.send_voice(chat_id=chat_id, voice=fid, caption=cap, protect_content=True)
        elif mtype == "animation" and fid:
            await bot.send_animation(chat_id=chat_id, animation=fid, caption=cap, protect_content=True)
        elif mtype == "document" and fid:
            await bot.send_document(chat_id=chat_id, document=fid, caption=cap, protect_content=True)
        elif mtype == "sticker" and fid:
            await bot.send_sticker(chat_id=chat_id, sticker=fid, protect_content=True)


@router.message(CommandStart())
async def cmd_start(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    config: Config,
    db_user: User,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    """
    3-bo'lim: /start buyrug'i.
    - Asosiy admin uchun obuna va telefon tasdig'isiz darhol admin klaviaturasi ochiladi.
    - Oddiy foydalanuvchini ismi bilan iliq kutib oladi, obuna va telefon tasdig'ini tekshiradi.
    """
    await state.clear()
    safe_name = html.escape(db_user.first_name or "Foydalanuvchi")

    if is_main_admin:
        await message.answer(
            f"👋 <b>Assalomu alaykum, Asosiy Administrator ({safe_name})!</b>\n\n"
            f"🤖 <b>WORKING CODE</b> boshqaruv paneliga xush kelibsiz.\n"
            f"Quyidagi menyu tugmalari orqali tizimni to‘liq boshqarishingiz mumkin:",
            reply_markup=build_main_admin_kb(),
        )
        return

    welcome_msg = await message.answer(
        f"✨ <b>Assalomu alaykum, {safe_name}!</b>\n\n"
        f"<b>WORKING CODE</b> rasmiy botiga xush kelibsiz!\n"
        f"Bu yerda maxsus kodlar orqali eksklyuziv o‘quv materiallari, videolar, "
        f"hujjatlar va fayllarni olishingiz mumkin."
    )
    await schedule_bot_message_deletion(
        session, welcome_msg, category="welcome", config=config
    )

    is_sub_ok, unsubscribed = await check_user_subscriptions(
        message.bot, session, db_user.telegram_id
    )

    if not is_sub_ok:
        if db_user.last_prompt_message_id:
            await safe_delete_bot_message(
                message.bot, message.chat.id, db_user.last_prompt_message_id
            )
        sub_msg = await message.answer(
            "📢 <b>Botdan to‘liq foydalanish uchun quyidagi rasmiy kanallarga obuna bo‘ling:</b>\n\n"
            "Barcha kanallarga a’zo bo‘lishingiz bilan bot buni avtomatik aniqlaydi!",
            reply_markup=build_subscription_inline_kb(unsubscribed),
        )
        db_user.last_prompt_message_id = sub_msg.message_id
        await schedule_bot_message_deletion(
            session, sub_msg, category="sub_prompt", config=config
        )
        return

    if not db_user.is_phone_verified:
        phone_msg = await message.answer(
            "📱 <b>Telefon raqamingizni tasdiqlang:</b>\n\n"
            "Nima uchun telefon raqami kerak?\n"
            "• Foydalanuvchi xavfsizligini ta’minlash va botni spamdan himoyalash uchun;\n"
            "• Maxsus kodlar orqali himoyalangan fayllarni faqat tasdiqlangan foydalanuvchilarga taqdim etish uchun.\n\n"
            "👇 Pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini bosing:",
            reply_markup=build_phone_request_kb(),
        )
        await schedule_bot_message_deletion(
            session, phone_msg, category="phone_prompt", config=config
        )
        return

    await message.answer(
        "✅ <b>Barcha shartlar bajarilgan!</b>\n\n"
        "Kerakli fayl yoki materialni olish uchun uning <b>maxsus kodini</b> yozib yuboring "
        "(masalan: <code>VIDEO2026</code>):",
        reply_markup=build_verified_user_kb(is_temp_admin=temp_admin is not None),
    )


@router.callback_query(F.data == "user:check_sub")
async def cb_check_subscription(
    callback: CallbackQuery,
    session: AsyncSession,
    config: Config,
    db_user: User,
    temp_admin: TemporaryAdmin | None,
) -> None:
    """Obuna holatini qayta tekshirish tugmasi (zaxira mexanizmi)."""
    is_sub_ok, unsubscribed = await check_user_subscriptions(
        callback.bot, session, db_user.telegram_id
    )
    if not is_sub_ok:
        await callback.answer(
            f"❌ Siz hali {len(unsubscribed)} ta kanalga obuna bo‘lmadingiz!",
            show_alert=True,
        )
        if callback.message:
            try:
                await callback.message.edit_reply_markup(
                    reply_markup=build_subscription_inline_kb(unsubscribed)
                )
            except TelegramAPIError:
                pass
        return

    await callback.answer("✅ Barcha kanallarga obuna tasdiqlandi!")
    if callback.message:
        await safe_delete_bot_message(
            callback.bot, callback.message.chat.id, callback.message.message_id
        )
        db_user.last_prompt_message_id = None

    if not db_user.is_phone_verified:
        sent = await callback.bot.send_message(
            chat_id=db_user.telegram_id,
            text=(
                "✅ <b>Kanal obunasi tasdiqlandi!</b>\n\n"
                "Endi oxirgi qadam — xavfsizlik va hisobingizni tasdiqlash uchun "
                "pastdagi tugma orqali o‘z telefon raqamingizni yuboring:"
            ),
            reply_markup=build_phone_request_kb(),
        )
        await schedule_bot_message_deletion(
            session, sent, category="phone_prompt", config=config
        )
    else:
        await callback.bot.send_message(
            chat_id=db_user.telegram_id,
            text=(
                "🎉 <b>Obuna qayta tiklandi!</b>\n\n"
                "Asosiy funksiyalar ochildi. Maxsus kodni yuborishingiz mumkin:"
            ),
            reply_markup=build_verified_user_kb(is_temp_admin=temp_admin is not None),
        )


@router.chat_member()
async def on_channel_chat_member_update(
    event: ChatMemberUpdated,
    bot: Bot,
    db: DatabaseManager,
    config: Config,
) -> None:
    """
    4-bo'lim talabi:
    Telegram `chat_member` yangilanishlari orqali foydalanuvchi majburiy kanalga
    qo'shilganda yoki chiqib ketganda holatni darhol yangilaydi.
    - Barcha kanallarga a'zo bo'lsa va telefoni tasdiqlangan bo'lsa, avtomatik ravishda
      hech qanday tugmasiz asosiy funksiyalarni ochadi!
    - Agar majburiy kanalni tark etsa, darhol bloklaydi va ogohlantirish yuboradi.
    """
    target_user = event.new_chat_member.user
    if not target_user or target_user.is_bot or target_user.id == config.admin_id:
        return

    async with db.session() as session:
        # Shu chat bizning majburiy kanallarimizdan birimi?
        ch = await session.scalar(
            select(Channel).where(
                Channel.channel_id == event.chat.id,
                Channel.is_active.is_(True),
            )
        )
        if ch is None:
            return

        db_user = await session.scalar(
            select(User).where(User.telegram_id == target_user.id)
        )
        if db_user is None:
            return

        was_subscribed = db_user.is_subscribed_all
        is_now_subscribed, unsubscribed = await check_user_subscriptions(
            bot, session, target_user.id
        )

        # 1-holat: Foydalanuvchi barcha kanallarga obuna bo'ldi
        if is_now_subscribed and not was_subscribed:
            if db_user.last_prompt_message_id:
                await safe_delete_bot_message(
                    bot, db_user.telegram_id, db_user.last_prompt_message_id
                )
                db_user.last_prompt_message_id = None

            if db_user.is_phone_verified:
                try:
                    await bot.send_message(
                        chat_id=db_user.telegram_id,
                        text=(
                            "🎉 <b>Rahmat! Barcha kanallarga obuna bo‘lganingiz avtomatik tasdiqlandi.</b>\n\n"
                            "Telefon raqamingiz ham tasdiqlangan. Endi maxsus kodni yuborib, "
                            "kerakli fayllarni olishingiz mumkin!"
                        ),
                        reply_markup=build_verified_user_kb(),
                    )
                except TelegramAPIError as exc:
                    logger.debug("Avtomatik ochish xabarini yuborib bo'lmadi: %s", exc)
            else:
                try:
                    prompt = await bot.send_message(
                        chat_id=db_user.telegram_id,
                        text=(
                            "✅ <b>Barcha kanallarga obuna bo‘ldingiz!</b>\n\n"
                            "Endi botdan to‘liq foydalanish uchun pastdagi tugma orqali "
                            "telefon raqamingizni tasdiqlang:"
                        ),
                        reply_markup=build_phone_request_kb(),
                    )
                    await schedule_bot_message_deletion(
                        session, prompt, category="phone_prompt", config=config
                    )
                except TelegramAPIError as exc:
                    logger.debug("Telefon so'rovini yuborib bo'lmadi: %s", exc)

        # 2-holat: Foydalanuvchi majburiy kanalni tark etdi
        elif not is_now_subscribed and was_subscribed:
            try:
                if db_user.last_prompt_message_id:
                    await safe_delete_bot_message(
                        bot, db_user.telegram_id, db_user.last_prompt_message_id
                    )
                warn = await bot.send_message(
                    chat_id=db_user.telegram_id,
                    text=(
                        f"⚠️ <b>Diqqat, {html.escape(db_user.first_name)}!</b>\n\n"
                        f"Siz <b>«{html.escape(ch.title)}»</b> kanalini tark etdingiz. "
                        f"Shu sababli botning asosiy funksiyalari vaqtincha bloklandi.\n\n"
                        f"Qayta obuna bo‘lishingiz bilan barcha funksiyalar avtomatik ravishda ochiladi:"
                    ),
                    reply_markup=build_subscription_inline_kb(unsubscribed),
                )
                db_user.last_prompt_message_id = warn.message_id
                await schedule_bot_message_deletion(
                    session, warn, category="sub_left_warning", config=config
                )
            except TelegramAPIError as exc:
                logger.debug("Kanal tark etilgani haqida xabar yuborilmadi: %s", exc)


@router.message(F.contact)
async def handle_contact_verification(
    message: Message,
    session: AsyncSession,
    config: Config,
    db_user: User,
    temp_admin: TemporaryAdmin | None,
) -> None:
    """
    5-bo'lim: Telefon raqamini tasdiqlash.
    - Faqat foydalanuvchining o'z Telegram kontaktini qabul qiladi.
    - Boshqa shaxsning kontaktini yuborishni rad etadi.
    - Raqamni xalqaro formatda (+998...) saqlaydi.
    """
    contact = message.contact
    if contact is None or message.from_user is None:
        return

    if contact.user_id != message.from_user.id:
        err_msg = await message.answer(
            "❌ <b>Xatolik: Boshqa shaxsning kontaktini yuborish mumkin emas!</b>\n\n"
            "Iltimos, faqat pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini "
            "bosish orqali o‘zingizning shaxsiy Telegram kontaktingizni ulashing.",
            reply_markup=build_phone_request_kb(),
        )
        await schedule_bot_message_deletion(
            session, err_msg, category="contact_error", config=config
        )
        return

    formatted_phone = normalize_phone_international(contact.phone_number)
    if not formatted_phone:
        err_msg = await message.answer(
            "❌ Telefon raqamini aniqlab bo‘lmadi. Qaytadan urinib ko‘ring.",
            reply_markup=build_phone_request_kb(),
        )
        await schedule_bot_message_deletion(
            session, err_msg, category="contact_error", config=config
        )
        return

    db_user.phone_number = formatted_phone
    db_user.is_phone_verified = True

    is_sub_ok, unsubscribed = await check_user_subscriptions(
        message.bot, session, db_user.telegram_id
    )
    if not is_sub_ok:
        sub_msg = await message.answer(
            "✅ <b>Telefon raqamingiz tasdiqlandi!</b>\n\n"
            "Endi quyidagi majburiy kanallarga obuna bo‘ling:",
            reply_markup=build_subscription_inline_kb(unsubscribed),
        )
        db_user.last_prompt_message_id = sub_msg.message_id
        await schedule_bot_message_deletion(
            session, sub_msg, category="sub_prompt", config=config
        )
        return

    await message.answer(
        "🎉 <b>Tabriklaymiz! Telefon raqamingiz muvaffaqiyatli tasdiqlandi.</b>\n\n"
        "Endi botning barcha asosiy funksiyalari siz uchun ochiq.\n"
        "Kerakli fayl yoki videoni olish uchun <b>maxsus kodni</b> yuboring (masalan: <code>VIDEO2026</code>):",
        reply_markup=build_verified_user_kb(is_temp_admin=temp_admin is not None),
    )


@router.message(F.text == "🔑 Kod yuborish bo‘yicha yo‘riqnoma")
async def user_guide_handler(
    message: Message,
    session: AsyncSession,
    config: Config,
) -> None:
    guide_msg = await message.answer(
        "📖 <b>Maxsus kod orqali fayl olish yo‘riqnomasi:</b>\n\n"
        "1️⃣ Administrator tomonidan berilgan maxsus kodni xabar sifatida yozib yuboring (masalan: <code>VIDEO2026</code>).\n"
        "2️⃣ Kodni katta yoki kichik harflarda yozishingiz mumkin (<code>video2026</code> ham ishlaydi).\n"
        "3️⃣ Bot kodni bazadan tekshiradi va unga biriktirilgan matn, rasm, video, hujjat yoki albomni darhol yuboradi.\n\n"
        "🔒 <i>Eslatma: Yuborilgan barcha materiallar mualliflik huquqi bilan himoyalangan.</i>"
    )
    await schedule_bot_message_deletion(
        session, guide_msg, category="guide", config=config
    )


@router.message(F.text == "👤 Mening ma’lumotlarim")
async def user_profile_handler(
    message: Message,
    session: AsyncSession,
    config: Config,
    db_user: User,
    temp_admin: TemporaryAdmin | None,
) -> None:
    age_str = f"{db_user.age} yosh" if db_user.age is not None else "Kiritilmagan"
    role_str = "⏱ Vaqtinchalik Admin (30 daqiqalik)" if temp_admin else "👤 Tasdiqlangan foydalanuvchi"
    info_msg = await message.answer(
        f"👤 <b>Sizning profilingiz:</b>\n\n"
        f"• <b>Ism:</b> {html.escape(db_user.first_name)}\n"
        f"• <b>Telegram ID:</b> <code>{db_user.telegram_id}</code>\n"
        f"• <b>Obuna holati:</b> {'✅ Tasdiqlangan' if db_user.is_subscribed_all else '❌ Tasdiqlanmagan'}\n"
        f"• <b>Telefon tasdig‘i:</b> {'✅ Tasdiqlangan' if db_user.is_phone_verified else '❌ Tasdiqlanmagan'}\n"
        f"• <b>Yosh:</b> {age_str}\n"
        f"• <b>Maqom:</b> {role_str}"
    )
    await schedule_bot_message_deletion(
        session, info_msg, category="profile_info", config=config
    )


@router.message(F.text == "🎂 Yoshni kiritish (ixtiyoriy)")
async def ask_user_age(message: Message, state: FSMContext) -> None:
    await state.set_state(UserStates.waiting_for_age)
    await message.answer(
        "🎂 <b>Yoshingizni raqamda kiriting (masalan: 22):</b>\n\n"
        "<i>Bekor qilish uchun /start buyrug‘ini bosing.</i>"
    )


@router.message(UserStates.waiting_for_age)
async def save_user_age(
    message: Message,
    state: FSMContext,
    db_user: User,
    temp_admin: TemporaryAdmin | None,
) -> None:
    raw = (message.text or "").strip()
    if not raw.isdigit() or not (7 <= int(raw) <= 100):
        await message.answer("❌ Iltimos, yoshingizni 7 dan 100 gacha bo‘lgan butun son ko‘rinishida kiriting:")
        return

    db_user.age = int(raw)
    await state.clear()
    await message.answer(
        f"✅ Yoshingiz ({db_user.age} yosh) muvaffaqiyatli saqlandi!",
        reply_markup=build_verified_user_kb(is_temp_admin=temp_admin is not None),
    )


@router.message(F.text == "⏱ Vaqtinchalik Admin Paneli")
async def open_temp_admin_panel(
    message: Message,
    temp_admin: TemporaryAdmin | None,
    config: Config,
) -> None:
    if temp_admin is None:
        await message.answer(
            "⌛️ Sizning 30 daqiqalik vaqtinchalik adminlik muddatingiz yakunlangan.",
            reply_markup=build_verified_user_kb(is_temp_admin=False),
        )
        return

    exp_local = temp_admin.expires_at.astimezone(config.tz).strftime("%H:%M:%S")
    await message.answer(
        f"⏱ <b>Vaqtinchalik Admin Paneli faol!</b>\n"
        f"Amal qilish muddati: <b>{exp_local}</b> gacha.\n\n"
        f"Siz umumiy statistikani ko‘rishingiz va yangi xabarlar/kodlar qo‘shishingiz mumkin.",
        reply_markup=build_temp_admin_kb(),
    )


@router.message(F.text == "👤 Oddiy rejimga qaytish")
async def exit_temp_admin_panel(
    message: Message,
    temp_admin: TemporaryAdmin | None,
) -> None:
    await message.answer(
        "👤 Oddiy foydalanuvchi rejimiga qaytdingiz. Maxsus kodlarni yuborishingiz mumkin:",
        reply_markup=build_verified_user_kb(is_temp_admin=temp_admin is not None),
    )


@router.message(F.text)
async def handle_special_code_lookup(
    message: Message,
    session: AsyncSession,
    config: Config,
    db_user: User,
    is_main_admin: bool,
    temp_admin: TemporaryAdmin | None,
) -> None:
    """
    6 va 7-bo'limlar:
    - Foydalanuvchi yuborgan matnni maxsus kod sifatida qidiradi.
    - Brute-force urinishlarini cheklaydi.
    - Agar kod 30 daqiqalik vaqtinchalik admin kodi bo'lsa, foydalanuvchiga 30 daqiqalik
      vaqtinchalik admin huquqini beradi va audit logga yozadi.
    - Agar oddiy kontent kodi bo'lsa, unga tegishli kontentni protect_content=True bilan yuboradi
      hamda ContentAccessLog statistikasiga yozadi.
    """
    raw_text = (message.text or "").strip()
    if not raw_text or raw_text.startswith("/"):
        return

    # 1. Brute-force bloklanganlikni tekshirish
    if not is_main_admin:
        now_utc = datetime.now(db_user.last_active_at.tzinfo)
        if db_user.locked_until and db_user.locked_until > now_utc:
            rem = int((db_user.locked_until - now_utc).total_seconds())
            lock_msg = await message.answer(
                f"⛔️ <b>Ko‘p marta noto‘g‘ri kod kiritdingiz!</b>\n"
                f"Xavfsizlik maqsadida kod qidirish <b>{rem} soniya</b>ga cheklandi."
            )
            await schedule_bot_message_deletion(
                session, lock_msg, category="rate_limit", config=config
            )
            return

    code = normalize_code(raw_text)

    # 2. Vaqtinchalik 30 daqiqalik admin kodini tekshirish
    if not is_main_admin and await verify_temp_admin_code(session, code, config):
        if temp_admin is not None:
            exp_str = temp_admin.expires_at.astimezone(config.tz).strftime("%H:%M:%S")
            await message.answer(
                f"ℹ️ Sizda allaqachon <b>{exp_str}</b> gacha amal qiluvchi vaqtinchalik admin huquqi mavjud!\n"
                f"O‘zingizga qayta huquq berish yoki muddatni uzaytirish mumkin emas.",
                reply_markup=build_temp_admin_kb(),
            )
            return

        await check_and_record_code_attempt(session, db_user, success=True, config=config)
        granted = await grant_temporary_admin(session, db_user, config)
        await log_admin_action(
            session=session,
            actor_telegram_id=db_user.telegram_id,
            actor_role="temp_admin",
            action="ACTIVATE_TEMP_ADMIN_30M",
            target_type="user",
            target_id=str(db_user.telegram_id),
            details=f"30 daqiqalik vaqtinchalik admin huquqi olindi (tugash vaqti: {granted.expires_at.isoformat()})",
        )
        exp_local = granted.expires_at.astimezone(config.tz).strftime("%H:%M:%S")
        await message.answer(
            f"🛡 <b>Tabriklaymiz! Sizga 30 daqiqalik vaqtinchalik admin huquqi berildi!</b>\n\n"
            f"⏳ Amal qilish muddati: <b>{exp_local}</b> gacha.\n"
            f"📋 Sizning barcha harakatlaringiz xavfsizlik jurnaliga (Audit Log) yozib boriladi.\n"
            f"⚠️ Muddat tugagach, qo‘shimcha huquqlar avtomatik bekor qilinadi.",
            reply_markup=build_temp_admin_kb(),
        )
        return

    # 3. Bazadan maxsus kontent kodini qidirish (katta-kichik harflarga bog'liq emas)
    stmt = (
        select(Content)
        .options(selectinload(Content.items))
        .where(Content.code == code)
    )
    content = await session.scalar(stmt)

    if content is None:
        if not is_main_admin:
            allowed, lock_sec = await check_and_record_code_attempt(
                session, db_user, success=False, config=config
            )
            if not allowed and lock_sec:
                err_msg = await message.answer(
                    f"⛔️ <b>Ketma-ket noto‘g‘ri urinishlar tufayli {lock_sec} soniyaga bloklandingiz!</b>"
                )
                await schedule_bot_message_deletion(
                    session, err_msg, category="rate_limit", config=config
                )
                return

        not_found_msg = await message.answer(
            f"🔍 <b>«{html.escape(code)}» kodi bo‘yicha hech qanday ma’lumot topilmadi!</b>\n\n"
            f"Iltimos, kod to‘g‘ri yozilganligini tekshirib, qaytadan yuboring."
        )
        await schedule_bot_message_deletion(
            session, not_found_msg, category="invalid_code", config=config
        )
        return

    # 4. Kod topildi — urinishlar hisoblagichini tiklaymiz va kontentni yuboramiz
    await check_and_record_code_attempt(session, db_user, success=True, config=config)

    try:
        await _send_content_to_user(message.bot, message.chat.id, content)
    except TelegramAPIError as exc:
        logger.error("Kontent yuborishda Telegram API xatosi (code=%s): %s", code, exc)
        await message.answer(
            "⚠️ Kontentni yuborishda texnik xatolik yuz berdi. Iltimos, birozdan so‘ng qayta urinib ko‘ring."
        )
        return

    # 5. Statistikani yangilash (usage_count va ContentAccessLog)
    content.usage_count = (content.usage_count or 0) + 1
    session.add(
        ContentAccessLog(
            user_id=db_user.id,
            telegram_id=db_user.telegram_id,
            content_id=content.id,
            code_used=code,
        )
    )
