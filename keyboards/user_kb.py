"""
WORKING CODE — Oddiy foydalanuvchilar uchun barcha Reply va Inline klaviaturalar (O'zbek tilida).
"""

from __future__ import annotations

from typing import Sequence

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)

from models import Channel


def build_subscription_inline_kb(channels: Sequence[Channel]) -> InlineKeyboardMarkup:
    """
    Obuna bo'linmagan majburiy kanallar ro'yxatini Inline tugmalar ko'rinishida chiqaradi.
    Foydalanuvchi kanalga kirib obuna bo'lishi bilan chat_member hodisasi orqali avtomatik ochiladi,
    lekin Telegram kechikishlari uchun zaxira 'Obunani tekshirish' tugmasi ham qo'shiladi.
    """
    rows: list[list[InlineKeyboardButton]] = []
    for idx, ch in enumerate(channels, start=1):
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"📢 {idx}. {ch.title} — Obuna bo‘lish",
                    url=ch.invite_link,
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="🔄 Obunani qayta tekshirish",
                callback_data="user:check_sub",
            )
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def build_phone_request_kb() -> ReplyKeyboardMarkup:
    """request_contact=True bilan foydalanuvchining o'z telefon raqamini tasdiqlash klaviaturasi."""
    return ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(
                    text="📱 Telefon raqamni tasdiqlash",
                    request_contact=True,
                )
            ]
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
        input_field_placeholder="Pastdagi tugma orqali kontaktingizni yuboring...",
    )


def build_verified_user_kb(is_temp_admin: bool = False) -> ReplyKeyboardMarkup:
    """
    Obuna va telefon tasdiqlangandan keyingi asosiy foydalanuvchi klaviaturasi.
    Agar foydalanuvchi 30 daqiqalik vaqtinchalik admin bo'lsa, maxsus tugmalar qo'shiladi.
    """
    rows: list[list[KeyboardButton]] = [
        [
            KeyboardButton(text="🔑 Kod yuborish bo‘yicha yo‘riqnoma"),
            KeyboardButton(text="👤 Mening ma’lumotlarim"),
        ],
        [
            KeyboardButton(text="🎂 Yoshni kiritish (ixtiyoriy)"),
        ],
    ]
    if is_temp_admin:
        rows.insert(
            0,
            [
                KeyboardButton(text="⏱ Vaqtinchalik Admin Paneli"),
            ],
        )
    return ReplyKeyboardMarkup(
        keyboard=rows,
        resize_keyboard=True,
        input_field_placeholder="Maxsus kodni yozib yuboring (masalan: VIDEO2026)...",
    )


def remove_kb() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()
