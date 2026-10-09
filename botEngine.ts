/**
 * WORKING CODE — To'liq funksional Telegram Bot Dvigateli (TypeScript / Node.js).
 * Railway yoki AI Studio'da Node.js (npm start / server.ts) orqali ishga tushganda
 * hech qanday tashqi Python paketlarisiz (aiogram siz ham) to'g'ridan-to'g'ri
 * Telegram Bot API bilan 100% barcha talablarni bajarib 24/7 ishlaydi!
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface StoredUser {
  id: number;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  phone_number: string | null;
  is_phone_verified: boolean;
  is_subscribed_all: boolean;
  age: number | null;
  is_blocked: boolean;
  failed_code_attempts: number;
  locked_until: number | null;
  last_prompt_message_id: number | null;
  joined_at: string;
  last_active_at: string;
}

interface StoredChannel {
  id: number;
  channel_id: number;
  title: string;
  username: string | null;
  invite_link: string;
  is_active: boolean;
  added_by: number;
  created_at: string;
}

interface StoredContentItem {
  media_type: 'text' | 'photo' | 'video' | 'audio' | 'voice' | 'animation' | 'document' | 'sticker';
  file_id: string | null;
  text_content: string | null;
  caption: string | null;
}

interface StoredContent {
  id: number;
  code: string;
  content_type: string;
  is_album: boolean;
  usage_count: number;
  created_by: number;
  created_at: string;
  items: StoredContentItem[];
}

interface StoredTempAdmin {
  telegram_id: number;
  granted_at: number;
  expires_at: number;
  is_active: boolean;
}

interface StoredAuditLog {
  id: number;
  actor_telegram_id: number;
  actor_role: 'main_admin' | 'temp_admin';
  action: string;
  details: string;
  created_at: string;
}

interface StoredBroadcastStats {
  total_campaigns: number;
  sent_count: number;
  blocked_count: number;
  failed_count: number;
}

interface ScheduledDeletion {
  chat_id: number;
  message_id: number;
  delete_at: number;
}

interface BotDatabaseState {
  users: StoredUser[];
  channels: StoredChannel[];
  contents: StoredContent[];
  access_logs_count: number;
  temp_admins: StoredTempAdmin[];
  audit_logs: StoredAuditLog[];
  broadcast_stats: StoredBroadcastStats;
  temp_admin_code_hash: string | null;
  temp_admin_code_masked: string | null;
  temp_msg_delete_seconds: number;
  scheduled_deletions: ScheduledDeletion[];
}

type SessionStep =
  | { mode: 'idle' }
  | { mode: 'waiting_for_user_id' }
  | { mode: 'waiting_for_new_channel' }
  | { mode: 'waiting_for_edit_channel'; channelDbId: number }
  | { mode: 'collecting_items'; items: StoredContentItem[] }
  | { mode: 'waiting_for_code'; items: StoredContentItem[] }
  | { mode: 'waiting_for_new_code_edit'; contentId: number; page: number }
  | { mode: 'waiting_for_search_code' }
  | { mode: 'waiting_for_broadcast_content' }
  | {
      mode: 'waiting_for_broadcast_confirm';
      fromChatId: number;
      messageId: number;
      item: StoredContentItem;
    }
  | { mode: 'waiting_for_temp_admin_code' }
  | { mode: 'waiting_for_delete_delay' };

const BTN_STATS = '📊 Statistika';
const BTN_USERS = '👥 Foydalanuvchilar';
const BTN_BROADCAST = '📢 Reklama';
const BTN_CHANNELS = '📡 Kanallar';
const BTN_MESSAGES = '📂 Xabarlar';
const BTN_SECURITY_SETTINGS = '🔐 Maxfiy kod va sozlamalar';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTashkentTime(isoOrDate?: string | number | Date): string {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  return d.toLocaleString('ru-RU', {
    timeZone: process.env.TIMEZONE || 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function cleanEnvValue(raw?: string): string {
  if (!raw) return '';
  let v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export class WorkingCodeTelegramBot {
  private token: string;
  private adminId: number;
  private apiBase: string;
  private dbPath: string;
  private state: BotDatabaseState;
  private userSessions: Map<number, SessionStep> = new Map();
  private lastMessageTime: Map<number, number> = new Map();
  private offset = 0;
  private isRunning = false;
  private botId = 0;
  private botUsername = '';

  constructor(token: string, adminId: number) {
    this.token = token;
    this.adminId = adminId;
    this.apiBase = `https://api.telegram.org/bot${this.token}`;

    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'working_code_state.json');
    this.state = this.loadState();
  }

  private loadState(): BotDatabaseState {
    const defaultDeleteSec = Math.max(
      10,
      parseInt(cleanEnvValue(process.env.TEMP_MSG_DELETE_SECONDS) || '45', 10) || 45
    );
    const defaultState: BotDatabaseState = {
      users: [],
      channels: [],
      contents: [],
      access_logs_count: 0,
      temp_admins: [],
      audit_logs: [],
      broadcast_stats: {
        total_campaigns: 0,
        sent_count: 0,
        blocked_count: 0,
        failed_count: 0,
      },
      temp_admin_code_hash: null,
      temp_admin_code_masked: null,
      temp_msg_delete_seconds: defaultDeleteSec,
      scheduled_deletions: [],
    };

    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...defaultState, ...parsed };
      }
    } catch (e) {
      console.warn('[WORKING CODE Bot] Baza faylini o‘qishda xatolik, yangi holat yaratiladi.');
    }
    return defaultState;
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error('[WORKING CODE Bot] Baza faylini saqlashda xatolik:', e);
    }
  }

  private async callApi(method: string, payload: Record<string, any> = {}): Promise<any> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      const err: any = new Error(data.description || `Telegram API error on ${method}`);
      err.error_code = data.error_code;
      err.parameters = data.parameters;
      throw err;
    }
    return data.result;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    try {
      const me = await this.callApi('getMe');
      this.botId = me.id;
      this.botUsername = me.username || 'working_code_bot';
      await this.callApi('deleteWebhook', { drop_pending_updates: false });
      this.isRunning = true;
      console.log(
        `✅ [WORKING CODE Bot] Muvaffaqiyatli ishga tushdi: @${this.botUsername} (ID: ${this.botId}) | Asosiy Admin ID: ${this.adminId}`
      );
      this.pollLoop();
      this.cleanupLoop();
    } catch (err: any) {
      console.warn(
        `ℹ️ [WORKING CODE Bot] BOT_TOKEN tekshiruvi: haqiqiy token kiritilmagan yoki noto‘g‘ri (${err.message}). Simulyator rejimi faol.`
      );
    }
  }

  private async cleanupLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        const due = this.state.scheduled_deletions.filter((d) => d.delete_at <= now);
        if (due.length > 0) {
          this.state.scheduled_deletions = this.state.scheduled_deletions.filter(
            (d) => d.delete_at > now
          );
          for (const item of due) {
            try {
              await this.callApi('deleteMessage', {
                chat_id: item.chat_id,
                message_id: item.message_id,
              });
            } catch {
              // Xabar allaqachon o'chirilgan bo'lishi mumkin
            }
          }
          this.saveState();
        }
      } catch {
        // Ignore cleanup loop errors
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  private scheduleBotMsgDelete(chatId: number, messageId: number): void {
    const delayMs = (this.state.temp_msg_delete_seconds || 45) * 1000;
    this.state.scheduled_deletions.push({
      chat_id: chatId,
      message_id: messageId,
      delete_at: Date.now() + delayMs,
    });
    this.saveState();
  }

  private async safeDeleteBotMsg(chatId: number, messageId?: number | null): Promise<void> {
    if (!messageId) return;
    try {
      await this.callApi('deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch {
      // Ignore
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const updates = await this.callApi('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.handleUpdate(update).catch((err) => {
            console.error('[WORKING CODE Bot] Update qayta ishlashda xato:', err.message);
          });
        }
      } catch (err: any) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private upsertUser(tgUser: any): StoredUser {
    const nowIso = new Date().toISOString();
    let user = this.state.users.find((u) => u.telegram_id === tgUser.id);
    if (!user) {
      user = {
        id: this.state.users.length + 1,
        telegram_id: tgUser.id,
        first_name: tgUser.first_name || 'Foydalanuvchi',
        last_name: tgUser.last_name || null,
        username: tgUser.username || null,
        phone_number: null,
        is_phone_verified: false,
        is_subscribed_all: false,
        age: null,
        is_blocked: false,
        failed_code_attempts: 0,
        locked_until: null,
        last_prompt_message_id: null,
        joined_at: nowIso,
        last_active_at: nowIso,
      };
      this.state.users.push(user);
    } else {
      user.first_name = tgUser.first_name || user.first_name;
      user.last_name = tgUser.last_name || null;
      user.username = tgUser.username || null;
      user.is_blocked = false;
      user.last_active_at = nowIso;
    }
    this.saveState();
    return user;
  }

  private getActiveTempAdmin(telegramId: number): StoredTempAdmin | null {
    const now = Date.now();
    let changed = false;
    for (const ta of this.state.temp_admins) {
      if (ta.is_active && ta.expires_at <= now) {
        ta.is_active = false;
        changed = true;
      }
    }
    if (changed) this.saveState();
    return (
      this.state.temp_admins.find(
        (ta) => ta.telegram_id === telegramId && ta.is_active && ta.expires_at > now
      ) || null
    );
  }

  private logAudit(
    actorId: number,
    actorRole: 'main_admin' | 'temp_admin',
    action: string,
    details: string
  ): void {
    this.state.audit_logs.unshift({
      id: this.state.audit_logs.length + 1,
      actor_telegram_id: actorId,
      actor_role: actorRole,
      action,
      details,
      created_at: new Date().toISOString(),
    });
    if (this.state.audit_logs.length > 200) {
      this.state.audit_logs = this.state.audit_logs.slice(0, 200);
    }
    this.saveState();
  }

  private async checkSubscriptions(telegramId: number): Promise<{
    allSubscribed: boolean;
    unsubscribed: StoredChannel[];
  }> {
    const activeChannels = this.state.channels.filter((c) => c.is_active);
    if (activeChannels.length === 0) {
      return { allSubscribed: true, unsubscribed: [] };
    }

    const unsubscribed: StoredChannel[] = [];
    for (const ch of activeChannels) {
      try {
        const member = await this.callApi('getChatMember', {
          chat_id: ch.channel_id,
          user_id: telegramId,
        });
        const status = member.status;
        const isOk =
          status === 'creator' ||
          status === 'administrator' ||
          status === 'member' ||
          (status === 'restricted' && member.is_member);
        if (!isOk) {
          unsubscribed.push(ch);
        }
      } catch {
        unsubscribed.push(ch);
      }
    }

    const allSubscribed = unsubscribed.length === 0;
    const user = this.state.users.find((u) => u.telegram_id === telegramId);
    if (user && user.is_subscribed_all !== allSubscribed) {
      user.is_subscribed_all = allSubscribed;
      this.saveState();
    }
    return { allSubscribed, unsubscribed };
  }

  private buildSubscriptionInlineKb(channels: StoredChannel[]) {
    const inline_keyboard: any[][] = channels.map((ch, i) => [
      {
        text: `📢 ${i + 1}. ${ch.title} — Obuna bo‘lish`,
        url: ch.invite_link,
      },
    ]);
    inline_keyboard.push([
      {
        text: '🔄 Obunani qayta tekshirish',
        callback_data: 'user:check_sub',
      },
    ]);
    return { inline_keyboard };
  }

  private buildPhoneRequestKb() {
    return {
      keyboard: [
        [
          {
            text: '📱 Telefon raqamni tasdiqlash',
            request_contact: true,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }

  private buildVerifiedUserKb(isTempAdmin: boolean) {
    if (isTempAdmin) {
      return {
        keyboard: [[{ text: '⏱ Vaqtinchalik Admin Paneli' }]],
        resize_keyboard: true,
      };
    }
    return {
      remove_keyboard: true,
    };
  }

  private buildMainAdminKb() {
    return {
      keyboard: [
        [{ text: BTN_STATS }, { text: BTN_USERS }],
        [{ text: BTN_BROADCAST }, { text: BTN_CHANNELS }],
        [{ text: BTN_MESSAGES }, { text: BTN_SECURITY_SETTINGS }],
      ],
      resize_keyboard: true,
    };
  }

  private buildTempAdminKb() {
    return {
      keyboard: [
        [{ text: BTN_STATS }, { text: BTN_MESSAGES }],
        [{ text: '👤 Oddiy rejimga qaytish' }],
      ],
      resize_keyboard: true,
    };
  }

  private buildChannelsMenuKb() {
    return {
      inline_keyboard: [
        [
          { text: '➕ Kanal qo‘shish', callback_data: 'adm_ch:add' },
          { text: '📋 Kanallar ro‘yxati', callback_data: 'adm_ch:list' },
        ],
        [
          { text: '✏️ Kanalni o‘zgartirish', callback_data: 'adm_ch:edit_select' },
          { text: '🗑 Kanalni o‘chirish', callback_data: 'adm_ch:del_select' },
        ],
        [{ text: '🔙 Orqaga', callback_data: 'adm_ch:back' }],
      ],
    };
  }

  private buildMessagesMenuKb() {
    return {
      inline_keyboard: [
        [
          { text: '➕ Xabar qo‘shish', callback_data: 'adm_msg:add' },
          { text: '📋 Mavjud xabarlar', callback_data: 'adm_msg:list:0' },
        ],
        [{ text: '🔎 Kod bo‘yicha qidirish', callback_data: 'adm_msg:search' }],
        [{ text: '🔙 Orqaga', callback_data: 'adm_msg:back' }],
      ],
    };
  }

  private async handleUpdate(update: any): Promise<void> {
    if (update.chat_member) {
      await this.handleChatMemberUpdate(update.chat_member);
      return;
    }
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }
    if (update.message) {
      await this.handleMessage(update.message);
    }
  }

  private async handleChatMemberUpdate(event: any): Promise<void> {
    const targetUser = event.new_chat_member?.user;
    if (!targetUser || targetUser.is_bot || targetUser.id === this.adminId) return;

    const ch = this.state.channels.find(
      (c) => c.channel_id === event.chat?.id && c.is_active
    );
    if (!ch) return;

    const dbUser = this.state.users.find((u) => u.telegram_id === targetUser.id);
    if (!dbUser) return;

    const wasSub = dbUser.is_subscribed_all;
    const { allSubscribed, unsubscribed } = await this.checkSubscriptions(targetUser.id);

    if (allSubscribed && !wasSub) {
      if (dbUser.last_prompt_message_id) {
        await this.safeDeleteBotMsg(dbUser.telegram_id, dbUser.last_prompt_message_id);
        dbUser.last_prompt_message_id = null;
        this.saveState();
      }
      if (dbUser.is_phone_verified) {
        const tempAdm = this.getActiveTempAdmin(dbUser.telegram_id);
        await this.callApi('sendMessage', {
          chat_id: dbUser.telegram_id,
          parse_mode: 'HTML',
          text:
            '🎉 <b>Rahmat! Barcha kanallarga obuna bo‘lganingiz avtomatik tasdiqlandi.</b>\n\n' +
            'Telefon raqamingiz ham tasdiqlangan. Endi maxsus kodni yuborib, kerakli fayllarni olishingiz mumkin!',
          reply_markup: this.buildVerifiedUserKb(!!tempAdm),
        }).catch(() => {});
      } else {
        const sent = await this.callApi('sendMessage', {
          chat_id: dbUser.telegram_id,
          parse_mode: 'HTML',
          text:
            '✅ <b>Barcha kanallarga obuna bo‘ldingiz!</b>\n\n' +
            'Endi botdan to‘liq foydalanish uchun pastdagi tugma orqali telefon raqamingizni tasdiqlang:',
          reply_markup: this.buildPhoneRequestKb(),
        }).catch(() => null);
        if (sent) this.scheduleBotMsgDelete(dbUser.telegram_id, sent.message_id);
      }
    } else if (!allSubscribed && wasSub) {
      if (dbUser.last_prompt_message_id) {
        await this.safeDeleteBotMsg(dbUser.telegram_id, dbUser.last_prompt_message_id);
      }
      const warn = await this.callApi('sendMessage', {
        chat_id: dbUser.telegram_id,
        parse_mode: 'HTML',
        text:
          `⚠️ <b>Diqqat, ${escapeHtml(dbUser.first_name)}!</b>\n\n` +
          `Siz <b>«${escapeHtml(ch.title)}»</b> kanalini tark etdingiz. Shu sababli botning asosiy funksiyalari darhol bloklandi.\n\n` +
          `Qayta obuna bo‘lishingiz bilan barcha funksiyalar avtomatik ravishda ochiladi:`,
        reply_markup: this.buildSubscriptionInlineKb(unsubscribed),
      }).catch(() => null);
      if (warn) {
        dbUser.last_prompt_message_id = warn.message_id;
        this.saveState();
        this.scheduleBotMsgDelete(dbUser.telegram_id, warn.message_id);
      }
    }
  }

  private extractMediaItem(message: any): StoredContentItem | null {
    if (message.photo && message.photo.length > 0) {
      return {
        media_type: 'photo',
        file_id: message.photo[message.photo.length - 1].file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.video) {
      return {
        media_type: 'video',
        file_id: message.video.file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.audio) {
      return {
        media_type: 'audio',
        file_id: message.audio.file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.voice) {
      return {
        media_type: 'voice',
        file_id: message.voice.file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.animation) {
      return {
        media_type: 'animation',
        file_id: message.animation.file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.document) {
      return {
        media_type: 'document',
        file_id: message.document.file_id,
        caption: message.caption || null,
        text_content: null,
      };
    }
    if (message.sticker) {
      return {
        media_type: 'sticker',
        file_id: message.sticker.file_id,
        caption: null,
        text_content: null,
      };
    }
    if (message.text && !message.text.startsWith('/')) {
      return {
        media_type: 'text',
        file_id: null,
        caption: null,
        text_content: message.text,
      };
    }
    return null;
  }

  private async sendContentToUser(chatId: number, content: StoredContent): Promise<void> {
    const items = content.items || [];
    if (items.length === 0) {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ Ushbu kodga biriktirilgan fayllar topilmadi.',
      });
      return;
    }

    const groupable = new Set(['photo', 'video', 'audio', 'document']);
    if (
      items.length > 1 &&
      items.every((it) => groupable.has(it.media_type) && it.file_id)
    ) {
      const media = items.map((it, idx) => ({
        type: it.media_type,
        media: it.file_id,
        caption: idx === 0 ? it.caption || undefined : it.caption || undefined,
      }));
      try {
        await this.callApi('sendMediaGroup', {
          chat_id: chatId,
          media,
          protect_content: true,
        });
        return;
      } catch {
        // Fallback to sequential sending
      }
    }

    for (const it of items) {
      if (it.media_type === 'text') {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: it.text_content || '',
          protect_content: true,
        });
      } else if (it.media_type === 'photo' && it.file_id) {
        await this.callApi('sendPhoto', {
          chat_id: chatId,
          photo: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'video' && it.file_id) {
        await this.callApi('sendVideo', {
          chat_id: chatId,
          video: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'audio' && it.file_id) {
        await this.callApi('sendAudio', {
          chat_id: chatId,
          audio: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'voice' && it.file_id) {
        await this.callApi('sendVoice', {
          chat_id: chatId,
          voice: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'animation' && it.file_id) {
        await this.callApi('sendAnimation', {
          chat_id: chatId,
          animation: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'document' && it.file_id) {
        await this.callApi('sendDocument', {
          chat_id: chatId,
          document: it.file_id,
          caption: it.caption || undefined,
          protect_content: true,
        });
      } else if (it.media_type === 'sticker' && it.file_id) {
        await this.callApi('sendSticker', {
          chat_id: chatId,
          sticker: it.file_id,
          protect_content: true,
        });
      }
    }
  }

  private async verifyAndResolveChannel(rawInput: string): Promise<{
    ok: boolean;
    message: string;
    data?: { channel_id: number; title: string; username: string | null; invite_link: string };
  }> {
    let text = (rawInput || '').trim();
    if (!text) {
      return {
        ok: false,
        message: '❌ Kanal manzili bo‘sh! @username, kanal ID (-100...) yoki t.me havolasini yuboring.',
      };
    }

    const tmeMatch = text.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,64})/);
    if (tmeMatch && !text.includes('t.me/+') && !text.includes('joinchat')) {
      text = `@${tmeMatch[1]}`;
    } else if (!text.startsWith('@') && !/^-?\d+$/.test(text) && /^[A-Za-z0-9_]{4,64}$/.test(text)) {
      text = `@${text}`;
    }

    try {
      const chatIdOrUsername = /^-?\d+$/.test(text) ? Number(text) : text;
      const chat = await this.callApi('getChat', { chat_id: chatIdOrUsername });
      if (chat.type !== 'channel' && chat.type !== 'supergroup') {
        return { ok: false, message: '❌ Kiritilgan manzil Telegram kanal yoki superguruh emas!' };
      }

      const botMember = await this.callApi('getChatMember', {
        chat_id: chat.id,
        user_id: this.botId,
      });
      if (botMember.status !== 'administrator' && botMember.status !== 'creator') {
        return {
          ok: false,
          message: `❌ Bot «${chat.title}» kanalida administrator emas! Avval botni kanalga admin qiling.`,
        };
      }

      let inviteLink = chat.username ? `https://t.me/${chat.username}` : chat.invite_link;
      if (!inviteLink) {
        const created = await this.callApi('createChatInviteLink', { chat_id: chat.id });
        inviteLink = created.invite_link;
      }

      return {
        ok: true,
        message: '✅ Kanal muvaffaqiyatli tekshirildi.',
        data: {
          channel_id: chat.id,
          title: chat.title || String(chat.id),
          username: chat.username || null,
          invite_link: inviteLink,
        },
      };
    } catch (e: any) {
      return {
        ok: false,
        message:
          '❌ Kanal topilmadi yoki bot ushbu kanalda administrator emas!\nAvval botni kanalga admin qilib qo‘shing va qayta urinib ko‘ring.',
      };
    }
  }

  private formatUserCard(user: StoredUser, index: number, total: number): string {
    const tempAdm = this.getActiveTempAdmin(user.telegram_id);
    const tempStr = tempAdm
      ? `✅ Faol (${formatTashkentTime(tempAdm.expires_at)} gacha)`
      : '❌ Yo‘q';
    const ageStr = user.age !== null ? `${user.age} yosh` : 'Taqdim etilmagan';
    const uname = user.username ? `@${escapeHtml(user.username)}` : 'Mavjud emas';
    const lname = user.last_name ? escapeHtml(user.last_name) : '—';
    const phone = user.phone_number ? escapeHtml(user.phone_number) : 'Tasdiqlanmagan';

    return (
      `👤 <b>Foydalanuvchi ma’lumotlari (${index + 1} / ${Math.max(1, total)})</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 <b>Telegram ID:</b> <code>${user.telegram_id}</code>\n` +
      `🙍‍♂️ <b>Ism:</b> ${escapeHtml(user.first_name)}\n` +
      `🙍‍♂️ <b>Familiya:</b> ${lname}\n` +
      `🔗 <b>Username:</b> ${uname}\n` +
      `📞 <b>Telefon raqami:</b> <code>${phone}</code>\n` +
      `🎂 <b>Yosh:</b> ${ageStr}\n` +
      `📅 <b>Birinchi kirgan vaqti:</b> ${formatTashkentTime(user.joined_at)}\n` +
      `🕒 <b>Oxirgi faolligi:</b> ${formatTashkentTime(user.last_active_at)}\n` +
      `📡 <b>Kanal obunasi holati:</b> ${user.is_subscribed_all ? '✅ Obuna bo‘lgan' : '❌ Obuna bo‘lmagan'}\n` +
      `📱 <b>Telefon tasdig‘i holati:</b> ${user.is_phone_verified ? '✅ Tasdiqlangan' : '❌ Tasdiqlanmagan'}\n` +
      `🛡 <b>Vaqtinchalik admin huquqi:</b> ${tempStr}`
    );
  }

  private buildUsersPaginationKb(idx: number, total: number) {
    const prev = Math.max(0, idx - 1);
    const next = Math.min(Math.max(0, total - 1), idx + 1);
    const navRow: any[] = [];
    if (idx > 0) navRow.push({ text: '◀️ Oldingi', callback_data: `adm_users:page:${prev}` });
    navRow.push({ text: `📄 ${idx + 1}/${Math.max(1, total)}`, callback_data: 'adm_users:noop' });
    if (idx < total - 1) navRow.push({ text: '▶️ Keyingi', callback_data: `adm_users:page:${next}` });

    return {
      inline_keyboard: [
        navRow,
        [{ text: '🔎 ID bo‘yicha qidirish', callback_data: 'adm_users:search' }],
        [{ text: '🔙 Orqaga', callback_data: 'adm_users:back' }],
      ],
    };
  }

  private async handleMessage(message: any): Promise<void> {
    const fromUser = message.from;
    if (!fromUser || fromUser.is_bot) return;

    // Anti-flood (skip for albums)
    if (!message.media_group_id) {
      const nowMs = Date.now();
      const prevMs = this.lastMessageTime.get(fromUser.id) || 0;
      if (nowMs - prevMs < 300) return;
      this.lastMessageTime.set(fromUser.id, nowMs);
    }

    const dbUser = this.upsertUser(fromUser);
    const isMainAdmin = fromUser.id === this.adminId;
    const tempAdmin = isMainAdmin ? null : this.getActiveTempAdmin(fromUser.id);
    const isAnyAdmin = isMainAdmin || !!tempAdmin;
    const chatId = message.chat.id;
    const text = (message.text || '').trim();

    // 1. /start command
    if (text.startsWith('/start')) {
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      const safeName = escapeHtml(dbUser.first_name);

      if (isMainAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `👋 <b>Assalomu alaykum, Asosiy Administrator (${safeName})!</b>\n\n` +
            `🤖 <b>WORKING CODE</b> boshqaruv paneliga xush kelibsiz.\n` +
            `Quyidagi menyu tugmalari orqali tizimni to‘liq boshqarishingiz mumkin:`,
          reply_markup: this.buildMainAdminKb(),
        });
        return;
      }

      const welcomeMsg = await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `✨ <b>Assalomu alaykum, ${safeName}!</b>\n\n` +
          `<b>WORKING CODE</b> rasmiy botiga xush kelibsiz!\n` +
          `Bu yerda maxsus kodlar orqali eksklyuziv o‘quv materiallari, videolar, hujjatlar va fayllarni olishingiz mumkin.`,
      });
      this.scheduleBotMsgDelete(chatId, welcomeMsg.message_id);

      const { allSubscribed, unsubscribed } = await this.checkSubscriptions(dbUser.telegram_id);
      if (!allSubscribed) {
        if (dbUser.last_prompt_message_id) {
          await this.safeDeleteBotMsg(chatId, dbUser.last_prompt_message_id);
        }
        const subMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `📢 <b>Botdan to‘liq foydalanish uchun quyidagi rasmiy kanallarga obuna bo‘ling:</b>\n\n` +
            `Barcha kanallarga a’zo bo‘lishingiz bilan bot buni avtomatik aniqlaydi!`,
          reply_markup: this.buildSubscriptionInlineKb(unsubscribed),
        });
        dbUser.last_prompt_message_id = subMsg.message_id;
        this.saveState();
        this.scheduleBotMsgDelete(chatId, subMsg.message_id);
        return;
      }

      if (!dbUser.is_phone_verified) {
        const phoneMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `📱 <b>Telefon raqamingizni tasdiqlang:</b>\n\n` +
            `Nima uchun telefon raqami kerak?\n` +
            `• Foydalanuvchi xavfsizligini ta’minlash va botni spamdan himoyalash uchun;\n` +
            `• Maxsus kodlar orqali himoyalangan fayllarni faqat tasdiqlangan foydalanuvchilarga taqdim etish uchun.\n\n` +
            `👇 Pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini bosing:`,
          reply_markup: this.buildPhoneRequestKb(),
        });
        this.scheduleBotMsgDelete(chatId, phoneMsg.message_id);
        return;
      }

      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `✅ <b>Barcha shartlar bajarilgan!</b>\n\n` +
          `Kerakli fayl yoki materialni olish uchun uning <b>maxsus kodini</b> yozib yuboring (masalan: <code>VIDEO2026</code>):`,
        reply_markup: this.buildVerifiedUserKb(!!tempAdmin),
      });
      return;
    }

    // 2. Contact verification
    if (message.contact) {
      const contact = message.contact;
      if (contact.user_id !== fromUser.id) {
        const errMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `❌ <b>Xatolik: Boshqa shaxsning kontaktini yuborish mumkin emas!</b>\n\n` +
            `Iltimos, faqat pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini bosish orqali o‘zingizning shaxsiy Telegram kontaktingizni ulashing.`,
          reply_markup: this.buildPhoneRequestKb(),
        });
        this.scheduleBotMsgDelete(chatId, errMsg.message_id);
        return;
      }

      const digits = (contact.phone_number || '').replace(/[^\d]/g, '');
      dbUser.phone_number = digits ? `+${digits}` : contact.phone_number;
      dbUser.is_phone_verified = true;
      this.saveState();

      const { allSubscribed, unsubscribed } = await this.checkSubscriptions(dbUser.telegram_id);
      if (!allSubscribed) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '✅ <b>Telefon raqamingiz tasdiqlandi!</b>',
          reply_markup: { remove_keyboard: true },
        });
        const subMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `📢 <b>Endi quyidagi majburiy kanallarga obuna bo‘ling:</b>`,
          reply_markup: this.buildSubscriptionInlineKb(unsubscribed),
        });
        dbUser.last_prompt_message_id = subMsg.message_id;
        this.saveState();
        this.scheduleBotMsgDelete(chatId, subMsg.message_id);
        return;
      }

      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🎉 <b>Tabriklaymiz! Telefon raqamingiz va obunangiz tasdiqlandi.</b>\n\n` +
          `Kerakli fayl yoki videoni olish uchun <b>maxsus kodni</b> yozib yuboring (masalan: <code>VIDEO2026</code>):`,
        reply_markup: this.buildVerifiedUserKb(!!tempAdmin),
      });
      return;
    }

    // 3. Mandatory Subscription & Phone Verification Gatekeeper for non-main-admin
    if (!isMainAdmin) {
      const { allSubscribed, unsubscribed } = await this.checkSubscriptions(dbUser.telegram_id);
      if (!allSubscribed) {
        if (dbUser.last_prompt_message_id) {
          await this.safeDeleteBotMsg(chatId, dbUser.last_prompt_message_id);
        }
        const warnMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `⚠️ <b>Diqqat, ${escapeHtml(dbUser.first_name)}!</b>\n\n` +
            `Botning asosiy funksiyalaridan foydalanish uchun quyidagi majburiy kanallarga obuna bo‘lishingiz shart. Obuna bo‘lishingiz bilan bot avtomatik ravishda qayta ochiladi:`,
          reply_markup: this.buildSubscriptionInlineKb(unsubscribed),
        });
        dbUser.last_prompt_message_id = warnMsg.message_id;
        this.saveState();
        this.scheduleBotMsgDelete(chatId, warnMsg.message_id);
        return;
      }

      if (!dbUser.is_phone_verified) {
        const warnMsg = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `📱 <b>Telefon raqamni tasdiqlash talab etiladi!</b>\n\n` +
            `Xavfsizlikni ta’minlash va maxsus kodlar orqali fayllarni olish uchun o‘z Telegram kontaktingizni tasdiqlashingiz zarur.\n\n` +
            `👇 Pastdagi <b>«📱 Telefon raqamni tasdiqlash»</b> tugmasini bosing:`,
          reply_markup: this.buildPhoneRequestKb(),
        });
        this.scheduleBotMsgDelete(chatId, warnMsg.message_id);
        return;
      }
    }

    // 4. Main Admin & Temp Admin Menu Buttons
    if (text === BTN_STATS && isAnyAdmin) {
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      const now = Date.now();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const totalUsers = this.state.users.length;
      const todayUsers = this.state.users.filter(
        (u) => new Date(u.joined_at).getTime() >= startOfToday.getTime()
      ).length;
      const subUsers = this.state.users.filter((u) => u.is_subscribed_all).length;
      const phoneUsers = this.state.users.filter((u) => u.is_phone_verified).length;
      const activeUsers = this.state.users.filter((u) => !u.is_blocked).length;
      const tempAdminsCount = this.state.temp_admins.filter(
        (t) => t.is_active && t.expires_at > now
      ).length;

      if (!isMainAdmin && tempAdmin) {
        this.logAudit(fromUser.id, 'temp_admin', 'VIEW_STATISTICS', 'Vaqtinchalik admin statistikani ko‘rdi');
      }

      const bc = this.state.broadcast_stats;
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `📊 <b>WORKING CODE — Tizim Statistikasi</b>\n` +
          `🕒 Sana: <code>${formatTashkentTime()}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👥 <b>Foydalanuvchilar:</b>\n` +
          `• Jami ro‘yxatdan o‘tganlar: <b>${totalUsers}</b> ta\n` +
          `• Bugun qo‘shilganlar: <b>${todayUsers}</b> ta\n` +
          `• Barcha kanallarga obuna bo‘lganlar: <b>${subUsers}</b> ta\n` +
          `• Obuna bo‘lmaganlar: <b>${totalUsers - subUsers}</b> ta\n` +
          `• Telefon raqamini tasdiqlaganlar: <b>${phoneUsers}</b> ta\n` +
          `• Telefon raqamini tasdiqlamaganlar: <b>${totalUsers - phoneUsers}</b> ta\n` +
          `• Faol foydalanuvchilar: <b>${activeUsers}</b> ta\n` +
          `• Vaqtinchalik adminlar (faol): <b>${tempAdminsCount}</b> ta\n\n` +
          `📂 <b>Kontent va Kodlar:</b>\n` +
          `• Jami kontentlar va kodlar: <b>${this.state.contents.length}</b> ta\n` +
          `• Kontent yuborilishlari soni: <b>${this.state.access_logs_count}</b> marta\n\n` +
          `📢 <b>Reklama yuborish statistikasi:</b>\n` +
          `• Jami reklama kampaniyalari: <b>${bc.total_campaigns}</b> ta\n` +
          `• Muvaffaqiyatli yetkazilgan: <b>${bc.sent_count}</b> ta\n` +
          `• Botni bloklagan foydalanuvchilar: <b>${bc.blocked_count}</b> ta\n` +
          `• Xatolik qaytarganlar: <b>${bc.failed_count}</b> ta`,
      });
      return;
    }

    if (text === BTN_USERS) {
      if (!isMainAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '⛔️ <b>Ruxsat yo‘q!</b> Foydalanuvchilarning shaxsiy ma’lumotlari va telefon raqamlarini faqat Asosiy Administrator ko‘ra oladi.',
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      const total = this.state.users.length;
      if (total === 0) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '👥 Bazada hozircha ro‘yxatdan o‘tgan foydalanuvchilar yo‘q.',
        });
        return;
      }
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: this.formatUserCard(this.state.users[0], 0, total),
        reply_markup: this.buildUsersPaginationKb(0, total),
      });
      return;
    }

    if (text === BTN_BROADCAST) {
      if (!isMainAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '⛔️ <b>Ruxsat yo‘q!</b> Ommaviy reklama yuborish huquqi faqat Asosiy Administratorda mavjud.',
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'waiting_for_broadcast_content' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `📢 <b>Reklama yuborish bo‘limi</b>\n\n` +
          `• Bazadagi jami qabul qiluvchilar: <b>${this.state.users.length}</b> ta foydalanuvchi.\n\n` +
          `Reklama uchun istalgan turdagi kontentni (matn, rasm, video, audio, hujjat, animatsiya, ovozli xabar) yuboring.\n` +
          `<i>Bekor qilish uchun /start buyrug‘ini bosing.</i>`,
      });
      return;
    }

    if (text === BTN_CHANNELS) {
      if (!isMainAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '⛔️ <b>Ruxsat yo‘q!</b> Majburiy kanallarni faqat Asosiy Administrator boshqara oladi.',
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      const activeCh = this.state.channels.filter((c) => c.is_active);
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `📡 <b>Majburiy kanallarni boshqarish bo‘limi</b>\n\n` +
          `• Faol kanallar soni: <b>${activeCh.length} / 10</b> ta\n` +
          `• Ruxsat etilgan me’yor: <b>1–10</b> ta kanal.\n\n` +
          `Kerakli amalni tanlang:`,
        reply_markup: this.buildChannelsMenuKb(),
      });
      return;
    }

    if (text === BTN_MESSAGES && isAnyAdmin) {
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `📂 <b>Xabarlar va Maxsus Kodlar bo‘limi</b>\n\n` +
          `• Bazadagi jami kodlar soni: <b>${this.state.contents.length}</b> ta.\n` +
          `Quyidagi amallardan birini tanlang:`,
        reply_markup: this.buildMessagesMenuKb(),
      });
      return;
    }

    if (text === BTN_SECURITY_SETTINGS) {
      if (!isMainAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '⛔️ Ushbu bo‘lim faqat Asosiy Administrator uchun mo‘ljallangan!',
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      const masked = this.state.temp_admin_code_masked || 'O‘rnatilmagan';
      const activeTemps = this.state.temp_admins.filter(
        (t) => t.is_active && t.expires_at > Date.now()
      ).length;
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🔐 <b>Maxfiy kod va xavfsizlik sozlamalari</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔑 <b>30 daqiqalik admin kodi:</b> <code>${escapeHtml(masked)}</code>\n` +
          `⏱ <b>Faol vaqtinchalik adminlar:</b> <b>${activeTemps}</b> ta\n` +
          `⏳ <b>Vaqtinchalik xabarlarni o‘chirish muddati:</b> <b>${this.state.temp_msg_delete_seconds} soniya</b>`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔑 30 daqiqalik admin kodini o‘rnatish',
                callback_data: 'adm_sec:set_temp_code',
              },
            ],
            [
              {
                text: '⏳ Xabarlarni o‘chirish vaqtini o‘zgartirish',
                callback_data: 'adm_sec:set_del_delay',
              },
            ],
            [
              {
                text: '🚫 Vaqtinchalik adminlarni bekor qilish',
                callback_data: 'adm_sec:revoke_all_temp',
              },
            ],
            [
              {
                text: '📜 Oxirgi audit loglarni ko‘rish',
                callback_data: 'adm_sec:audit_logs',
              },
            ],
          ],
        },
      });
      return;
    }

    if (text === '⏱ Vaqtinchalik Admin Paneli') {
      if (!tempAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '⌛️ Sizning 30 daqiqalik vaqtinchalik adminlik muddatingiz yakunlangan.',
          reply_markup: { remove_keyboard: true },
        });
        return;
      }
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `⏱ <b>Vaqtinchalik Admin Paneli faol!</b>\n` +
          `Amal qilish muddati: <b>${formatTashkentTime(tempAdmin.expires_at)}</b> gacha.`,
        reply_markup: this.buildTempAdminKb(),
      });
      return;
    }

    if (text === '👤 Oddiy rejimga qaytish') {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: '👤 Oddiy foydalanuvchi rejimiga qaytdingiz. Maxsus kodlarni yozib yuborishingiz mumkin:',
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    // 5. Handle Active Session Steps (FSM)
    const step = this.userSessions.get(fromUser.id) || { mode: 'idle' };

    if (step.mode === 'waiting_for_user_id' && isMainAdmin) {
      if (!/^\d+$/.test(text)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Telegram ID faqat raqamlardan iborat bo‘lishi kerak. Qaytadan kiriting:',
        });
        return;
      }
      const targetIdx = this.state.users.findIndex((u) => u.telegram_id === Number(text));
      if (targetIdx === -1) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `❌ <code>${escapeHtml(text)}</code> ID raqamli foydalanuvchi bazada topilmadi.`,
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: this.formatUserCard(
          this.state.users[targetIdx],
          targetIdx,
          this.state.users.length
        ),
        reply_markup: this.buildUsersPaginationKb(targetIdx, this.state.users.length),
      });
      return;
    }

    if (step.mode === 'waiting_for_new_channel' && isMainAdmin) {
      const activeCount = this.state.channels.filter((c) => c.is_active).length;
      if (activeCount >= 10) {
        this.userSessions.set(fromUser.id, { mode: 'idle' });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Maksimal 10 ta kanal chegarasiga yetilgan!',
        });
        return;
      }
      const res = await this.verifyAndResolveChannel(text);
      if (!res.ok || !res.data) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: res.message,
        });
        return;
      }

      const existing = this.state.channels.find((c) => c.channel_id === res.data!.channel_id);
      if (existing) {
        existing.title = res.data.title;
        existing.username = res.data.username;
        existing.invite_link = res.data.invite_link;
        existing.is_active = true;
      } else {
        this.state.channels.push({
          id: Date.now(),
          channel_id: res.data.channel_id,
          title: res.data.title,
          username: res.data.username,
          invite_link: res.data.invite_link,
          is_active: true,
          added_by: this.adminId,
          created_at: new Date().toISOString(),
        });
      }
      this.saveState();
      this.logAudit(this.adminId, 'main_admin', 'ADD_CHANNEL', `Kanal qo‘shildi: ${res.data.title}`);
      this.userSessions.set(fromUser.id, { mode: 'idle' });

      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `✅ <b>Kanal muvaffaqiyatli qo‘shildi!</b>\n\n` +
          `• <b>Nomi:</b> ${escapeHtml(res.data.title)}\n` +
          `• <b>Kanal ID:</b> <code>${res.data.channel_id}</code>\n` +
          `• <b>Havola:</b> ${escapeHtml(res.data.invite_link)}`,
        reply_markup: this.buildChannelsMenuKb(),
        disable_web_page_preview: true,
      });
      return;
    }

    if (step.mode === 'waiting_for_edit_channel' && isMainAdmin) {
      const targetCh = this.state.channels.find((c) => c.id === step.channelDbId);
      if (!targetCh) {
        this.userSessions.set(fromUser.id, { mode: 'idle' });
        return;
      }
      const res = await this.verifyAndResolveChannel(text);
      if (!res.ok || !res.data) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: res.message,
        });
        return;
      }
      targetCh.channel_id = res.data.channel_id;
      targetCh.title = res.data.title;
      targetCh.username = res.data.username;
      targetCh.invite_link = res.data.invite_link;
      this.saveState();
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ <b>Kanal muvaffaqiyatli yangilandi:</b> ${escapeHtml(targetCh.title)}`,
        reply_markup: this.buildChannelsMenuKb(),
      });
      return;
    }

    if (step.mode === 'collecting_items' && isAnyAdmin) {
      const mediaItem = this.extractMediaItem(message);
      if (!mediaItem) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '⚠️ Ushbu xabar turi qo‘llab-quvvatlanmaydi. Matn, rasm, video, audio, ovozli xabar, animatsiya, hujjat yoki stiker yuboring.',
        });
        return;
      }
      step.items.push(mediaItem);
      this.userSessions.set(fromUser.id, step);
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `✅ <b>${step.items.length}-element qabul qilindi (${mediaItem.media_type.toUpperCase()}).</b>\n\n` +
          `• Albom yoki qo‘shimcha fayl bo‘lsa, yana yuborishda davom eting.\n` +
          `• Tugatgan bo‘lsangiz, pastdagi <b>«✅ Tayyor — Kod biriktirish»</b> tugmasini bosing:`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `✅ Tayyor — Kod biriktirish (${step.items.length} ta element)`,
                callback_data: 'adm_msg:finish_items',
              },
            ],
            [{ text: '❌ Bekor qilish', callback_data: 'adm_msg:cancel_add' }],
          ],
        },
      });
      return;
    }

    if (step.mode === 'waiting_for_code' && isAnyAdmin) {
      const code = text.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9_-]{2,64}$/.test(code)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Kod formati noto‘g‘ri! Kod 2 tadan 64 tagacha harf, raqam, "-" yoki "_" belgilaridan iborat bo‘lishi kerak:',
        });
        return;
      }
      if (this.isTempAdminCodeMatch(code)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Ushbu kod vaqtinchalik admin maxfiy kodi sifatida band qilingan! Boshqa kod kiriting:',
        });
        return;
      }
      if (this.state.contents.some((c) => c.code === code)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: `❌ «${code}» kodi allaqachon mavjud! Kod takrorlanmasligi shart. Boshqa noyob kod kiriting:`,
        });
        return;
      }

      const items = step.items;
      const contentType =
        items.length === 1 ? items[0].media_type : 'album';
      const newContent: StoredContent = {
        id: Date.now(),
        code,
        content_type: contentType,
        is_album: items.length > 1,
        usage_count: 0,
        created_by: fromUser.id,
        created_at: new Date().toISOString(),
        items,
      };
      this.state.contents.unshift(newContent);
      this.saveState();
      this.logAudit(
        fromUser.id,
        isMainAdmin ? 'main_admin' : 'temp_admin',
        'CREATE_CONTENT',
        `Yangi kontent saqlandi: code=${code}, items=${items.length}`
      );
      this.userSessions.set(fromUser.id, { mode: 'idle' });

      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🎉 <b>Kontent va maxsus kod muvaffaqiyatli saqlandi!</b>\n\n` +
          `🔑 <b>Maxsus kod:</b> <code>${escapeHtml(code)}</code>\n` +
          `📦 <b>Kontent turi:</b> ${escapeHtml(contentType.toUpperCase())}\n` +
          `🗂 <b>Elementlar soni:</b> ${items.length} ta`,
        reply_markup: this.buildMessagesMenuKb(),
      });
      return;
    }

    if (step.mode === 'waiting_for_new_code_edit' && isAnyAdmin) {
      const newCode = text.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9_-]{2,64}$/.test(newCode)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Kod formati noto‘g‘ri! 2..64 ta harf yoki raqam kiriting:',
        });
        return;
      }
      if (this.isTempAdminCodeMatch(newCode)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Ushbu kod maxfiy tizim kodi bilan to‘qnashadi. Boshqa kod tanlang:',
        });
        return;
      }
      const target = this.state.contents.find((c) => c.id === step.contentId);
      if (!target) {
        this.userSessions.set(fromUser.id, { mode: 'idle' });
        return;
      }
      if (this.state.contents.some((c) => c.code === newCode && c.id !== target.id)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: `❌ «${newCode}» kodi boshqa kontentda band! Yangi kod kiriting:`,
        });
        return;
      }
      const oldCode = target.code;
      target.code = newCode;
      this.saveState();
      this.logAudit(
        fromUser.id,
        isMainAdmin ? 'main_admin' : 'temp_admin',
        'EDIT_CONTENT_CODE',
        `Kod o'zgartirildi: ${oldCode} -> ${newCode}`
      );
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ Kod <b>${escapeHtml(oldCode)}</b> dan <b>${escapeHtml(newCode)}</b> ga muvaffaqiyatli o‘zgartirildi!`,
        reply_markup: this.buildMessagesMenuKb(),
      });
      return;
    }

    if (step.mode === 'waiting_for_search_code' && isAnyAdmin) {
      const code = text.replace(/\s+/g, '').toUpperCase();
      const found = this.state.contents.find((c) => c.code === code);
      if (!found) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `🔍 <b>«${escapeHtml(code)}»</b> kodi bazadan topilmadi. Boshqa kod yozing yoki /start bosing:`,
        });
        return;
      }
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.sendContentDetailCard(chatId, found, 0);
      return;
    }

    if (step.mode === 'waiting_for_broadcast_content' && isMainAdmin) {
      const item = this.extractMediaItem(message);
      if (!item) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '⚠️ Iltimos, reklama uchun matn, rasm, video, audio, ovozli xabar, animatsiya yoki hujjat yuboring:',
        });
        return;
      }
      this.userSessions.set(fromUser.id, {
        mode: 'waiting_for_broadcast_confirm',
        fromChatId: chatId,
        messageId: message.message_id,
        item,
      });
      try {
        await this.callApi('copyMessage', {
          chat_id: chatId,
          from_chat_id: chatId,
          message_id: message.message_id,
          protect_content: true,
        });
      } catch {}
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `👆 <b>Yuqoridagi xabar barcha (${this.state.users.length} ta) foydalanuvchilarga reklama sifatida yuboriladi.</b>\n\n` +
          `Tasdiqlaysizmi?`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yuborish', callback_data: 'adm_bc:confirm' },
              { text: '❌ Bekor qilish', callback_data: 'adm_bc:cancel' },
            ],
          ],
        },
      });
      return;
    }

    if (step.mode === 'waiting_for_temp_admin_code' && isMainAdmin) {
      const clean = text.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9_-]{2,64}$/.test(clean)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Kod formati noto‘g‘ri! 2 tadan 64 tagacha harf yoki raqam kiriting:',
        });
        return;
      }
      if (this.state.contents.some((c) => c.code === clean)) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: `❌ «${clean}» kodi allaqachon oddiy kontent kodi sifatida mavjud! Boshqa maxfiy kod tanlang:`,
        });
        return;
      }
      this.state.temp_admin_code_hash = this.hashSecretCode(clean);
      this.state.temp_admin_code_masked =
        clean.length > 4 ? `${clean.slice(0, 2)}***${clean.slice(-2)}` : `${clean[0]}***`;
      this.saveState();
      this.logAudit(
        this.adminId,
        'main_admin',
        'SET_TEMP_ADMIN_CODE',
        `Vaqtinchalik admin kodi yangilandi (${this.state.temp_admin_code_masked})`
      );
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ Vaqtinchalik admin maxfiy kodi muvaffaqiyatli yangilandi (<code>${this.state.temp_admin_code_masked}</code>).`,
        reply_markup: this.buildMainAdminKb(),
      });
      return;
    }

    if (step.mode === 'waiting_for_delete_delay' && isMainAdmin) {
      if (!/^\d+$/.test(text) || Number(text) < 5 || Number(text) > 3600) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '❌ Iltimos, 5 dan 3600 gacha bo‘lgan son kiriting:',
        });
        return;
      }
      this.state.temp_msg_delete_seconds = Number(text);
      this.saveState();
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `✅ Vaqtinchalik xabarlarni avtomatik o‘chirish muddati <b>${this.state.temp_msg_delete_seconds} soniya</b> etib belgilandi.`,
        reply_markup: this.buildMainAdminKb(),
      });
      return;
    }

    // 6. Special Code & 30-Minute Temp Admin Code Lookup
    if (!text || text.startsWith('/')) return;

    if (!isMainAdmin && dbUser.locked_until && dbUser.locked_until > Date.now()) {
      const rem = Math.ceil((dbUser.locked_until - Date.now()) / 1000);
      const lockMsg = await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `⛔️ <b>Ko‘p marta noto‘g‘ri kod kiritdingiz!</b>\n` +
          `Xavfsizlik maqsadida kod qidirish <b>${rem} soniya</b>ga cheklandi.`,
      });
      this.scheduleBotMsgDelete(chatId, lockMsg.message_id);
      return;
    }

    const code = text.replace(/\s+/g, '').toUpperCase();

    // Check 30-minute temporary admin code
    if (!isMainAdmin && this.isTempAdminCodeMatch(code)) {
      if (tempAdmin) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `ℹ️ Sizda allaqachon <b>${formatTashkentTime(tempAdmin.expires_at)}</b> gacha amal qiluvchi vaqtinchalik admin huquqi mavjud!\n` +
            `O‘zingizga qayta huquq berish yoki muddatni uzaytirish mumkin emas.`,
          reply_markup: this.buildTempAdminKb(),
        });
        return;
      }

      dbUser.failed_code_attempts = 0;
      dbUser.locked_until = null;
      const now = Date.now();
      const expiresAt = now + 30 * 60 * 1000;
      this.state.temp_admins.push({
        telegram_id: dbUser.telegram_id,
        granted_at: now,
        expires_at: expiresAt,
        is_active: true,
      });
      this.saveState();
      this.logAudit(
        dbUser.telegram_id,
        'temp_admin',
        'ACTIVATE_TEMP_ADMIN_30M',
        `30 daqiqalik vaqtinchalik admin huquqi olindi`
      );

      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🛡 <b>Tabriklaymiz! Sizga 30 daqiqalik vaqtinchalik admin huquqi berildi!</b>\n\n` +
          `⏳ Amal qilish muddati: <b>${formatTashkentTime(expiresAt)}</b> gacha.\n` +
          `📋 Sizning barcha harakatlaringiz xavfsizlik jurnaliga (Audit Log) yozib boriladi.\n` +
          `⚠️ Muddat tugagach, qo‘shimcha huquqlar avtomatik bekor qilinadi.`,
        reply_markup: this.buildTempAdminKb(),
      });
      return;
    }

    // Lookup content code
    const content = this.state.contents.find((c) => c.code === code);
    if (!content) {
      if (!isMainAdmin) {
        dbUser.failed_code_attempts = (dbUser.failed_code_attempts || 0) + 1;
        if (dbUser.failed_code_attempts >= 5) {
          dbUser.locked_until = Date.now() + 300 * 1000;
          dbUser.failed_code_attempts = 0;
          this.saveState();
          const lockMsg = await this.callApi('sendMessage', {
            chat_id: chatId,
            parse_mode: 'HTML',
            text: '⛔️ <b>Ketma-ket noto‘g‘ri urinishlar tufayli 300 soniyaga bloklandingiz!</b>',
          });
          this.scheduleBotMsgDelete(chatId, lockMsg.message_id);
          return;
        }
        this.saveState();
      }

      const notFoundMsg = await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text:
          `🔍 <b>«${escapeHtml(code)}» kodi bo‘yicha hech qanday ma’lumot topilmadi!</b>\n\n` +
          `Iltimos, kod to‘g‘ri yozilganligini tekshirib, qaytadan yuboring.`,
      });
      this.scheduleBotMsgDelete(chatId, notFoundMsg.message_id);
      return;
    }

    dbUser.failed_code_attempts = 0;
    dbUser.locked_until = null;
    await this.sendContentToUser(chatId, content);
    content.usage_count += 1;
    this.state.access_logs_count += 1;
    this.saveState();
  }

  private hashSecretCode(cleanCode: string): string {
    return crypto
      .createHmac('sha256', String(this.adminId))
      .update(cleanCode)
      .digest('hex');
  }

  private isTempAdminCodeMatch(cleanCode: string): boolean {
    if (!this.state.temp_admin_code_hash || !cleanCode) return false;
    const candidate = this.hashSecretCode(cleanCode);
    return candidate === this.state.temp_admin_code_hash;
  }

  private async sendContentDetailCard(
    chatId: number,
    content: StoredContent,
    page: number,
    editMessageId?: number
  ): Promise<void> {
    const text =
      `📂 <b>Kontent ma’lumotlari</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔑 <b>Maxsus kod:</b> <code>${escapeHtml(content.code)}</code>\n` +
      `📦 <b>Kontent turi:</b> <b>${escapeHtml(content.content_type.toUpperCase())}</b>\n` +
      `🗂 <b>Elementlar soni:</b> <b>${content.items.length}</b> ta\n` +
      `👁 <b>Foydalanish statistikasi:</b> <b>${content.usage_count}</b> marta olingan\n` +
      `📅 <b>Qo‘shilgan sana:</b> ${formatTashkentTime(content.created_at)}\n` +
      `👤 <b>Qo‘shgan admin ID:</b> <code>${content.created_by}</code>`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: '👁 Kontentni ko‘rish', callback_data: `adm_msg:preview:${content.id}` },
          {
            text: '✏️ Kodni o‘zgartirish',
            callback_data: `adm_msg:editcode:${content.id}:${page}`,
          },
        ],
        [
          {
            text: '🗑 Kontentni o‘chirish',
            callback_data: `adm_msg:del:${content.id}:${page}`,
          },
        ],
        [{ text: '🔙 Ro‘yxatga qaytish', callback_data: `adm_msg:list:${page}` }],
      ],
    };

    if (editMessageId) {
      await this.callApi('editMessageText', {
        chat_id: chatId,
        message_id: editMessageId,
        parse_mode: 'HTML',
        text,
        reply_markup,
      });
    } else {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text,
        reply_markup,
      });
    }
  }

  private async handleCallbackQuery(cb: any): Promise<void> {
    const fromUser = cb.from;
    if (!fromUser) return;
    const dbUser = this.upsertUser(fromUser);
    const isMainAdmin = fromUser.id === this.adminId;
    const tempAdmin = isMainAdmin ? null : this.getActiveTempAdmin(fromUser.id);
    const isAnyAdmin = isMainAdmin || !!tempAdmin;
    const data: string = cb.data || '';
    const chatId = cb.message?.chat?.id || fromUser.id;
    const msgId = cb.message?.message_id;

    // 1. User subscription re-check
    if (data === 'user:check_sub') {
      const { allSubscribed, unsubscribed } = await this.checkSubscriptions(dbUser.telegram_id);
      if (!allSubscribed) {
        await this.callApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `❌ Siz hali ${unsubscribed.length} ta kanalga obuna bo‘lmadingiz!`,
          show_alert: true,
        });
        return;
      }

      await this.callApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: '✅ Barcha kanallarga obuna tasdiqlandi!',
      });
      await this.safeDeleteBotMsg(chatId, msgId);
      dbUser.last_prompt_message_id = null;
      this.saveState();

      if (!dbUser.is_phone_verified) {
        const sent = await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `✅ <b>Kanal obunasi tasdiqlandi!</b>\n\n` +
            `Endi oxirgi qadam — xavfsizlik va hisobingizni tasdiqlash uchun pastdagi tugma orqali o‘z telefon raqamingizni yuboring:`,
          reply_markup: this.buildPhoneRequestKb(),
        });
        this.scheduleBotMsgDelete(chatId, sent.message_id);
      } else {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `🎉 <b>Obuna qayta tiklandi!</b>\n\n` +
            `Asosiy funksiyalar ochildi. Maxsus kodni yuborishingiz mumkin:`,
          reply_markup: this.buildVerifiedUserKb(!!tempAdmin),
        });
      }
      return;
    }

    // 2. Admin Users pagination
    if (data.startsWith('adm_users:')) {
      if (!isMainAdmin) {
        await this.callApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⛔️ Faqat Asosiy Admin uchun!',
          show_alert: true,
        });
        return;
      }
      const parts = data.split(':');
      const action = parts[1];
      if (action === 'noop') {
        await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });
        return;
      }
      if (action === 'back') {
        await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });
        await this.safeDeleteBotMsg(chatId, msgId);
        return;
      }
      if (action === 'search') {
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_user_id' });
        await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '🔎 <b>Qidirilayotgan foydalanuvchining Telegram ID raqamini yuboring:</b>',
        });
        return;
      }
      if (action === 'page') {
        const idx = Math.max(
          0,
          Math.min(this.state.users.length - 1, parseInt(parts[2] || '0', 10))
        );
        const u = this.state.users[idx];
        await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });
        if (u && msgId) {
          await this.callApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            text: this.formatUserCard(u, idx, this.state.users.length),
            reply_markup: this.buildUsersPaginationKb(idx, this.state.users.length),
          });
        }
        return;
      }
    }

    // 3. Admin Channels
    if (data.startsWith('adm_ch:')) {
      if (!isMainAdmin) {
        await this.callApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⛔️ Faqat Asosiy Admin uchun!',
          show_alert: true,
        });
        return;
      }
      const parts = data.split(':');
      const action = parts[1];
      await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });

      if (action === 'back') {
        await this.safeDeleteBotMsg(chatId, msgId);
        return;
      }
      if (action === 'menu') {
        const activeCh = this.state.channels.filter((c) => c.is_active);
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `📡 <b>Majburiy kanallarni boshqarish (${activeCh.length}/10):</b>`,
          reply_markup: this.buildChannelsMenuKb(),
        });
        return;
      }
      if (action === 'list') {
        const activeCh = this.state.channels.filter((c) => c.is_active);
        if (activeCh.length === 0) {
          await this.callApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            text: '📋 <b>Hozircha majburiy kanallar qo‘shilmagan.</b>',
            reply_markup: this.buildChannelsMenuKb(),
          });
          return;
        }
        const lines = activeCh.map(
          (c, i) =>
            `${i + 1}. <b>${escapeHtml(c.title)}</b>\n   • ID: <code>${c.channel_id}</code> | Havola: ${escapeHtml(c.invite_link)}`
        );
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `📋 <b>Majburiy kanallar ro‘yxati (${activeCh.length}/10):</b>\n\n` + lines.join('\n\n'),
          reply_markup: this.buildChannelsMenuKb(),
          disable_web_page_preview: true,
        });
        return;
      }
      if (action === 'add') {
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_new_channel' });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `➕ <b>Yangi majburiy kanal qo‘shish:</b>\n\n` +
            `1️⃣ Avval botni o‘sha kanalga <b>Administrator</b> qilib tayinlang.\n` +
            `2️⃣ Kanalning <code>@username</code> manzilini, <code>https://t.me/...</code> havolasini yoki ID raqamini yuboring:`,
        });
        return;
      }
      if (action === 'edit_select' || action === 'del_select') {
        const activeCh = this.state.channels.filter((c) => c.is_active);
        if (activeCh.length === 0) return;
        const prefix = action === 'edit_select' ? 'adm_ch:edit_id' : 'adm_ch:del_id';
        const rows = activeCh.map((c, i) => [
          {
            text: `${i + 1}. ${c.title} (${c.channel_id})`,
            callback_data: `${prefix}:${c.id}`,
          },
        ]);
        rows.push([{ text: '🔙 Orqaga', callback_data: 'adm_ch:menu' }]);
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text:
            action === 'edit_select'
              ? '✏️ <b>O‘zgartirmoqchi bo‘lgan kanalingizni tanlang:</b>'
              : '🗑 <b>O‘chirmoqchi bo‘lgan kanalingizni tanlang:</b>',
          reply_markup: { inline_keyboard: rows },
        });
        return;
      }
      if (action === 'edit_id') {
        const id = Number(parts[2]);
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_edit_channel', channelDbId: id });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '✏️ <b>Yangi kanal @username manzilini yoki havolasini yuboring:</b>',
        });
        return;
      }
      if (action === 'del_id') {
        const id = Number(parts[2]);
        const target = this.state.channels.find((c) => c.id === id);
        this.state.channels = this.state.channels.filter((c) => c.id !== id);
        this.saveState();
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `✅ <b>«${escapeHtml(target?.title || 'Kanal')}» o‘chirildi.</b>`,
          reply_markup: this.buildChannelsMenuKb(),
        });
        return;
      }
    }

    // 4. Admin Messages / Contents
    if (data.startsWith('adm_msg:') && isAnyAdmin) {
      const parts = data.split(':');
      const action = parts[1];
      await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });

      if (action === 'back') {
        await this.safeDeleteBotMsg(chatId, msgId);
        return;
      }
      if (action === 'menu' || action === 'cancel_add') {
        this.userSessions.set(fromUser.id, { mode: 'idle' });
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `📂 <b>Xabarlar va Maxsus Kodlar bo‘limi (${this.state.contents.length} ta kod):</b>`,
          reply_markup: this.buildMessagesMenuKb(),
        });
        return;
      }
      if (action === 'add') {
        this.userSessions.set(fromUser.id, { mode: 'collecting_items', items: [] });
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text:
            `➕ <b>Yangi xabar (kontent) qo‘shish:</b>\n\n` +
            `1️⃣ Menga saqlamoqchi bo‘lgan kontentingizni (matn, rasm, video, audio, hujjat yoki albom) yuboring.\n` +
            `2️⃣ Barcha fayllarni yuborib bo‘lgach, <b>«✅ Tayyor — Kod biriktirish»</b> tugmasini bosing.`,
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'adm_msg:cancel_add' }]],
          },
        });
        return;
      }
      if (action === 'finish_items') {
        const cur = this.userSessions.get(fromUser.id);
        if (!cur || cur.mode !== 'collecting_items' || cur.items.length === 0) return;
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_code', items: cur.items });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            `🔑 <b>Endi ushbu ${cur.items.length} ta element uchun noyob MAXSUS KOD kiriting:</b>\n\n` +
            `Masalan: <code>VIDEO2026</code>`,
        });
        return;
      }
      if (action === 'list') {
        const page = parseInt(parts[2] || '0', 10) || 0;
        const pageSize = 8;
        const total = this.state.contents.length;
        if (total === 0) {
          await this.callApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            text: '📋 <b>Hozircha saqlangan xabarlar va kodlar mavjud emas.</b>',
            reply_markup: this.buildMessagesMenuKb(),
          });
          return;
        }
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const slice = this.state.contents.slice(safePage * pageSize, (safePage + 1) * pageSize);

        const rows: any[][] = slice.map((c) => [
          {
            text: `🔑 ${c.code} | ${c.content_type.toUpperCase()} | 👁 ${c.usage_count}`,
            callback_data: `adm_msg:view:${c.id}:${safePage}`,
          },
        ]);
        const nav: any[] = [];
        if (safePage > 0)
          nav.push({ text: '◀️ Oldingi', callback_data: `adm_msg:list:${safePage - 1}` });
        nav.push({ text: `📄 ${safePage + 1}/${totalPages}`, callback_data: 'adm_msg:noop' });
        if (safePage < totalPages - 1)
          nav.push({ text: '▶️ Keyingi', callback_data: `adm_msg:list:${safePage + 1}` });
        rows.push(nav);
        rows.push([{ text: '🔙 Orqaga', callback_data: 'adm_msg:menu' }]);

        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `📋 <b>Mavjud xabarlar ro‘yxati (Jami: ${total} ta):</b>`,
          reply_markup: { inline_keyboard: rows },
        });
        return;
      }
      if (action === 'view') {
        const cid = Number(parts[2]);
        const page = Number(parts[3] || '0');
        const found = this.state.contents.find((c) => c.id === cid);
        if (found) await this.sendContentDetailCard(chatId, found, page, msgId);
        return;
      }
      if (action === 'preview') {
        const cid = Number(parts[2]);
        const found = this.state.contents.find((c) => c.id === cid);
        if (found) await this.sendContentToUser(chatId, found);
        return;
      }
      if (action === 'editcode') {
        const cid = Number(parts[2]);
        const page = Number(parts[3] || '0');
        this.userSessions.set(fromUser.id, {
          mode: 'waiting_for_new_code_edit',
          contentId: cid,
          page,
        });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '✏️ <b>Yangi noyob kodni yozib yuboring:</b>',
        });
        return;
      }
      if (action === 'del') {
        const cid = Number(parts[2]);
        const target = this.state.contents.find((c) => c.id === cid);
        this.state.contents = this.state.contents.filter((c) => c.id !== cid);
        this.saveState();
        this.logAudit(
          fromUser.id,
          isMainAdmin ? 'main_admin' : 'temp_admin',
          'DELETE_CONTENT',
          `«${target?.code || cid}» kodi o'chirildi`
        );
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: `✅ <b>«${escapeHtml(target?.code || '')}»</b> kodi bazadan o‘chirildi.`,
          reply_markup: this.buildMessagesMenuKb(),
        });
        return;
      }
      if (action === 'search') {
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_search_code' });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '🔎 <b>Qidirilayotgan maxsus kodni yozib yuboring:</b>',
        });
        return;
      }
    }

    // 5. Broadcast Confirm / Cancel
    if (data.startsWith('adm_bc:') && isMainAdmin) {
      const action = data.split(':')[1];
      const step = this.userSessions.get(fromUser.id);
      this.userSessions.set(fromUser.id, { mode: 'idle' });
      await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });

      if (action === 'cancel' || !step || step.mode !== 'waiting_for_broadcast_confirm') {
        await this.callApi('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          text: '❌ <b>Reklama yuborish bekor qilindi.</b>',
        });
        return;
      }

      await this.callApi('editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        text: `🚀 <b>Reklama yuborish boshlandi (${this.state.users.length} ta foydalanuvchi)...</b>`,
      });

      let sent = 0;
      let blocked = 0;
      let failed = 0;

      for (const u of this.state.users) {
        try {
          await this.callApi('copyMessage', {
            chat_id: u.telegram_id,
            from_chat_id: step.fromChatId,
            message_id: step.messageId,
            protect_content: true,
          });
          sent++;
          u.is_blocked = false;
        } catch (err: any) {
          if (err.error_code === 403) {
            blocked++;
            u.is_blocked = true;
          } else {
            failed++;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      this.state.broadcast_stats.total_campaigns += 1;
      this.state.broadcast_stats.sent_count += sent;
      this.state.broadcast_stats.blocked_count += blocked;
      this.state.broadcast_stats.failed_count += failed;
      this.saveState();

      await this.callApi('sendMessage', {
        chat_id: this.adminId,
        parse_mode: 'HTML',
        text:
          `✅ <b>Reklama jo‘natmasi yakunlandi!</b>\n\n` +
          `👥 Jami qabul qiluvchilar: <b>${this.state.users.length}</b> ta\n` +
          `📬 Muvaffaqiyatli yetkazildi: <b>${sent}</b> ta\n` +
          `🚫 Botni bloklaganlar: <b>${blocked}</b> ta\n` +
          `⚠️ Xatolik yuz berganlar: <b>${failed}</b> ta`,
      });
      return;
    }

    // 6. Security Settings
    if (data.startsWith('adm_sec:') && isMainAdmin) {
      const action = data.split(':')[1];
      await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });

      if (action === 'set_temp_code') {
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_temp_admin_code' });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '🔑 <b>30 daqiqalik vaqtinchalik admin uchun yangi maxfiy kodni yuboring:</b>',
        });
        return;
      }
      if (action === 'set_del_delay') {
        this.userSessions.set(fromUser.id, { mode: 'waiting_for_delete_delay' });
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: '⏳ <b>Vaqtinchalik ogohlantirish xabarlarini o‘chirish vaqtini (soniyada) kiriting (5..3600):</b>',
        });
        return;
      }
      if (action === 'revoke_all_temp') {
        for (const t of this.state.temp_admins) t.is_active = false;
        this.saveState();
        this.logAudit(this.adminId, 'main_admin', 'REVOKE_ALL_TEMP_ADMINS', 'Barcha vaqtinchalik adminlar bekor qilindi');
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '✅ Barcha faol vaqtinchalik adminlar muddatidan oldin bekor qilindi!',
        });
        return;
      }
      if (action === 'audit_logs') {
        const logs = this.state.audit_logs.slice(0, 15);
        if (logs.length === 0) {
          await this.callApi('sendMessage', {
            chat_id: chatId,
            text: '📜 Audit loglar hozircha bo‘sh.',
          });
          return;
        }
        const lines = logs.map(
          (l) =>
            `• <code>${formatTashkentTime(l.created_at)}</code> | <b>${l.actor_role}</b> (<code>${l.actor_telegram_id}</code>) ➡️ <b>${escapeHtml(l.action)}</b>\n  <i>${escapeHtml(l.details)}</i>`
        );
        await this.callApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `📜 <b>Oxirgi xavfsizlik va admin harakatlari (Audit Log):</b>\n\n` + lines.join('\n'),
        });
      }
    }
  }
}

export function startNativeTelegramBotIfConfigured(): void {
  const rawToken = cleanEnvValue(process.env.BOT_TOKEN);
  const rawAdminId = cleanEnvValue(process.env.ADMIN_ID).split(',')[0].trim();

  if (
    !rawToken ||
    !rawAdminId ||
    rawToken === '1234567890:AAH_your_telegram_bot_token_here' ||
    !/^\d{6,15}:[A-Za-z0-9_-]{25,}$/.test(rawToken) ||
    !/^-?\d+$/.test(rawAdminId)
  ) {
    return;
  }

  const bot = new WorkingCodeTelegramBot(rawToken, Number(rawAdminId));
  bot.start();
}
