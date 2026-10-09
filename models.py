"""
WORKING CODE — PostgreSQL ma'lumotlar bazasi modellari (SQLAlchemy 2.x).
Talab etilgan barcha 10 ta asosiy jadval + vaqtinchalik xabarlarni o'chirish jadvali.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    """1. Users — Bot foydalanuvchilari jadvali."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    last_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_phone_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    is_subscribed_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # Yosh faqat foydalanuvchi alohida taqdim etgan bo'lsagina yoziladi, hech qachon taxmin qilinmaydi
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    # Brute-force himoyasi uchun ustunlar
    failed_code_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Foydalanuvchiga yuborilgan oxirgi obuna ogohlantirish xabari ID'si (faqat bot xabarini o'chirish uchun)
    last_prompt_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now(), index=True
    )
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
        index=True,
    )

    access_logs: Mapped[List["ContentAccessLog"]] = relationship(
        "ContentAccessLog", back_populates="user", cascade="all, delete-orphan"
    )
    temp_admin_records: Mapped[List["TemporaryAdmin"]] = relationship(
        "TemporaryAdmin", back_populates="user", cascade="all, delete-orphan"
    )


class Channel(Base):
    """2. Channels — Majburiy obuna kanallari (1 tadan 10 tagacha)."""

    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    invite_link: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    added_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )


class Content(Base):
    """3. Contents — Maxsus kodga biriktirilgan kontent yozuvi."""

    __tablename__ = "contents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Kod har doim katta harflarda (UPPERCASE) saqlanadi, qidiruvda case-insensitive ishlaydi
    code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    is_album: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    items: Mapped[List["ContentItem"]] = relationship(
        "ContentItem",
        back_populates="content",
        cascade="all, delete-orphan",
        order_by="ContentItem.item_order.asc()",
    )
    access_logs: Mapped[List["ContentAccessLog"]] = relationship(
        "ContentAccessLog", back_populates="content", cascade="all, delete-orphan"
    )


class ContentItem(Base):
    """4. ContentItems — Kontent tarkibidagi alohida fayl yoki matn elementlari (albom va multi-item uchun)."""

    __tablename__ = "content_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    content_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("contents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    media_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # text, photo, video, audio, voice, animation, document, sticker
    file_id: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    text_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    content: Mapped["Content"] = relationship("Content", back_populates="items")

    __table_args__ = (Index("ix_content_items_content_order", "content_id", "item_order"),)


class ContentAccessLog(Base):
    """5. ContentAccessLogs — Kod orqali olingan kontentlar statistikasi va tarixi."""

    __tablename__ = "content_access_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    content_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("contents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_used: Mapped[str] = mapped_column(String(100), nullable=False)
    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now(), index=True
    )

    user: Mapped["User"] = relationship("User", back_populates="access_logs")
    content: Mapped["Content"] = relationship("Content", back_populates="access_logs")


class TemporaryAdmin(Base):
    """6. TemporaryAdmins — 30 daqiqalik vaqtinchalik adminlar jadvali."""

    __tablename__ = "temporary_admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="temp_admin_records")


class BotSetting(Base):
    """7. BotSettings — Botning dinamik sozlamalari (vaqtinchalik admin maxfiy kodi, o'chirish vaqti va h.k.)."""

    __tablename__ = "bot_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )


class Broadcast(Base):
    """8. Broadcasts — Ommaviy reklama jo'natmalari jadvali."""

    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    from_chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_id: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    caption_or_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", index=True
    )  # pending, running, completed, cancelled
    total_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blocked_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    recipients: Mapped[List["BroadcastRecipient"]] = relationship(
        "BroadcastRecipient", back_populates="broadcast", cascade="all, delete-orphan"
    )


class BroadcastRecipient(Base):
    """9. BroadcastRecipients — Reklama yuboriladigan har bir foydalanuvchi holati (qayta ishga tushganda davom etish uchun)."""

    __tablename__ = "broadcast_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    broadcast_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("broadcasts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", index=True
    )  # pending, sent, blocked, failed
    error_message: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    broadcast: Mapped["Broadcast"] = relationship("Broadcast", back_populates="recipients")

    __table_args__ = (
        UniqueConstraint("broadcast_id", "telegram_id", name="uq_broadcast_recipient_tg"),
        Index("ix_broadcast_recipient_status", "broadcast_id", "status"),
    )


class AuditLog(Base):
    """10. AuditLogs — Vaqtinchalik va asosiy admin harakatlari xavfsizlik logi."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)  # main_admin, temp_admin, system
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    target_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now(), index=True
    )


class ScheduledMessageDeletion(Base):
    """Bot yuborgan vaqtinchalik xabarlarni belgilangan vaqt o'tgach o'chirish jadvali."""

    __tablename__ = "scheduled_message_deletions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="temp")
    delete_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
