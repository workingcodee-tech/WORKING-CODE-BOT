"""
WORKING CODE — Admin va vaqtinchalik admin harakatlarini audit logga yozish xizmati.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from models import AuditLog

logger = logging.getLogger(__name__)


async def log_admin_action(
    session: AsyncSession,
    actor_telegram_id: int,
    actor_role: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    """Har bir muhim boshqaruv harakatini bazadagi audit_logs jadvaliga yozadi."""
    entry = AuditLog(
        actor_telegram_id=actor_telegram_id,
        actor_role=actor_role,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        details=details,
    )
    session.add(entry)
    logger.info(
        "AUDIT [%s | ID:%s] -> %s (target=%s:%s) %s",
        actor_role,
        actor_telegram_id,
        action,
        target_type,
        target_id,
        details or "",
    )
