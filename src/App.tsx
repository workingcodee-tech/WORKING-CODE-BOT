import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  Download,
  FileCode,
  FolderGit2,
  Lock,
  Send,
  ShieldAlert,
  Smartphone,
  Terminal,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';

interface ProjectFile {
  path: string;
  category: string;
  description: string;
  content: string;
  lines: number;
  sizeBytes: number;
}

interface SimChannel {
  id: number;
  channelId: string;
  title: string;
  username: string;
  inviteLink: string;
  userSubscribed: boolean;
}

interface SimContentItem {
  id: number;
  code: string;
  contentType: 'video' | 'document' | 'album' | 'text' | 'photo';
  itemsCount: number;
  usageCount: number;
  createdAt: string;
  createdBy: string;
  description: string;
}

interface SimUserRecord {
  id: number;
  telegramId: number;
  firstName: string;
  lastName: string;
  username: string;
  phoneNumber: string | null;
  isPhoneVerified: boolean;
  isSubscribedAll: boolean;
  joinedAt: string;
  lastActiveAt: string;
  isTempAdmin: boolean;
  tempAdminExpiresAt: string | null;
}

interface SimAuditLog {
  id: number;
  timestamp: string;
  actorId: number;
  actorRole: 'main_admin' | 'temp_admin';
  action: string;
  details: string;
}

interface ChatBubble {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  isProtected?: boolean;
  isTempAutoDelete?: boolean;
  deleteCountdown?: number;
  mediaBadge?: string;
  inlineButtons?: Array<{ label: string; action: string }>;
}

const INITIAL_CHANNELS: SimChannel[] = [
  {
    id: 1,
    channelId: '-1001982345611',
    title: 'WORKING CODE — Rasmiy Kanal',
    username: '@working_code_uz',
    inviteLink: 'https://t.me/working_code_uz',
    userSubscribed: false,
  },
  {
    id: 2,
    channelId: '-1001982345622',
    title: 'Python 3.12 va Aiogram Darslari',
    username: '@python_aiogram_uz',
    inviteLink: 'https://t.me/python_aiogram_uz',
    userSubscribed: false,
  },
];

const INITIAL_CONTENTS: SimContentItem[] = [
  {
    id: 1,
    code: 'VIDEO2026',
    contentType: 'video',
    itemsCount: 1,
    usageCount: 148,
    createdAt: '09.10.2026 08:00',
    createdBy: '900100200',
    description: '📹 Full-Stack Python 3.12 + aiogram 3.x + Railway 24/7 video darslik (Full HD, 48 daqiqa).',
  },
  {
    id: 2,
    code: 'PYTHON312',
    contentType: 'document',
    itemsCount: 1,
    usageCount: 94,
    createdAt: '09.10.2026 08:05',
    createdBy: '900100200',
    description: '📄 SQLAlchemy 2.x va asyncpg arxitekturasi bo‘yicha PDF qo‘llanma va sxemalar to‘plami.',
  },
  {
    id: 3,
    code: 'ALBOM2026',
    contentType: 'album',
    itemsCount: 4,
    usageCount: 62,
    createdAt: '09.10.2026 08:10',
    createdBy: '900100200',
    description: '🖼 [Media Guruh / Albom: 4 ta rasm + video] Loyiha arxitekturasi va PostgreSQL ER-diagrammalari.',
  },
];

const INITIAL_USERS: SimUserRecord[] = [
  {
    id: 1,
    telegramId: 541209841,
    firstName: 'Sardorbek',
    lastName: 'Karimov',
    username: 'sardor_dev',
    phoneNumber: null,
    isPhoneVerified: false,
    isSubscribedAll: false,
    joinedAt: '09.10.2026 08:00:12',
    lastActiveAt: '09.10.2026 08:18:00',
    isTempAdmin: false,
    tempAdminExpiresAt: null,
  },
  {
    id: 2,
    telegramId: 778123990,
    firstName: 'Madina',
    lastName: 'Rustamova',
    username: 'madina_uz',
    phoneNumber: '+998901234567',
    isPhoneVerified: true,
    isSubscribedAll: true,
    joinedAt: '09.10.2026 07:30:45',
    lastActiveAt: '09.10.2026 08:15:22',
    isTempAdmin: false,
    tempAdminExpiresAt: null,
  },
  {
    id: 3,
    telegramId: 612998341,
    firstName: 'Javohir',
    lastName: 'Tursunov',
    username: 'javohir_py',
    phoneNumber: '+998939876543',
    isPhoneVerified: true,
    isSubscribedAll: true,
    joinedAt: '08.10.2026 19:42:10',
    lastActiveAt: '09.10.2026 08:12:05',
    isTempAdmin: false,
    tempAdminExpiresAt: null,
  },
];

const DB_TABLES_SPEC = [
  {
    name: 'users',
    model: 'User',
    purpose: 'Bot foydalanuvchilari, xalqaro telefon raqami, obuna holati va brute-force himoyasi.',
    columns: 'id (PK), telegram_id (BIGINT UNIQUE), first_name, last_name, username, phone_number, is_phone_verified, is_subscribed_all, is_blocked, failed_code_attempts, locked_until, joined_at, last_active_at',
  },
  {
    name: 'channels',
    model: 'Channel',
    purpose: '1 tadan 10 tagacha majburiy obuna kanallari va ularning taklif havolalari.',
    columns: 'id (PK), channel_id (BIGINT UNIQUE), title, username, invite_link, is_active, added_by, created_at, updated_at',
  },
  {
    name: 'contents',
    model: 'Content',
    purpose: 'Maxsus kodlar (UPPERCASE UNIQUE), kontent turi, albom belgisi va foydalanishlar soni.',
    columns: 'id (PK), code (VARCHAR UNIQUE), content_type, is_album, usage_count, created_by, created_at, updated_at',
  },
  {
    name: 'content_items',
    model: 'ContentItem',
    purpose: 'Har bir kodga biriktirilgan yakka fayl yoki media guruh (albom) elementlari.',
    columns: 'id (PK), content_id (FK -> contents.id CASCADE), item_order, media_type, file_id, text_content, caption, created_at',
  },
  {
    name: 'content_access_logs',
    model: 'ContentAccessLog',
    purpose: 'Maxsus kod orqali olingan har bir kontentning vaqti va foydalanuvchi ID statistikasi.',
    columns: 'id (PK), user_id (FK -> users.id CASCADE), telegram_id, content_id (FK -> contents.id CASCADE), code_used, accessed_at',
  },
  {
    name: 'temporary_admins',
    model: 'TemporaryAdmin',
    purpose: '30 daqiqalik vaqtinchalik admin huquqlari va ularning avtomatik tugash muddati.',
    columns: 'id (PK), user_id (FK -> users.id CASCADE), telegram_id, granted_at, expires_at, is_active, revoked_at',
  },
  {
    name: 'bot_settings',
    model: 'BotSetting',
    purpose: 'Tizimning dinamik sozlamalari (HMAC-SHA256 vaqtinchalik admin kodi, avto-o‘chirish muddati).',
    columns: 'id (PK), key (VARCHAR UNIQUE), value, updated_by, updated_at',
  },
  {
    name: 'broadcasts',
    model: 'Broadcast',
    purpose: 'Ommaviy reklama kampaniyalari va yetkazib berish ko‘rsatkichlari.',
    columns: 'id (PK), created_by, content_type, from_chat_id, message_id, file_id, caption_or_text, status, total_users, sent_count, blocked_count, failed_count, created_at, started_at, completed_at',
  },
  {
    name: 'broadcast_recipients',
    model: 'BroadcastRecipient',
    purpose: 'Reklama navbati: bot qayta ishga tushganda kelgan joyidan davom etishni ta’minlaydi.',
    columns: 'id (PK), broadcast_id (FK -> broadcasts.id CASCADE), user_id (FK -> users.id CASCADE), telegram_id, status (pending/sent/blocked/failed), error_message, processed_at',
  },
  {
    name: 'audit_logs',
    model: 'AuditLog',
    purpose: 'Vaqtinchalik va asosiy adminlarning har bir harakatini xavfsizlik jurnaliga yozib borish.',
    columns: 'id (PK), actor_telegram_id, actor_role, action, target_type, target_id, details, created_at',
  },
  {
    name: 'scheduled_message_deletions',
    model: 'ScheduledMessageDeletion',
    purpose: 'Bot o‘zi yuborgan vaqtinchalik ogohlantirish xabarlarini belgilangan muddatda o‘chirish jadvali.',
    columns: 'id (PK), chat_id, message_id, category, delete_after, is_deleted, created_at',
  },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<'simulator' | 'codebase' | 'schema' | 'railway' | 'checklist'>('simulator');
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('main.py');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(true);

  // Simulator States
  const [simRole, setSimRole] = useState<'user' | 'temp_admin' | 'main_admin'>('user');
  const [channels, setChannels] = useState<SimChannel[]>(INITIAL_CHANNELS);
  const [contents, setContents] = useState<SimContentItem[]>(INITIAL_CONTENTS);
  const [users, setUsers] = useState<SimUserRecord[]>(INITIAL_USERS);
  const [auditLogs, setAuditLogs] = useState<SimAuditLog[]>([
    {
      id: 1,
      timestamp: '09.10.2026 08:00:00',
      actorId: 900100200,
      actorRole: 'main_admin',
      action: 'SET_TEMP_ADMIN_CODE',
      details: '30 daqiqalik vaqtinchalik admin maxfiy kodi o‘rnatildi (TE***26)',
    },
  ]);

  const [secretTempAdminCode, setSecretTempAdminCode] = useState<string>('TEMP2026');
  const [autoDeleteSeconds, setAutoDeleteSeconds] = useState<number>(45);
  const [chatInput, setChatInput] = useState<string>('');
  const [adminFlowMode, setAdminFlowMode] = useState<
    | null
    | 'adding_channel'
    | 'adding_content_desc'
    | 'adding_content_code'
    | 'searching_user_id'
    | 'searching_content_code'
    | 'broadcast_input'
    | 'setting_temp_code'
  >(null);
  const [pendingContentDesc, setPendingContentDesc] = useState<string>('');
  const [pendingBroadcastText, setPendingBroadcastText] = useState<string>('');
  const [currentUserPage, setCurrentUserPage] = useState<number>(0);
  const [broadcastStats, setBroadcastStats] = useState({
    campaigns: 2,
    sent: 240,
    blocked: 4,
    failed: 1,
  });

  // Checklist states
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({
    c1: true,
    c2: true,
    c3: true,
    c4: false,
    c5: false,
    c6: false,
    c7: false,
    c8: false,
  });

  const activeSimUser = users[0];
  const allChannelsSubscribed = useMemo(
    () => channels.every((c) => c.userSubscribed),
    [channels]
  );

  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([
    {
      id: 'init-1',
      sender: 'bot',
      timestamp: '08:18',
      text: '✨ Assalomu alaykum, Sardorbek!\n\nWORKING CODE rasmiy botiga xush kelibsiz! Botning asosiy funksiyalaridan foydalanish uchun avval majburiy kanallarga obuna bo‘ling va telefon raqamingizni tasdiqlang.',
      isTempAutoDelete: true,
      deleteCountdown: 45,
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/project-files')
      .then((r) => r.json())
      .then((data) => {
        if (data.files) {
          setProjectFiles(data.files);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingFiles(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const appendBotMessage = (msg: Omit<ChatBubble, 'id' | 'sender' | 'timestamp'>) => {
    const nowStr = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    setChatMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        sender: 'bot',
        timestamp: nowStr,
        ...msg,
      },
    ]);
  };

  const appendUserMessage = (text: string) => {
    const nowStr = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    setChatMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        sender: 'user',
        timestamp: nowStr,
        text,
      },
    ]);
  };

  // Real-time chat_member channel join/leave simulation
  const handleToggleChannelSubscription = (channelId: number) => {
    setChannels((prev) => {
      const updated = prev.map((ch) =>
        ch.id === channelId ? { ...ch, userSubscribed: !ch.userSubscribed } : ch
      );
      const target = updated.find((ch) => ch.id === channelId);
      const nowAllSub = updated.every((ch) => ch.userSubscribed);

      setUsers((uPrev) =>
        uPrev.map((u, idx) => (idx === 0 ? { ...u, isSubscribedAll: nowAllSub } : u))
      );

      if (target) {
        if (target.userSubscribed) {
          if (nowAllSub) {
            if (activeSimUser.isPhoneVerified) {
              appendBotMessage({
                text: `🎉 [chat_member yangilanishi] Rahmat! Barcha majburiy kanallarga obuna bo‘lganingiz avtomatik tasdiqlandi.\n\nTelefon raqamingiz ham tasdiqlangan. Endi hech qanday qo‘shimcha tugmasiz maxsus kodni (masalan: VIDEO2026) yuborishingiz mumkin!`,
              });
            } else {
              appendBotMessage({
                text: `✅ [chat_member yangilanishi] Barcha majburiy kanallarga obuna bo‘ldingiz!\n\nEndi botdan to‘liq foydalanish uchun pastdagi «📱 Telefon raqamni tasdiqlash» tugmasini bosing:`,
                isTempAutoDelete: true,
                deleteCountdown: autoDeleteSeconds,
              });
            }
          } else {
            const rem = updated.filter((c) => !c.userSubscribed).length;
            appendBotMessage({
              text: `ℹ️ «${target.title}» kanaliga obuna bo‘ldingiz. Yana ${rem} ta majburiy kanal qoldi.`,
              isTempAutoDelete: true,
              deleteCountdown: autoDeleteSeconds,
            });
          }
        } else {
          appendBotMessage({
            text: `⚠️ [chat_member yangilanishi] Diqqat, ${activeSimUser.firstName}!\n\nSiz «${target.title}» majburiy kanalini tark etdingiz. Shu sababli botning asosiy funksiyalari darhol bloklandi.\n\nQayta obuna bo‘lishingiz bilan barcha funksiyalar avtomatik ravishda ochiladi.`,
            isTempAutoDelete: true,
            deleteCountdown: autoDeleteSeconds,
          });
        }
      }

      return updated;
    });
  };

  // Phone verification simulation (request_contact=True)
  const handleVerifyOwnPhone = () => {
    setUsers((prev) =>
      prev.map((u, idx) =>
        idx === 0
          ? { ...u, phoneNumber: '+998909987766', isPhoneVerified: true }
          : u
      )
    );
    appendUserMessage('📱 [Kontakt ulashildi: Sardorbek Karimov | +998909987766 | user_id=541209841]');

    if (!allChannelsSubscribed) {
      const unsubList = channels
        .filter((c) => !c.userSubscribed)
        .map((c, i) => `${i + 1}. ${c.title} (${c.username})`)
        .join('\n');
      appendBotMessage({
        text: `✅ Telefon raqamingiz (+998909987766) xalqaro formatda tasdiqlandi!\n\nEndi quyidagi majburiy kanallarga obuna bo‘ling:\n${unsubList}`,
        isTempAutoDelete: true,
        deleteCountdown: autoDeleteSeconds,
      });
    } else {
      appendBotMessage({
        text: `🎉 Tabriklaymiz! Telefon raqamingiz (+998909987766) muvaffaqiyatli tasdiqlandi.\n\nBarcha asosiy funksiyalar ochildi! Maxsus kodni yuboring (masalan: VIDEO2026, PYTHON312 yoki ALBOM2026):`,
      });
    }
  };

  const handleSendForeignPhone = () => {
    appendUserMessage('📱 [Boshqa shaxs kontakti: Begona Foydalanuvchi | +998912223344 | user_id=888888888]');
    appendBotMessage({
      text: `❌ Xatolik: Boshqa shaxsning kontaktini yuborish mumkin emas!\n\nIltimos, faqat «📱 Telefon raqamni tasdiqlash» (request_contact=True) tugmasini bosish orqali o‘zingizning shaxsiy Telegram kontaktingizni ulashing.`,
      isTempAutoDelete: true,
      deleteCountdown: autoDeleteSeconds,
    });
  };

  const handleTriggerStart = () => {
    setAdminFlowMode(null);
    appendUserMessage('/start');

    if (simRole === 'main_admin') {
      appendBotMessage({
        text: `👋 Assalomu alaykum, Asosiy Administrator!\n\n🤖 WORKING CODE boshqaruv paneliga xush kelibsiz. Sizdan kanal obunasi va telefon tasdig‘i talab qilinmaydi.\n\nPastdagi doimiy admin tugmalari orqali tizimni boshqarishingiz mumkin.`,
      });
      return;
    }

    // Foydalanuvchi har doim /start bosganda Asosiy Adminga xabar yuboriladi
    const nowFull = new Date().toLocaleString('uz-UZ');
    appendBotMessage({
      text:
        `🔔 [Asosiy Adminga Xabar -> ADMIN_ID=900100200]\n` +
        `Foydalanuvchi botga /start bosdi!\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 Telegram ID: ${activeSimUser.telegramId}\n` +
        `🙍‍♂️ Ism-familiya: ${activeSimUser.firstName} ${activeSimUser.lastName}\n` +
        `🔗 Username: @${activeSimUser.username}\n` +
        `📞 Telefon: ${activeSimUser.phoneNumber || 'Tasdiqlanmagan'}\n` +
        `📡 Kanal obunasi: ${allChannelsSubscribed ? '✅ Obuna bo‘lgan' : '❌ Obuna bo‘lmagan'}\n` +
        `🛡 Maqomi: ${simRole === 'temp_admin' ? '⏱ Vaqtinchalik Admin' : '👤 Oddiy foydalanuvchi'}\n` +
        `🕒 Vaqt: ${nowFull}`,
      inlineButtons:
        simRole === 'temp_admin'
          ? [
              { label: '✅ Qoldirish', action: 'temp_alert_keep' },
              { label: '🚫 Bekor qilish', action: 'temp_alert_revoke' },
            ]
          : undefined,
    });

    if (!allChannelsSubscribed) {
      const unsub = channels
        .filter((c) => !c.userSubscribed)
        .map((c, i) => `• ${i + 1}. ${c.title} (${c.username})`)
        .join('\n');
      appendBotMessage({
        text: `✨ Assalomu alaykum, ${activeSimUser.firstName}!\n\nWORKING CODE rasmiy botiga xush kelibsiz!\n\n📢 Botdan foydalanish uchun quyidagi majburiy kanallarga obuna bo‘ling:\n${unsub}\n\n(Simulyatorning chap panelidan kanal tugmasini yoqib obuna bo‘lishni sinab ko‘ring!)`,
        isTempAutoDelete: true,
        deleteCountdown: autoDeleteSeconds,
      });
      return;
    }

    if (!activeSimUser.isPhoneVerified) {
      appendBotMessage({
        text: `✨ Assalomu alaykum, ${activeSimUser.firstName}!\n\n📱 Telefon raqamingizni tasdiqlang:\nNima uchun telefon raqami kerak?\n• Foydalanuvchi xavfsizligini ta’minlash va soxta profillardan himoyalanish uchun;\n• Maxsus kodlar orqali fayllarni faqat tasdiqlangan foydalanuvchilarga taqdim etish uchun.\n\nPastdagi «📱 Telefon raqamni tasdiqlash» tugmasini bosing.`,
        isTempAutoDelete: true,
        deleteCountdown: autoDeleteSeconds,
      });
      return;
    }

    appendBotMessage({
      text: `✅ Assalomu alaykum, ${activeSimUser.firstName}! Bot faol holatda (pastda hech qanday ortiqcha tugma yo‘q).\n\nKerakli fayl yoki materialni olish uchun maxsus kodni yozib yuboring (masalan: VIDEO2026):`,
    });
  };

  // Admin Button Actions in Simulator
  const handleAdminButton = (btnName: string) => {
    setAdminFlowMode(null);
    appendUserMessage(btnName);

    if (simRole === 'user') {
      appendBotMessage({
        text: '⛔️ Sizda administrator huquqlari mavjud emas.',
        isTempAutoDelete: true,
        deleteCountdown: autoDeleteSeconds,
      });
      return;
    }

    if (btnName === '📊 Statistika') {
      const totalUsers = users.length;
      const subCount = users.filter((u) => u.isSubscribedAll).length;
      const phoneCount = users.filter((u) => u.isPhoneVerified).length;
      const tempAdminsCount = users.filter((u) => u.isTempAdmin).length;
      const totalDeliveries = contents.reduce((acc, c) => acc + c.usageCount, 0);

      if (simRole === 'temp_admin') {
        setAuditLogs((prev) => [
          {
            id: prev.length + 1,
            timestamp: new Date().toLocaleString('uz-UZ'),
            actorId: activeSimUser.telegramId,
            actorRole: 'temp_admin',
            action: 'VIEW_STATISTICS',
            details: 'Vaqtinchalik admin tizim statistikasini ko‘rdi',
          },
          ...prev,
        ]);
      }

      appendBotMessage({
        text:
          `📊 WORKING CODE — Tizim Statistikasi\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👥 Foydalanuvchilar:\n` +
          `• Jami ro‘yxatdan o‘tganlar: ${totalUsers} ta\n` +
          `• Bugun qo‘shilganlar: ${totalUsers} ta\n` +
          `• Barcha kanallarga obuna bo‘lganlar: ${subCount} ta\n` +
          `• Obuna bo‘lmaganlar: ${totalUsers - subCount} ta\n` +
          `• Telefon raqamini tasdiqlaganlar: ${phoneCount} ta\n` +
          `• Telefon raqamini tasdiqlamaganlar: ${totalUsers - phoneCount} ta\n` +
          `• Faol foydalanuvchilar: ${totalUsers} ta\n` +
          `• Vaqtinchalik adminlar: ${tempAdminsCount} ta\n\n` +
          `📂 Kontent va Kodlar:\n` +
          `• Jami kontentlar va kodlar: ${contents.length} ta\n` +
          `• Kontent yuborilishlari soni: ${totalDeliveries} marta\n\n` +
          `📢 Reklama yuborish statistikasi:\n` +
          `• Jami reklama kampaniyalari: ${broadcastStats.campaigns} ta\n` +
          `• Muvaffaqiyatli yetkazilgan: ${broadcastStats.sent} ta\n` +
          `• Botni bloklaganlar: ${broadcastStats.blocked} ta\n` +
          `• Xatolik qaytarganlar: ${broadcastStats.failed} ta`,
      });
      return;
    }

    if (btnName === '👥 Foydalanuvchilar') {
      if (simRole !== 'main_admin') {
        appendBotMessage({
          text: '⛔️ Ruxsat yo‘q! Foydalanuvchilarning shaxsiy ma’lumotlari va telefon raqamlari maxfiy bo‘lib, faqat Asosiy Administrator (ADMIN_ID) ko‘ra oladi.',
        });
        return;
      }
      showUserCardInChat(0);
      return;
    }

    if (btnName === '📢 Reklama') {
      if (simRole !== 'main_admin') {
        appendBotMessage({
          text: '⛔️ Ruxsat yo‘q! Ommaviy reklama yuborish huquqi faqat Asosiy Administratorda mavjud.',
        });
        return;
      }
      setAdminFlowMode('broadcast_input');
      appendBotMessage({
        text: `📢 Reklama yuborish bo‘limi\n\nBazadagi barcha (${users.length} ta) foydalanuvchiga yuboriladigan reklama matnini yoki media tavsifini pastdagi maydonga yozib yuboring:`,
      });
      return;
    }

    if (btnName === '📡 Kanallar') {
      if (simRole !== 'main_admin') {
        appendBotMessage({
          text: '⛔️ Ruxsat yo‘q! Majburiy kanallarni faqat Asosiy Administrator boshqara oladi.',
        });
        return;
      }
      const chList = channels
        .map((c, i) => `${i + 1}. ${c.title} (${c.username} | ID: ${c.channelId})`)
        .join('\n');
      appendBotMessage({
        text: `📡 Majburiy kanallarni boshqarish (${channels.length}/10 ta):\n\n${chList}\n\nQuyidagi amallardan birini tanlang:`,
        inlineButtons: [
          { label: '➕ Kanal qo‘shish', action: 'ch_add' },
          { label: '📋 Kanallar ro‘yxati', action: 'ch_list' },
          { label: '🗑 Oxirgi kanalni o‘chirish', action: 'ch_del_last' },
        ],
      });
      return;
    }

    if (btnName === '📂 Xabarlar') {
      const codeSummary = contents
        .map(
          (c) =>
            `• ${c.code} | ${c.contentType.toUpperCase()} (${c.itemsCount} el.) | 👁 ${c.usageCount} marta | 📅 ${c.createdAt}`
        )
        .join('\n');
      appendBotMessage({
        text: `📂 Xabarlar va Maxsus Kodlar bo‘limi (Jami: ${contents.length} ta):\n\n${codeSummary}`,
        inlineButtons: [
          { label: '➕ Xabar qo‘shish', action: 'msg_add' },
          { label: '🔎 Kod bo‘yicha qidirish', action: 'msg_search' },
        ],
      });
      return;
    }
  };

  const showUserCardInChat = (index: number) => {
    const safeIdx = Math.max(0, Math.min(users.length - 1, index));
    setCurrentUserPage(safeIdx);
    const u = users[safeIdx];
    appendBotMessage({
      text:
        `👤 Foydalanuvchi ma’lumotlari (${safeIdx + 1} / ${users.length})\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 Telegram ID: ${u.telegramId}\n` +
        `🙍‍♂️ Ism: ${u.firstName}\n` +
        `🙍‍♂️ Familiya: ${u.lastName || '—'}\n` +
        `🔗 Username: @${u.username}\n` +
        `📞 Telefon raqami: ${u.phoneNumber || 'Tasdiqlanmagan'}\n` +
        `📅 Birinchi kirgan vaqti: ${u.joinedAt}\n` +
        `🕒 Oxirgi faolligi: ${u.lastActiveAt}\n` +
        `📡 Kanal obunasi holati: ${u.isSubscribedAll ? '✅ Obuna bo‘lgan' : '❌ Obuna bo‘lmagan'}\n` +
        `📱 Telefon tasdig‘i holati: ${u.isPhoneVerified ? '✅ Tasdiqlangan' : '❌ Tasdiqlanmagan'}\n` +
        `🛡 Vaqtinchalik admin huquqi: ${
          u.isTempAdmin ? `✅ Faol (${u.tempAdminExpiresAt} gacha)` : '❌ Yo‘q'
        }`,
      inlineButtons: [
        { label: '◀️ Oldingi', action: `user_page:${Math.max(0, safeIdx - 1)}` },
        { label: '▶️ Keyingi', action: `user_page:${Math.min(users.length - 1, safeIdx + 1)}` },
        { label: '🔎 ID bo‘yicha qidirish', action: 'user_search_id' },
      ],
    });
  };

  const handleInlineAction = (action: string) => {
    if (action === 'temp_alert_keep') {
      setAuditLogs((prev) => [
        {
          id: prev.length + 1,
          timestamp: new Date().toLocaleString('uz-UZ'),
          actorId: 900100200,
          actorRole: 'main_admin',
          action: 'KEEP_TEMP_ADMIN',
          details: `Vaqtinchalik admin (${activeSimUser.telegramId}) huquqi Asosiy Admin tomonidan qoldirildi`,
        },
        ...prev,
      ]);
      appendBotMessage({
        text: `✅ Qaror qabul qilindi: Foydalanuvchi ${activeSimUser.firstName} (${activeSimUser.telegramId}) ning 30 daqiqalik vaqtinchalik admin huquqi o‘z kuchida QOLDIRILDI.`,
        inlineButtons: [{ label: '🚫 Bekor qilish', action: 'temp_alert_revoke' }],
      });
      return;
    }

    if (action === 'temp_alert_revoke') {
      setSimRole('user');
      setUsers((prev) =>
        prev.map((u, idx) =>
          idx === 0 ? { ...u, isTempAdmin: false, tempAdminExpiresAt: null } : u
        )
      );
      setAuditLogs((prev) => [
        {
          id: prev.length + 1,
          timestamp: new Date().toLocaleString('uz-UZ'),
          actorId: 900100200,
          actorRole: 'main_admin',
          action: 'REVOKE_TEMP_ADMIN',
          details: `Vaqtinchalik admin (${activeSimUser.telegramId}) huquqi Asosiy Admin tomonidan darhol bekor qilindi`,
        },
        ...prev,
      ]);
      appendBotMessage({
        text:
          `🚫 Qaror qabul qilindi: Vaqtinchalik admin (${activeSimUser.telegramId}) huquqi Asosiy Admin tomonidan darhol BEKOR QILINDI!\n\n` +
          `👤 Foydalanuvchiga xabar yuborildi va pastdagi admin tugmalari olib tashlanib (ReplyKeyboardRemove), oddiy foydalanuvchi rejimiga qaytarildi.`,
      });
      return;
    }

    if (action.startsWith('user_page:')) {
      const idx = parseInt(action.split(':')[1], 10);
      showUserCardInChat(idx);
      return;
    }
    if (action === 'user_search_id') {
      setAdminFlowMode('searching_user_id');
      appendBotMessage({
        text: '🔎 Qidirilayotgan foydalanuvchining Telegram ID raqamini kiriting (masalan: 778123990):',
      });
      return;
    }
    if (action === 'ch_add') {
      if (channels.length >= 10) {
        appendBotMessage({
          text: '❌ Maksimal 10 ta majburiy kanal qo‘shish mumkin!',
        });
        return;
      }
      setAdminFlowMode('adding_channel');
      appendBotMessage({
        text: '➕ Yangi majburiy kanalning @username yoki https://t.me/... havolasini yuboring:',
      });
      return;
    }
    if (action === 'ch_list') {
      const listStr = channels
        .map((c, i) => `${i + 1}. ${c.title} — ${c.username} (ID: ${c.channelId})`)
        .join('\n');
      appendBotMessage({
        text: `📋 Faol majburiy kanallar (${channels.length}/10):\n\n${listStr}`,
      });
      return;
    }
    if (action === 'ch_del_last') {
      if (channels.length <= 1) {
        appendBotMessage({
          text: '⚠️ Kamida 1 ta majburiy kanal qolishi tavsiya etiladi.',
        });
        return;
      }
      const removed = channels[channels.length - 1];
      setChannels((prev) => prev.slice(0, -1));
      appendBotMessage({
        text: `🗑 «${removed.title}» (${removed.username}) majburiy kanallar ro‘yxatidan o‘chirildi.`,
      });
      return;
    }
    if (action === 'msg_add') {
      setAdminFlowMode('adding_content_desc');
      appendBotMessage({
        text: '➕ Yangi xabar (kontent) qo‘shish:\n\n1-qadam: Foydalanuvchiga yuboriladigan matn, media yoki albom tavsifini yozib yuboring:',
      });
      return;
    }
    if (action === 'msg_search') {
      setAdminFlowMode('searching_content_code');
      appendBotMessage({
        text: '🔎 Qidirilayotgan maxsus kodni kiriting (masalan: VIDEO2026):',
      });
      return;
    }
    if (action === 'bc_confirm') {
      setBroadcastStats((prev) => ({
        campaigns: prev.campaigns + 1,
        sent: prev.sent + users.length,
        blocked: prev.blocked,
        failed: prev.failed,
      }));
      setAuditLogs((prev) => [
        {
          id: prev.length + 1,
          timestamp: new Date().toLocaleString('uz-UZ'),
          actorId: 900100200,
          actorRole: 'main_admin',
          action: 'START_BROADCAST',
          details: `Ommaviy reklama ${users.length} ta foydalanuvchiga protect_content=True bilan yuborildi`,
        },
        ...prev,
      ]);
      appendBotMessage({
        text: `✅ Reklama jo‘natmasi yakunlandi!\n\n👥 Jami qabul qiluvchilar: ${users.length} ta\n📬 Muvaffaqiyatli yetkazildi: ${users.length} ta\n🚫 Botni bloklaganlar: 0 ta\n🔒 Himoya: protect_content=True qo‘llanildi.`,
        isProtected: true,
      });
      setPendingBroadcastText('');
      return;
    }
    if (action === 'bc_cancel') {
      setPendingBroadcastText('');
      appendBotMessage({
        text: '❌ Reklama yuborish bekor qilindi.',
      });
      return;
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = chatInput.trim();
    if (!raw) return;
    setChatInput('');
    appendUserMessage(raw);

    if (raw === '/start') {
      handleTriggerStart();
      return;
    }

    if (adminFlowMode === 'searching_user_id') {
      const foundIdx = users.findIndex((u) => String(u.telegramId) === raw);
      setAdminFlowMode(null);
      if (foundIdx === -1) {
        appendBotMessage({
          text: `❌ ${raw} ID raqamli foydalanuvchi bazada topilmadi.`,
        });
      } else {
        showUserCardInChat(foundIdx);
      }
      return;
    }

    if (adminFlowMode === 'adding_channel') {
      const cleanUname = raw.startsWith('@')
        ? raw
        : raw.includes('t.me/')
          ? `@${raw.split('t.me/')[1].replace('/', '')}`
          : `@${raw}`;
      const newCh: SimChannel = {
        id: Date.now(),
        channelId: `-100${Math.floor(1000000000 + Math.random() * 900000000)}`,
        title: `Kanal ${cleanUname}`,
        username: cleanUname,
        inviteLink: `https://t.me/${cleanUname.replace('@', '')}`,
        userSubscribed: true,
      };
      setChannels((prev) => [...prev, newCh]);
      setAdminFlowMode(null);
      appendBotMessage({
        text: `✅ Kanal muvaffaqiyatli tekshirildi va qo‘shildi!\n• Nomi: ${newCh.title}\n• ID: ${newCh.channelId}\n• Bot admin ruxsatlari: Tasdiqlangan`,
      });
      return;
    }

    if (adminFlowMode === 'adding_content_desc') {
      setPendingContentDesc(raw);
      setAdminFlowMode('adding_content_code');
      appendBotMessage({
        text: '✅ Kontent qabul qilindi.\n\n2-qadam: Endi ushbu kontent uchun noyob MAXSUS KOD kiriting (masalan: DARS2026):',
      });
      return;
    }

    if (adminFlowMode === 'adding_content_code') {
      const normalized = raw.replace(/\s+/g, '').toUpperCase();
      if (normalized === secretTempAdminCode.toUpperCase()) {
        appendBotMessage({
          text: '❌ Ushbu kod 30 daqiqalik vaqtinchalik admin maxfiy kodi sifatida band qilingan! Boshqa kod tanlang:',
        });
        return;
      }
      if (contents.some((c) => c.code === normalized)) {
        appendBotMessage({
          text: `❌ «${normalized}» kodi bazada allaqachon mavjud! Kod takrorlanmasligi shart. Boshqa kod yozing:`,
        });
        return;
      }
      const newContent: SimContentItem = {
        id: Date.now(),
        code: normalized,
        contentType: 'document',
        itemsCount: 1,
        usageCount: 0,
        createdAt: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
        createdBy: simRole === 'main_admin' ? '900100200' : String(activeSimUser.telegramId),
        description: pendingContentDesc,
      };
      setContents((prev) => [newContent, ...prev]);
      setAuditLogs((prev) => [
        {
          id: prev.length + 1,
          timestamp: new Date().toLocaleString('uz-UZ'),
          actorId: simRole === 'main_admin' ? 900100200 : activeSimUser.telegramId,
          actorRole: simRole === 'main_admin' ? 'main_admin' : 'temp_admin',
          action: 'CREATE_CONTENT',
          details: `Yangi maxsus kod qo‘shildi: ${normalized}`,
        },
        ...prev,
      ]);
      setAdminFlowMode(null);
      setPendingContentDesc('');
      appendBotMessage({
        text: `🎉 Kontent va maxsus kod muvaffaqiyatli saqlandi!\n\n🔑 Maxsus kod: ${normalized}\n📦 Kontent: ${newContent.description}`,
      });
      return;
    }

    if (adminFlowMode === 'searching_content_code') {
      const code = raw.toUpperCase();
      const found = contents.find((c) => c.code === code);
      setAdminFlowMode(null);
      if (!found) {
        appendBotMessage({
          text: `🔍 «${code}» kodi bazada topilmadi.`,
        });
      } else {
        appendBotMessage({
          text: `📂 Kod topildi: ${found.code}\n• Turi: ${found.contentType.toUpperCase()}\n• Elementlar: ${found.itemsCount} ta\n• Olinganlar soni: ${found.usageCount} marta\n• Tavsif: ${found.description}`,
        });
      }
      return;
    }

    if (adminFlowMode === 'broadcast_input') {
      setPendingBroadcastText(raw);
      setAdminFlowMode(null);
      appendBotMessage({
        text: `📢 Reklama oldindan ko‘rish (Preview):\n━━━━━━━━━━━━━━━━━━━━\n${raw}\n━━━━━━━━━━━━━━━━━━━━\nBarcha ${users.length} ta foydalanuvchiga copyMessage (protect_content=True) orqali yuborilsinmi?`,
        inlineButtons: [
          { label: '✅ Yuborish', action: 'bc_confirm' },
          { label: '❌ Bekor qilish', action: 'bc_cancel' },
        ],
      });
      return;
    }

    // Regular User & Code Lookup Gatekeeper
    if (simRole !== 'main_admin') {
      if (!allChannelsSubscribed) {
        const unsub = channels
          .filter((c) => !c.userSubscribed)
          .map((c) => c.title)
          .join(', ');
        appendBotMessage({
          text: `⚠️ Diqqat, ${activeSimUser.firstName}!\nSiz hali barcha majburiy kanallarga obuna bo‘lmagansiz (${unsub}). Obuna va telefon tasdiqlanmaguncha kod orqali fayl olish ishlamaydi!`,
          isTempAutoDelete: true,
          deleteCountdown: autoDeleteSeconds,
        });
        return;
      }
      if (!activeSimUser.isPhoneVerified) {
        appendBotMessage({
          text: `📱 Telefon raqamni tasdiqlash talab etiladi!\nTelefon raqami tasdiqlanmaguncha kodlar bo‘yicha kontent olishga ruxsat berilmaydi. Chap paneldagi «O‘z kontaktini yuborish» tugmasini bosing.`,
          isTempAutoDelete: true,
          deleteCountdown: autoDeleteSeconds,
        });
        return;
      }
    }

    const codeCandidate = raw.replace(/\s+/g, '').toUpperCase();

    // Check 30-minute temporary admin code
    if (codeCandidate === secretTempAdminCode.toUpperCase() && simRole !== 'main_admin') {
      const expDate = new Date(Date.now() + 30 * 60 * 1000).toLocaleTimeString('uz-UZ', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const nowFull = new Date().toLocaleString('uz-UZ');
      setSimRole('temp_admin');
      setUsers((prev) =>
        prev.map((u, idx) =>
          idx === 0 ? { ...u, isTempAdmin: true, tempAdminExpiresAt: expDate } : u
        )
      );
      setAuditLogs((prev) => [
        {
          id: prev.length + 1,
          timestamp: nowFull,
          actorId: activeSimUser.telegramId,
          actorRole: 'temp_admin',
          action: 'ACTIVATE_TEMP_ADMIN_30M',
          details: `30 daqiqalik vaqtinchalik admin huquqi faollashtirildi (${expDate} gacha)`,
        },
        ...prev,
      ]);
      appendBotMessage({
        text: `🛡 Tabriklaymiz! Sizga 30 daqiqalik vaqtinchalik admin huquqi berildi!\n\n⏳ Amal qilish muddati: ${expDate} gacha.\n📋 Barcha harakatlaringiz AuditLog jurnaliga yozib boriladi.\n⚠️ Muddat tugagach, qo‘shimcha huquqlar avtomatik bekor qilinadi.`,
      });
      appendBotMessage({
        text:
          `🚨 [Asosiy Adminga Xabar -> ADMIN_ID=900100200]\n` +
          `Diqqat! Vaqtinchalik Admin tizimga kirdi!\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 Holat: Yangi 30 daqiqalik vaqtinchalik admin faollashtirildi\n` +
          `🆔 Telegram ID: ${activeSimUser.telegramId}\n` +
          `🙍‍♂️ Ism-familiya: ${activeSimUser.firstName} ${activeSimUser.lastName}\n` +
          `🔗 Username: @${activeSimUser.username}\n` +
          `📞 Telefon: ${activeSimUser.phoneNumber || 'Tasdiqlanmagan'}\n` +
          `⏳ Amal qilish muddati: ${expDate} gacha\n` +
          `🕒 Kirgan vaqti: ${nowFull}\n\n` +
          `Ushbu foydalanuvchining vaqtinchalik admin huquqini qoldirasizmi yoki bekor qilasizmi?`,
        inlineButtons: [
          { label: '✅ Qoldirish', action: 'temp_alert_keep' },
          { label: '🚫 Bekor qilish', action: 'temp_alert_revoke' },
        ],
      });
      return;
    }

    // Lookup Content Code (case-insensitive)
    const matchedContent = contents.find((c) => c.code === codeCandidate);
    if (!matchedContent) {
      appendBotMessage({
        text: `🔍 «${codeCandidate}» kodi bo‘yicha hech qanday ma’lumot topilmadi!\n\nMavjud namuna kodlardan birini yuborib ko‘ring: VIDEO2026, PYTHON312, ALBOM2026 yoki 30 daqiqalik admin kodi: ${secretTempAdminCode}`,
        isTempAutoDelete: true,
        deleteCountdown: autoDeleteSeconds,
      });
      return;
    }

    // Increment usage count and send protected content
    setContents((prev) =>
      prev.map((c) =>
        c.id === matchedContent.id ? { ...c, usageCount: c.usageCount + 1 } : c
      )
    );

    appendBotMessage({
      text: `${matchedContent.description}\n\n📊 Kod: ${matchedContent.code} | Elementlar: ${matchedContent.itemsCount} ta | Jami olingan: ${matchedContent.usageCount + 1} marta`,
      isProtected: true,
      mediaBadge: `${matchedContent.contentType.toUpperCase()} (${matchedContent.itemsCount} ta fayl)`,
    });
  };

  const filteredFiles = useMemo(() => {
    const q = fileSearchQuery.trim().toLowerCase();
    if (!q) return projectFiles;
    return projectFiles.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.content.toLowerCase().includes(q)
    );
  }, [projectFiles, fileSearchQuery]);

  const currentFile = useMemo(
    () => projectFiles.find((f) => f.path === selectedFilePath) || projectFiles[0],
    [projectFiles, selectedFilePath]
  );

  const handleCopyFile = (file: ProjectFile) => {
    navigator.clipboard.writeText(file.content);
    setCopiedFile(file.path);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleDownloadSingleFile = (file: ProjectFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.replace(/\//g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4-5 Nav Links) — Zone 3 (1 Primary CTA) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-950/95 sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('simulator');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          WORKING CODE
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveSection('simulator')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'simulator'
                ? 'text-white border-sky-500'
                : 'border-transparent'
            }`}
          >
            Jonli Simulyator
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('codebase')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'codebase'
                ? 'text-white border-sky-500'
                : 'border-transparent'
            }`}
          >
            Manba Kodlari ({projectFiles.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('schema')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'schema'
                ? 'text-white border-sky-500'
                : 'border-transparent'
            }`}
          >
            PostgreSQL Jadvallar
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('railway')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'railway'
                ? 'text-white border-sky-500'
                : 'border-transparent'
            }`}
          >
            Railway Joylash
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('checklist')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'checklist'
                ? 'text-white border-sky-500'
                : 'border-transparent'
            }`}
          >
            Tekshiruv Ro‘yxati
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href="/api/download-installer"
            download="setup_working_code_bot.py"
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            Loyihani Yuklab Olish
          </a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        {/* Hero / Workspace Summary Strip */}
        <div className="mb-8 pb-6 border-b border-slate-800/80 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-2 font-mono tabular-nums">
              <span>Python 3.12+</span>
              <span aria-hidden="true">·</span>
              <span>aiogram 3.13.1</span>
              <span aria-hidden="true">·</span>
              <span>SQLAlchemy 2.0.36 + asyncpg</span>
              <span aria-hidden="true">·</span>
              <span>Railway 24/7 Worker</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight max-w-2xl">
              WORKING CODE — Telegram Bot Arxitekturasi va Boshqaruv Tizimi
            </h1>
          </div>

          {/* Mobile/Compact Section Switcher */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveSection('simulator')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'simulator'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Simulyator
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('codebase')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'codebase'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Kod Bazasi ({projectFiles.length} ta fayl)
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('schema')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'schema'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              PostgreSQL Sxema
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('railway')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'railway'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Railway Qo‘llanma
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('checklist')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'checklist'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Checklist
            </button>
          </div>
        </div>

        {/* SECTION 1: INTERACTIVE TELEGRAM BOT SIMULATOR */}
        {activeSection === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Control Column (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Role & Access Control Panel */}
              <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl">
                <h2 className="text-base font-semibold text-white mb-1">
                  01. Foydalanuvchi Maqomi va Sinov Rejimi
                </h2>
                <p className="text-xs text-slate-400 mb-4">
                  Botni oddiy foydalanuvchi, 30 daqiqalik vaqtinchalik admin yoki asosiy admin (`ADMIN_ID`) sifatida sinab ko‘ring.
                </p>

                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg mb-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSimRole('user');
                      appendBotMessage({
                        text: '👤 Rejim o‘zgartirildi: Oddiy Foydalanuvchi (ID: 541209841).',
                      });
                    }}
                    className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      simRole === 'user'
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Oddiy User
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const expDate = new Date(Date.now() + 30 * 60 * 1000).toLocaleTimeString('uz-UZ', {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const nowFull = new Date().toLocaleString('uz-UZ');
                      setSimRole('temp_admin');
                      setUsers((prev) =>
                        prev.map((u, idx) =>
                          idx === 0 ? { ...u, isTempAdmin: true, tempAdminExpiresAt: expDate } : u
                        )
                      );
                      appendBotMessage({
                        text:
                          `🚨 [Asosiy Adminga Xabar -> ADMIN_ID=900100200]\n` +
                          `Diqqat! Vaqtinchalik Admin tizimga kirdi!\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `📌 Holat: Vaqtinchalik admin paneliga kirdi\n` +
                          `🆔 Telegram ID: ${activeSimUser.telegramId}\n` +
                          `🙍‍♂️ Ism-familiya: ${activeSimUser.firstName} ${activeSimUser.lastName}\n` +
                          `🔗 Username: @${activeSimUser.username}\n` +
                          `📞 Telefon: ${activeSimUser.phoneNumber || 'Tasdiqlanmagan'}\n` +
                          `⏳ Amal qilish muddati: ${expDate} gacha\n` +
                          `🕒 Kirgan vaqti: ${nowFull}\n\n` +
                          `Ushbu foydalanuvchining vaqtinchalik admin huquqini qoldirasizmi yoki bekor qilasizmi?`,
                        inlineButtons: [
                          { label: '✅ Qoldirish', action: 'temp_alert_keep' },
                          { label: '🚫 Bekor qilish', action: 'temp_alert_revoke' },
                        ],
                      });
                    }}
                    className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      simRole === 'temp_admin'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Vaqtinchalik Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimRole('main_admin');
                      appendBotMessage({
                        text: '👑 Rejim o‘zgartirildi: Asosiy Admin (ADMIN_ID=900100200). Barcha 5 ta boshqaruv bo‘limi ochiq.',
                      });
                    }}
                    className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      simRole === 'main_admin'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Asosiy Admin
                  </button>
                </div>

                {/* Mandatory Channels (`chat_member` live toggle) */}
                <div className="pt-4 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Majburiy kanallar (chat_member hodisasi)
                    </span>
                    <span className="text-xs font-mono tabular-nums text-slate-400">
                      {channels.filter((c) => c.userSubscribed).length}/{channels.length} obuna
                    </span>
                  </div>
                  <div className="space-y-2">
                    {channels.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between gap-3 py-2 px-3 bg-slate-950 border border-slate-800/80 rounded-lg"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">
                            {ch.title}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 truncate">
                            {ch.username} · ID: {ch.channelId}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleChannelSubscription(ch.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            ch.userSubscribed
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-500/20 hover:text-rose-300'
                              : 'bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400'
                          }`}
                        >
                          {ch.userSubscribed ? 'A’zo (Chiqish)' : 'Obuna bo‘lish'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Phone Verification Simulation */}
                <div className="pt-4 mt-4 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Telefon raqamni tasdiqlash (request_contact=True)
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {activeSimUser.isPhoneVerified ? activeSimUser.phoneNumber : 'Tasdiqlanmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleVerifyOwnPhone}
                      className="py-2 px-3 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                      O‘z kontaktini yuborish
                    </button>
                    <button
                      type="button"
                      onClick={handleSendForeignPhone}
                      className="py-2 px-3 text-xs font-medium bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      Begona kontaktni sinash
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Special Codes & Audit Log Preview */}
              <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl">
                <h2 className="text-base font-semibold text-white mb-1">
                  02. Tezkor Maxsus Kodlar va Vaqtinchalik Admin
                </h2>
                <p className="text-xs text-slate-400 mb-3">
                  Bazada saqlangan kontent kodlari (katta-kichik harflarga bog‘liq emas) va 30 daqiqalik maxfiy admin kodi:
                </p>

                <div className="flex flex-wrap gap-2 mb-4">
                  {contents.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChatInput(c.code)}
                      className="px-3 py-1.5 text-xs font-mono bg-slate-950 hover:bg-slate-800 text-sky-300 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      {c.code} ({c.contentType})
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChatInput(secretTempAdminCode)}
                    className="px-3 py-1.5 text-xs font-mono bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    🔐 {secretTempAdminCode} (30 daq. Admin)
                  </button>
                </div>

                <div className="pt-3 border-t border-slate-800">
                  <div className="text-xs font-semibold text-slate-300 mb-2">
                    Oxirgi Audit Log yozuvlari (audit_logs jadvali):
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {auditLogs.slice(0, 5).map((log) => (
                      <div
                        key={log.id}
                        className="text-[11px] font-mono text-slate-400 py-1.5 px-2.5 bg-slate-950 rounded border border-slate-800/70"
                      >
                        <span className="text-sky-400">{log.actorRole}</span> ·{' '}
                        <span className="text-white font-medium">{log.action}</span> —{' '}
                        <span>{log.details}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Interactive Telegram Window (7 cols) */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-[680px] overflow-hidden">
              {/* Simulated Telegram Chat Header */}
              <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span>WORKING CODE — Rasmiy Bot</span>
                    <span className="text-xs font-mono font-normal text-sky-400">
                      @working_code_bot
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums">
                    Faol rejim:{' '}
                    {simRole === 'main_admin'
                      ? 'Asosiy Admin (ADMIN_ID)'
                      : simRole === 'temp_admin'
                        ? 'Vaqtinchalik Admin (30 daqiqa)'
                        : 'Oddiy Foydalanuvchi'}{' '}
                    · Avto-o‘chirish: {autoDeleteSeconds}s
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTriggerStart}
                    className="px-3 py-1.5 text-xs font-mono font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded-lg hover:bg-sky-500/30 transition-colors whitespace-nowrap shrink-0"
                  >
                    /start bosish
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatMessages([])}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                    title="Chatni tozalash"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Chat Messages Area */}
              <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-950/60">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.sender === 'user'
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-900 border border-slate-800 text-slate-100'
                      }`}
                    >
                      {msg.mediaBadge && (
                        <div className="mb-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-sky-300 flex items-center justify-between">
                          <span>📎 {msg.mediaBadge}</span>
                          <span>file_id saqlangan</span>
                        </div>
                      )}
                      <div>{msg.text}</div>

                      {/* Metadata footer inside message */}
                      <div className="mt-2 pt-1.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono opacity-80">
                        <span>{msg.timestamp}</span>
                        {msg.isProtected && (
                          <span className="text-emerald-300 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> protect_content=True (Forward/Save taqiqlangan)
                          </span>
                        )}
                        {msg.isTempAutoDelete && (
                          <span className="text-amber-300">
                            ⏳ {msg.deleteCountdown}s da avto-o‘chiriladi (faqat bot xabari)
                          </span>
                        )}
                      </div>

                      {/* Inline Keyboard Buttons */}
                      {msg.inlineButtons && msg.inlineButtons.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {msg.inlineButtons.map((btn, bIdx) => (
                            <button
                              key={bIdx}
                              type="button"
                              onClick={() => handleInlineAction(btn.action)}
                              className="py-1.5 px-3 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-md transition-colors text-center whitespace-nowrap truncate"
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Persistent Telegram Reply Keyboard (Only for Main Admin or Temp Admin; Regular User has NO bottom buttons) */}
              {simRole !== 'user' && (
                <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800">
                  {simRole === 'main_admin' && (
                    <div>
                      <div className="text-[11px] font-mono text-slate-400 mb-1.5">
                        Asosiy Admin Doimiy Klaviaturasi (8-bo‘lim talabi):
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                        {[
                          '📊 Statistika',
                          '👥 Foydalanuvchilar',
                          '📢 Reklama',
                          '📡 Kanallar',
                          '📂 Xabarlar',
                        ].map((btn) => (
                          <button
                            key={btn}
                            type="button"
                            onClick={() => handleAdminButton(btn)}
                            className="py-2 px-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg transition-colors whitespace-nowrap truncate"
                          >
                            {btn}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {simRole === 'temp_admin' && (
                    <div>
                      <div className="text-[11px] font-mono text-amber-400 mb-1.5">
                        30 Daqiqalik Vaqtinchalik Admin Klaviaturasi (Cheklangan huquqlar):
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAdminButton('📊 Statistika')}
                          className="py-2 px-3 text-xs font-medium bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg transition-colors whitespace-nowrap truncate"
                        >
                          📊 Statistika
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdminButton('📂 Xabarlar')}
                          className="py-2 px-3 text-xs font-medium bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg transition-colors whitespace-nowrap truncate"
                        >
                          📂 Xabarlar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdminButton('👥 Foydalanuvchilar')}
                          className="py-2 px-3 text-xs font-medium bg-slate-950 hover:bg-slate-800 text-rose-300 border border-slate-800 rounded-lg transition-colors whitespace-nowrap truncate"
                        >
                          👥 Foydalanuvchilar (Ruxsatni sinash)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Message Input Form */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Maxsus kod yozing (masalan: VIDEO2026) yoki xabar kiriting..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Yuborish
                </button>
              </form>
            </div>
          </div>
        )}

        {/* SECTION 2: FULL PYTHON CODEBASE EXPLORER */}
        {activeSection === 'codebase' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* File Tree Sidebar */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4 text-sky-400" />
                  Loyiha Fayllari ({projectFiles.length})
                </h2>
                <a
                  href="/api/download-installer"
                  download="setup_working_code_bot.py"
                  className="text-xs text-sky-400 hover:underline font-mono whitespace-nowrap shrink-0"
                >
                  Barchasini yuklash
                </a>
              </div>

              <input
                type="text"
                value={fileSearchQuery}
                onChange={(e) => setFileSearchQuery(e.target.value)}
                placeholder="Fayl yoki kod bo‘yicha qidirish..."
                className="w-full mb-3 px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />

              {isLoadingFiles ? (
                <div className="space-y-2 py-4">
                  <div className="h-8 bg-slate-800/60 rounded animate-pulse" />
                  <div className="h-8 bg-slate-800/60 rounded animate-pulse" />
                  <div className="h-8 bg-slate-800/60 rounded animate-pulse" />
                </div>
              ) : (
                <div className="space-y-1 max-h-[560px] overflow-y-auto pr-1">
                  {filteredFiles.map((file) => {
                    const isSelected = currentFile?.path === file.path;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedFilePath(file.path)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'hover:bg-slate-800/70 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-medium truncate">
                            {file.path}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {file.description}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {file.lines} qator
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Code Viewer Panel */}
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              {currentFile ? (
                <>
                  <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-mono font-bold text-white flex items-center gap-2">
                        <FileCode className="w-4 h-4 text-sky-400" />
                        {currentFile.path}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {currentFile.description} · {currentFile.lines} qator ·{' '}
                        {(currentFile.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyFile(currentFile)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        {copiedFile === currentFile.path ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Nusxalandi
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Kodni nusxalash
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadSingleFile(currentFile)}
                        className="px-3 py-1.5 text-xs font-medium bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Yuklab olish
                      </button>
                    </div>
                  </div>
                  <pre className="p-5 text-xs font-mono leading-relaxed text-slate-200 overflow-x-auto max-h-[600px] overflow-y-auto bg-slate-950/80">
                    <code>{currentFile.content}</code>
                  </pre>
                </>
              ) : (
                <div className="p-8 text-center text-sm text-slate-400">
                  Ko‘rish uchun chap ro‘yxatdan faylni tanlang.
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 3: POSTGRESQL DATABASE SCHEMA */}
        {activeSection === 'schema' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-sky-400" />
                    PostgreSQL Ma’lumotlar Bazasi Jadvallari (SQLAlchemy 2.x + asyncpg)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Barcha 10 ta asosiy jadval + vaqtinchalik xabarlarni o‘chirish jadvali `database.py` ichidagi `Base.metadata.create_all` orqali avtomatik yaratiladi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFilePath('models.py');
                    setActiveSection('codebase');
                  }}
                  className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  models.py kodini ochish
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400 font-mono">
                      <th className="py-3 px-4">#</th>
                      <th className="py-3 px-4">Jadval nomi (PostgreSQL)</th>
                      <th className="py-3 px-4">ORM Model</th>
                      <th className="py-3 px-4">Vazifasi</th>
                      <th className="py-3 px-4">Ustunlar, Indekslar va Bog‘lanishlar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {DB_TABLES_SPEC.map((tbl, idx) => (
                      <tr key={tbl.name} className="hover:bg-slate-950/60">
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-sky-300 whitespace-nowrap">
                          {tbl.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-white whitespace-nowrap">
                          {tbl.model}
                        </td>
                        <td className="py-3 px-4 text-slate-300 min-w-[240px]">
                          {tbl.purpose}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400 min-w-[320px]">
                          {tbl.columns}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: RAILWAY 24/7 DEPLOYMENT GUIDE */}
        {activeSection === 'railway' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-sky-400" />
                  Railway Serverida 24/7 Ishga Tushirish Yo‘riqnomasi
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Loyiha `Procfile`, `railway.json` va `requirements.txt` bilan Railway Nixpacks muhitiga to‘liq tayyorlangan.
                </p>
              </div>

              <div className="space-y-4 text-sm text-slate-300">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                  <h3 className="font-semibold text-white mb-1">
                    01. GitHub Repozitoriyga Yuklash
                  </h3>
                  <p className="text-xs text-slate-400 mb-2">
                    Yuqoridagi «Loyihani Yuklab Olish» tugmasi orqali `setup_working_code_bot.py` skriptini yuklab olib ishga tushiring va GitHub’ga joylang:
                  </p>
                  <pre className="p-3 bg-slate-900 rounded text-xs font-mono text-sky-300 overflow-x-auto">
{`python3 setup_working_code_bot.py
cd working-code-bot
git init && git add .
git commit -m "Deploy WORKING CODE Telegram Bot"
git branch -M main
git remote add origin https://github.com/USERNAME/working-code-bot.git
git push -u origin main`}
                  </pre>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                  <h3 className="font-semibold text-white mb-1">
                    02. Railway PostgreSQL va Xizmatni Ulash
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1. Railway.app panelida «New Project» → «Deploy from GitHub repo» orqali repozitoriyni tanlang.<br />
                    2. Shu loyiha ichida «+ New» → «Database» → «Add PostgreSQL» tugmasini bosing.<br />
                    3. Bot xizmatining «Variables» bo‘limiga o‘tib, `DATABASE_URL` qiymatiga `${'{{Postgres.DATABASE_URL}}'}` ulanish o‘zgaruvchisini biriktiring. `config.py` uni avtomatik ravishda `postgresql+asyncpg://` formatiga o‘giradi.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
              <h3 className="text-base font-bold text-white">
                Kerakli Environment Variables
              </h3>
              <div className="space-y-2.5 text-xs font-mono">
                {[
                  { k: 'BOT_TOKEN', v: '7123456789:AAH_token...', desc: '@BotFather dan olingan token' },
                  { k: 'ADMIN_ID', v: '123456789', desc: 'Asosiy admin Telegram ID raqami' },
                  { k: 'DATABASE_URL', v: '${{Postgres.DATABASE_URL}}', desc: 'Railway PostgreSQL ulanish manzili' },
                  { k: 'TIMEZONE', v: 'Asia/Tashkent', desc: 'O‘zbekiston vaqt mintaqasi' },
                  { k: 'LOG_LEVEL', v: 'INFO', desc: 'Log darajasi (tokenlar avtomatik yashiriladi)' },
                  { k: 'TEMP_MSG_DELETE_SECONDS', v: '45', desc: 'Vaqtinchalik xabarlarni o‘chirish muddati' },
                ].map((env) => (
                  <div key={env.k} className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                    <div className="flex items-center justify-between text-sky-300 font-semibold">
                      <span>{env.k}</span>
                      <span className="text-slate-400">{env.v}</span>
                    </div>
                    <div className="text-[11px] font-sans text-slate-400 mt-1">
                      {env.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 5: INTERACTIVE TESTING CHECKLIST */}
        {activeSection === 'checklist' && (
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-sky-400" />
              Botni Sinash Uchun Tekshiruv Ro‘yxati (Checklist)
            </h2>
            <p className="text-xs text-slate-400 mb-6">
              Railway serveriga joylagandan so‘ng yoki yuqoridagi Jonli Simulyatorda quyidagi barcha bandlarni birma-bir tekshirib chiqing:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  id: 'c1',
                  title: '01. Asosiy Admin (/start) tekshiruvi',
                  desc: 'ADMIN_ID hisobidan /start bosilganda obuna va telefon so‘ralmasdan darhol 5 ta asosiy bo‘lim tugmasi chiqishi.',
                },
                {
                  id: 'c2',
                  title: '02. Majburiy kanallar (1–10 ta) va chat_member avto-ochish',
                  desc: 'Foydalanuvchi barcha majburiy kanallarga a’zo bo‘lganda qo‘shimcha tugma bosmasdan keyingi qadam ochilishi va kanaldan chiqsa darhol bloklanishi.',
                },
                {
                  id: 'c3',
                  title: '03. Shaxsiy telefon raqamni tasdiqlash (request_contact=True)',
                  desc: 'Faqat foydalanuvchining o‘z kontakti qabul qilinishi, begona kontakt rad etilishi va raqam xalqaro formatda (+998...) saqlanishi.',
                },
                {
                  id: 'c4',
                  title: '04. Maxsus kod orqali kontent va albom olish (protect_content=True)',
                  desc: 'VIDEO2026 yoki video2026 yuborilganda kontent forward/save himoyasi bilan kelishi va statistika (ContentAccessLogs) yozilishi.',
                },
                {
                  id: 'c5',
                  title: '05. 30 daqiqalik vaqtinchalik admin va AuditLog',
                  desc: 'Maxfiy kod yuborilganda 30 daqiqaga cheklangan admin huquqi berilishi, muddat tugagach avtomatik bekor bo‘lishi va harakatlar logga yozilishi.',
                },
                {
                  id: 'c6',
                  title: '06. Foydalanuvchilar sahifalash va maxfiylik',
                  desc: 'Faqat asosiy admin Foydalanuvchilar bo‘limida Oldingi/Keyingi va ID qidiruv orqali barcha ma’lumotlarni ko‘ra olishi (yosh taxmin qilinmasligi).',
                },
                {
                  id: 'c7',
                  title: '07. Ommaviy Reklama (Broadcast) navbati va qayta tiklanish',
                  desc: 'Reklama preview tasdiqlangach barcha foydalanuvchilarga yuborilishi va yakunda adminga batafsil hisobot kelishi.',
                },
                {
                  id: 'c8',
                  title: '08. Vaqtinchalik bot xabarlarini avto-o‘chirish',
                  desc: 'Kutib olish, obuna ogohlantirishlari va xato kod xabarlari belgilangan soniyada o‘chirilishi (foydalanuvchi xabariga tegilmasligi).',
                },
              ].map((item) => {
                const checked = !!checkedItems[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setCheckedItems((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                    }
                    className={`p-4 rounded-xl border text-left transition-colors flex items-start gap-3 ${
                      checked
                        ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 border ${
                        checked
                          ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                          : 'border-slate-600'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mt-12 border-t border-slate-800/80 py-6 px-6 text-xs text-slate-400">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            WORKING CODE — Python 3.12 · aiogram 3.x · SQLAlchemy 2.x · PostgreSQL (Railway 24/7)
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveSection('codebase')}
              className="hover:text-white transition-colors"
            >
              Manba kodlari
            </button>
            <span aria-hidden="true">·</span>
            <a
              href="/api/download-installer"
              download="setup_working_code_bot.py"
              className="hover:text-white transition-colors"
            >
              Python o‘rnatuvchini yuklash
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
