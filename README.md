# 🤖 WORKING CODE — Maxsus Kod Orqali Kontent Taqdim Etuvchi Telegram Bot

**WORKING CODE** — foydalanuvchilarga maxsus kod orqali administrator yuklagan matn, rasm, video, audio, ovozli xabar, animatsiya, hujjat va media albomlarni taqdim etadigan, **Python 3.12+**, **aiogram 3.x**, **SQLAlchemy 2.x** va **PostgreSQL (asyncpg)** asosida qurilgan ishlab chiqarish (production) darajasidagi Telegram bot.

Botning barcha interfeysi, tugmalari, xabarlari, xatoliklari va yo‘riqnomalari to‘liq **o‘zbek tilida** ishlab chiqilgan hamda **Railway** serverida 24/7 uzluksiz ishlashga moslashtirilgan.

---

## 🏗 1. Loyiha Arxitekturasi va Fayllar Tuzilmasi

```text
working-code-bot/
├── main.py                  # Asosiy ishga tushirish nuqtasi (Polling, Background Workers, Graceful Shutdown)
├── config.py                # Environment variables va DATABASE_URL (asyncpg) normalizatsiyasi
├── database.py              # AsyncEngine, SessionFactory, qayta ulanish va avtomatik jadval yaratish
├── models.py                # 10+ ta PostgreSQL jadvallari (SQLAlchemy 2.x ORM modellari)
├── handlers/
│   ├── __init__.py          # Barcha routerlarni ustuvorlik tartibida ro‘yxatdan o‘tkazish
│   ├── states.py            # FSM (Finite State Machine) holatlari
│   ├── user.py              # /start, chat_member avto-ochish, kontakt tasdiqlash, kod qidirish
│   ├── admin.py             # Statistika, Foydalanuvchilar sahifalash, Maxfiy kod va Audit loglar
│   ├── channels.py          # 1–10 ta majburiy kanalni qo‘shish, tekshirish, tahrirlash va o‘chirish
│   ├── contents.py          # Kontent/albom qo‘shish, noyob kod biriktirish, qidirish va boshqarish
│   └── broadcast.py         # Ommaviy reklama preview, tasdiqlash va navbatga qo‘yish
├── services/
│   ├── __init__.py
│   ├── subscription.py      # Kanal obunasini va bot admin ruxsatlarini tekshirish xizmati
│   ├── cleanup.py           # Vaqtinchalik bot xabarlarini belgilangan muddatda avtomatik o‘chirish
│   ├── broadcast.py         # Navbat asosida reklama yuborish va qayta ishga tushganda davom ettirish
│   ├── security.py          # Telefon formatlash, brute-force himoyasi, HMAC-SHA256 30 daqiqalik admin kodi
│   └── audit.py             # Admin va vaqtinchalik admin harakatlarini bazaga yozish
├── keyboards/
│   ├── __init__.py
│   ├── user_kb.py           # Foydalanuvchi Reply va Inline klaviaturalari
│   └── admin_kb.py          # Asosiy va vaqtinchalik admin klaviaturalari
├── middlewares/
│   ├── __init__.py
│   ├── auth_sub.py          # Foydalanuvchini bazaga yozish, obuna va telefon tasdig‘ini tekshirish
│   └── throttling.py        # Spam va floodga qarshi cheklov middleware'i
├── requirements.txt         # Python kutubxonalari ro‘yxati
├── Procfile                 # Railway worker start konfiguratsiyasi
├── railway.json             # Railway Nixpacks va DOIMIY qayta ishga tushish (ALWAYS restart) sozlamasi
├── .env.example             # Kerakli environment variables namunasi
└── README.md                # O‘rnatish va Railway’ga joylash bo‘yicha to‘liq qo‘llanma
```

---

## 🗄 2. PostgreSQL Ma’lumotlar Bazasi Jadvallari

Loyiha ishga tushganda `database.py` orqali quyidagi barcha jadvallar avtomatik yaratiladi:

1. **`users`** (`Users`) — Foydalanuvchilar, telefon raqami, obuna va telefon tasdig‘i holati, ixtiyoriy yosh, brute-force bloklanish vaqti.
2. **`channels`** (`Channels`) — 1 tadan 10 tagacha majburiy kanallar (`channel_id`, `title`, `username`, `invite_link`).
3. **`contents`** (`Contents`) — Maxsus kodlar (`code` UNIQUE), kontent turi, albom belgisi va foydalanishlar soni (`usage_count`).
4. **`content_items`** (`ContentItems`) — Har bir kodga tegishli yakka fayllar yoki media guruh (albom) elementlari (`file_id`, `media_type`, `caption`, `text_content`).
5. **`content_access_logs`** (`ContentAccessLogs`) — Kod orqali olingan kontentlar tarixi va statistikasi.
6. **`temporary_admins`** (`TemporaryAdmins`) — 30 daqiqalik vaqtinchalik admin huquqlari va ularning tugash vaqti (`expires_at`).
7. **`bot_settings`** (`BotSettings`) — Tizim sozlamalari (HMAC-SHA256 xeshlangan vaqtinchalik admin kodi, vaqtinchalik xabarlarni o‘chirish muddati).
8. **`broadcasts`** (`Broadcasts`) — Reklama kampaniyalari va ularning umumiy ko‘rsatkichlari.
9. **`broadcast_recipients`** (`BroadcastRecipients`) — Har bir foydalanuvchiga reklama yetkazilganlik holati (bot o‘chib-yonsa kelgan joyidan davom etadi).
10. **`audit_logs`** (`AuditLogs`) — Asosiy va vaqtinchalik adminlarning barcha amallari jurnali.
11. **`scheduled_message_deletions`** — Bot yuborgan vaqtinchalik ogohlantirish xabarlarini belgilangan vaqtda o‘chirish jadvali.

---

## 🚀 3. GitHub’ga Yuklash va Railway’da Ishga Tushirish Bo‘yicha Qo‘llanma

### 1-qadam: Telegram Bot yaratish va Admin ID olish
1. Telegram’da [@BotFather](https://t.me/BotFather) ga kiring va `/newbot` buyrug‘i orqali **WORKING CODE** nomli bot yarating.
2. Berilgan **API Token** (`BOT_TOKEN`) ni nusxalab oling.
3. [@userinfobot](https://t.me/userinfobot) ga `/start` bosib, o‘zingizning shaxsiy Telegram ID raqamingizni (`ADMIN_ID`) aniqlang.

### 2-qadam: Loyihani GitHub’ga yuklash
Terminalda loyiha papkasida quyidagi buyruqlarni bajaring:

```bash
git init
git add .
git commit -m "Initial commit: WORKING CODE Telegram Bot"
git branch -M main
git remote add origin https://github.com/SIZNING_USERNAME/working-code-bot.git
git push -u origin main
```
> ⚠️ **Muhim:** `.env` faylini hech qachon GitHub’ga yuklamang (`.gitignore` ichida himoyalangan).

### 3-qadam: Railway’da Loyiha va PostgreSQL yaratish
1. [Railway.app](https://railway.app/) saytiga GitHub profilingiz orqali kiring.
2. **"New Project"** tugmasini bosing va **"Deploy from GitHub repo"** ni tanlab, `working-code-bot` repozitoriyingizni ulang.
3. Loyiha oynasida **"+ New"** -> **"Database"** -> **"Add PostgreSQL"** tugmasini bosing. Railway avtomatik ravishda doimiy PostgreSQL ma’lumotlar bazasini yaratadi.

### 4-qadam: Environment Variables (O‘zgaruvchilarni) kiritish
Railway’da bot xizmatingiz (Service) ustiga bosing va **"Variables"** bo‘limiga o‘tib, quyidagi o‘zgaruvchilarni kiriting:

| O‘zgaruvchi nomi | Qiymat namunasi | Izoh |
| :--- | :--- | :--- |
| `BOT_TOKEN` | `7123456789:AAH...` | `@BotFather` bergan bot tokeni |
| `ADMIN_ID` | `123456789` | Asosiy administratorning Telegram ID raqami |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway PostgreSQL bazasiga havola (`Reference Variable` orqali ulanadi) |
| `TIMEZONE` | `Asia/Tashkent` | O‘zbekiston vaqt mintaqasi |
| `LOG_LEVEL` | `INFO` | Log darajasi |
| `TEMP_MSG_DELETE_SECONDS` | `45` | Vaqtinchalik ogohlantirish xabarlarini avto-o‘chirish vaqti (soniya) |
| `RATE_LIMIT_MAX_ATTEMPTS` | `5` | Ketma-ket noto‘g‘ri kod urinishlari limiti |
| `RATE_LIMIT_LOCK_SECONDS` | `300` | Brute-force bloklash vaqti (soniya) |

> 💡 **Eslatma:** Railway PostgreSQL beradigan `postgresql://...` yoki `postgres://...` manzili `config.py` ichida avtomatik ravishda `postgresql+asyncpg://...` formatiga o‘giriladi!

### 5-qadam: 24/7 Doimiy Ishlashga Tushirish
1. Railway `railway.json` va `Procfile` fayllarini avtomatik o‘qiydi hamda `python main.py` buyrug‘i bilan botni ishga tushiradi.
2. **"Deployments"** bo‘limidagi loglarda quyidagi yozuv chiqqaniga ishonch hosil qiling:
   - `PostgreSQL ma'lumotlar bazasi muvaffaqiyatli ulandi va jadvallar tayyorlandi.`
   - `Bot muvaffaqiyatli ishga tushdi: @...`

---

## ✅ 4. Botni Sinash Uchun Tekshiruv Ro‘yxati (Checklist)

1. **Asosiy Admin tekshiruvi:**
   - `ADMIN_ID` hisobidan `/start` bosing — obuna va telefon so‘ralmasdan darhol 6 ta tugmali Admin Panel chiqishini tekshiring.
2. **Majburiy kanal qo‘shish:**
   - Botni o‘zingizning test kanalingizga **Administrator** qiling (`Invite Users via Link` huquqi bilan).
   - `📡 Kanallar` -> `➕ Kanal qo‘shish` orqali `@kanal_username` yuboring va kanal saqlanganini tekshiring.
3. **Kontent va Maxsus Kod qo‘shish:**
   - `📂 Xabarlar` -> `➕ Xabar qo‘shish` bosing, 1 ta video yoki 2–3 ta rasmdan iborat albom yuboring, so‘ng `VIDEO2026` kodini biriktiring.
4. **Oddiy foydalanuvchi oqimi (`/start`):**
   - Boshqa Telegram hisobdan `/start` bosing.
   - Bot ism bilan kutib olib, kanalga obuna bo‘lishni so‘rashini tekshiring.
   - Kanalga a’zo bo‘ling — hech qanday tugma bosmasdan bot `chat_member` orqali obunani sezib, telefon tasdiqlash tugmasini (`📱 Telefon raqamni tasdiqlash`) chiqarishini tekshiring.
   - Boshqa odamning kontaktini yuborib ko‘ring — bot rad etishini tekshiring.
   - O‘z kontaktingizni tugma orqali yuboring — asosiy funksiyalar ochilishini tekshiring.
5. **Maxsus kod orqali kontent olish va himoya:**
   - `video2026` (kichik harflarda) yozib yuboring — kontent kelishini va uni boshqaga **Forward qilib bo‘lmasligini (`protect_content=True`)** tekshiring.
   - Kanaldan chiqib keting va kod yozing — bot darhol funksiyalarni bloklashini va qayta obuna bo‘lgach avtomatik ochishini tekshiring.
6. **30 daqiqalik vaqtinchalik admin:**
   - Asosiy adminda `🔐 Maxfiy kod va sozlamalar` -> `🔑 30 daqiqalik admin kodini o‘rnatish` orqali masalan `TEMP2026` kodini o‘rnating.
   - Oddiy foydalanuvchidan `TEMP2026` yuboring — 30 daqiqalik cheklangan admin menyusi ochilishini va `Audit Log`da yozilishini tekshiring.
7. **Reklama (Broadcast):**
   - `📢 Reklama` bo‘limiga kirib rasm+matn yuboring, preview chiqqach `✅ Yuborish` ni bosing va yakuniy hisobot kelishini tekshiring.
