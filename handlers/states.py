"""
WORKING CODE — FSM (Finite State Machine) holatlari.
"""

from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class UserStates(StatesGroup):
    waiting_for_age = State()


class AdminUserSearchStates(StatesGroup):
    waiting_for_user_id = State()


class ChannelManageStates(StatesGroup):
    waiting_for_new_channel = State()
    waiting_for_edit_channel_data = State()


class ContentManageStates(StatesGroup):
    collecting_items = State()
    waiting_for_code = State()
    waiting_for_new_code_edit = State()
    waiting_for_search_code = State()


class BroadcastStates(StatesGroup):
    waiting_for_broadcast_content = State()
    waiting_for_confirmation = State()


class SecuritySettingsStates(StatesGroup):
    waiting_for_temp_admin_code = State()
    waiting_for_delete_delay = State()
