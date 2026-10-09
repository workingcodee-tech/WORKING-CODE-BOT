"""
WORKING CODE — Asosiy Admin va Vaqtinchalik Admin uchun klaviaturalar (O'zbek tilida).
"""

from __future__ import annotations

from typing import Sequence

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from models import Channel, Content

# Asosiy admin bosh menyu tugmalari matnlari
BTN_STATS = "📊 Statistika"
BTN_USERS = "👥 Foydalanuvchilar"
BTN_BROADCAST = "📢 Reklama"
BTN_CHANNELS = "📡 Kanallar"
BTN_MESSAGES = "📂 Xabarlar"
BTN_SECURITY_SETTINGS = "🔐 Maxfiy kod va sozlamalar"
BTN_BACK = "🔙 Orqaga"


def build_main_admin_kb() -> ReplyKeyboardMarkup:
    """
    8-bo'lim talabi bo'yicha Asosiy Admin uchun doimiy klaviatura:
    - 📊 Statistika
    - 👥 Foydalanuvchilar
    - 📢 Reklama
    - 📡 Kanallar
    - 📂 Xabarlar
    + Qo'shimcha ravishda vaqtinchalik admin kodini va o'chirish vaqtini sozlash tugmasi.
    """
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_STATS), KeyboardButton(text=BTN_USERS)],
            [KeyboardButton(text=BTN_BROADCAST), KeyboardButton(text=BTN_CHANNELS)],
            [KeyboardButton(text=BTN_MESSAGES), KeyboardButton(text=BTN_SECURITY_SETTINGS)],
        ],
        resize_keyboard=True,
        input_field_placeholder="Admin bo‘limini tanlang yoki maxsus kod yuboring...",
    )


def build_temp_admin_kb() -> ReplyKeyboardMarkup:
    """
    30 daqiqalik vaqtinchalik admin klaviaturasi.
    Asosiy admin huquqlariga (Foydalanuvchilar shaxsiy ma'lumotlari, Kanallarni o'chirish,
    Ommaviy reklama, Admin huquqi berish) ega emas! Faqat umumiy statistika va Xabarlar bilan ishlay oladi.
    """
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_STATS), KeyboardButton(text=BTN_MESSAGES)],
            [KeyboardButton(text="👤 Oddiy rejimga qaytish")],
        ],
        resize_keyboard=True,
        input_field_placeholder="Vaqtinchalik admin rejimi (30 daqiqa)...",
    )


def build_users_pagination_kb(
    current_index: int, total_count: int, target_telegram_id: int
) -> InlineKeyboardMarkup:
    """
    8.2. FOYDALANUVCHILAR sahifalash tizimi:
    - ◀️ Oldingi
    - ▶️ Keyingi
    - 🔎 ID bo‘yicha qidirish
    - 🔙 Orqaga
    """
    prev_idx = max(0, current_index - 1)
    next_idx = min(max(0, total_count - 1), current_index + 1)

    nav_row: list[InlineKeyboardButton] = []
    if current_index > 0:
        nav_row.append(
            InlineKeyboardButton(text="◀️ Oldingi", callback_data=f"adm_users:page:{prev_idx}")
        )
    nav_row.append(
        InlineKeyboardButton(
            text=f"📄 {current_index + 1}/{max(1, total_count)}",
            callback_data="adm_users:noop",
        )
    )
    if current_index < total_count - 1:
        nav_row.append(
            InlineKeyboardButton(text="▶️ Keyingi", callback_data=f"adm_users:page:{next_idx}")
        )

    rows = [
        nav_row,
        [
            InlineKeyboardButton(
                text="🔎 ID bo‘yicha qidirish", callback_data="adm_users:search"
            )
        ],
        [
            InlineKeyboardButton(
                text="🔙 Orqaga", callback_data="adm_users:back"
            )
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def build_broadcast_confirm_kb() -> InlineKeyboardMarkup:
    """8.3. REKLAMA tasdiqlash tugmalari: Yuborish va Bekor qilish."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Yuborish", callback_data="adm_bc:confirm"),
                InlineKeyboardButton(text="❌ Bekor qilish", callback_data="adm_bc:cancel"),
            ]
        ]
    )


def build_channels_menu_kb() -> InlineKeyboardMarkup:
    """
    8.4. KANALLAR menyusi:
    - ➕ Kanal qo‘shish
    - 📋 Kanallar ro‘yxati
    - ✏️ Kanalni o‘zgartirish
    - 🗑 Kanalni o‘chirish
    - 🔙 Orqaga
    """
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="➕ Kanal qo‘shish", callback_data="adm_ch:add"),
                InlineKeyboardButton(text="📋 Kanallar ro‘yxati", callback_data="adm_ch:list"),
            ],
            [
                InlineKeyboardButton(text="✏️ Kanalni o‘zgartirish", callback_data="adm_ch:edit_select"),
                InlineKeyboardButton(text="🗑 Kanalni o‘chirish", callback_data="adm_ch:del_select"),
            ],
            [
                InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_ch:back"),
            ],
        ]
    )


def build_channel_selector_kb(
    channels: Sequence[Channel], action_prefix: str
) -> InlineKeyboardMarkup:
    """Kanalni tahrirlash yoki o'chirish uchun ro'yxatdan tanlash tugmalari."""
    rows: list[list[InlineKeyboardButton]] = []
    for idx, ch in enumerate(channels, start=1):
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{idx}. {ch.title} ({ch.channel_id})",
                    callback_data=f"{action_prefix}:{ch.id}",
                )
            ]
        )
    rows.append(
        [InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_ch:menu")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def build_messages_menu_kb() -> InlineKeyboardMarkup:
    """
    8.5. XABARLAR menyusi:
    - ➕ Xabar qo‘shish
    - 📋 Mavjud xabarlar
    - 🔙 Orqaga
    """
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="➕ Xabar qo‘shish", callback_data="adm_msg:add"),
                InlineKeyboardButton(text="📋 Mavjud xabarlar", callback_data="adm_msg:list:0"),
            ],
            [
                InlineKeyboardButton(text="🔎 Kod bo‘yicha qidirish", callback_data="adm_msg:search"),
            ],
            [
                InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_msg:back"),
            ],
        ]
    )


def build_content_collect_kb(items_count: int) -> InlineKeyboardMarkup:
    """Xabar/albom qo'shish jarayonida bir nechta fayl yig'ilgach kod kiritishga o'tish klaviaturasi."""
    rows: list[list[InlineKeyboardButton]] = []
    if items_count > 0:
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"✅ Tayyor — Kod biriktirish ({items_count} ta element)",
                    callback_data="adm_msg:finish_items",
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="❌ Bekor qilish",
                callback_data="adm_msg:cancel_add",
            )
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def build_contents_list_kb(
    contents: Sequence[Content], page: int, total_pages: int
) -> InlineKeyboardMarkup:
    """Saqlangan xabarlar va kodlar ro'yxati hamda sahifalash."""
    rows: list[list[InlineKeyboardButton]] = []
    for item in contents:
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"🔑 {item.code} | {item.content_type.upper()} | 👁 {item.usage_count}",
                    callback_data=f"adm_msg:view:{item.id}:{page}",
                )
            ]
        )

    nav_row: list[InlineKeyboardButton] = []
    if page > 0:
        nav_row.append(
            InlineKeyboardButton(text="◀️ Oldingi", callback_data=f"adm_msg:list:{page - 1}")
        )
    nav_row.append(
        InlineKeyboardButton(
            text=f"📄 {page + 1}/{max(1, total_pages)}", callback_data="adm_msg:noop"
        )
    )
    if page < total_pages - 1:
        nav_row.append(
            InlineKeyboardButton(text="▶️ Keyingi", callback_data=f"adm_msg:list:{page + 1}")
        )
    if nav_row:
        rows.append(nav_row)

    rows.append(
        [
            InlineKeyboardButton(text="🔎 Kod bo‘yicha qidirish", callback_data="adm_msg:search"),
            InlineKeyboardButton(text="➕ Yangi xabar", callback_data="adm_msg:add"),
        ]
    )
    rows.append(
        [InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_msg:menu")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def build_content_detail_kb(content_id: int, page: int = 0) -> InlineKeyboardMarkup:
    """Tanlangan kod/kontentni ko'rish, kodini o'zgartirish va o'chirish tugmalari."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="👁 Kontentni ko‘rish", callback_data=f"adm_msg:preview:{content_id}"
                ),
                InlineKeyboardButton(
                    text="✏️ Kodni o‘zgartirish", callback_data=f"adm_msg:editcode:{content_id}:{page}"
                ),
            ],
            [
                InlineKeyboardButton(
                    text="🗑 Kontentni o‘chirish", callback_data=f"adm_msg:del:{content_id}:{page}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="🔙 Ro‘yxatga qaytish", callback_data=f"adm_msg:list:{page}"
                )
            ],
        ]
    )


def build_security_settings_kb() -> InlineKeyboardMarkup:
    """Asosiy admin uchun vaqtinchalik admin kodi va avto-o'chirish muddatini boshqarish."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔑 30 daqiqalik admin kodini o‘rnatish",
                    callback_data="adm_sec:set_temp_code",
                )
            ],
            [
                InlineKeyboardButton(
                    text="⏳ Xabarlarni o‘chirish vaqtini o‘zgartirish",
                    callback_data="adm_sec:set_del_delay",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🚫 Vaqtinchalik adminlarni bekor qilish",
                    callback_data="adm_sec:revoke_all_temp",
                )
            ],
            [
                InlineKeyboardButton(
                    text="📜 Oxirgi audit loglarni ko‘rish",
                    callback_data="adm_sec:audit_logs",
                )
            ],
        ]
    )
