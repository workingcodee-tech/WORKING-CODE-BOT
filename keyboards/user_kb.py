"""
WORKING CODE — Oddiy foydalanuvchilar uchun klaviaturalar (O'zbek tilida).
Oddiy foydalanuvchi obuna va telefon tasdig'idan o'tgach, pastda umuman tugma bo'lmaydi
(ReplyKeyboardRemove), u darhol maxsus kodlarni yozib yuboraveradi.
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
    """Obuna bo'linmagan majburiy kanallar ro'yxatini Inline tugmalar ko'rinishida chiqaradi."""
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


def build_verified_user_kb(is_temp_admin: bool = False) -> ReplyKeyboardMarkup | ReplyKeyboardRemove:
    """
    Oddiy foydalanuvchi obuna va telefonni tasdiqlagach, pastda umuman tugma bo'lmaydi
    (ReplyKeyboardRemove qaytariladi) — foydalanuvchi to'g'ridan-to'g'ri kod yuboradi.
    Faqat 30 daqiqalik vaqtinchalik admin bo'lsagina admin paneliga o'tish tugmasi chiqadi.
    """
    if is_temp_admin:
        return ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text="⏱ Vaqtinchalik Admin Paneli")],
            ],
            resize_keyboard=True,
            input_field_placeholder="Maxsus kodni yozib yuboring...",
        )
    return ReplyKeyboardRemove()


def remove_kb() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()
