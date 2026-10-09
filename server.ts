import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_PROJECT_FILES = [
  { path: 'main.py', category: 'Asosiy modullar', description: 'Kirish nuqtasi, Polling, Background Workers va xavfsiz yopilish' },
  { path: 'config.py', category: 'Asosiy modullar', description: 'Environment variables va Railway DATABASE_URL (asyncpg) konfiguratsiyasi' },
  { path: 'database.py', category: 'Asosiy modullar', description: 'SQLAlchemy 2.x AsyncEngine, qayta ulanish va avtomatik jadval yaratish' },
  { path: 'models.py', category: 'Asosiy modullar', description: '11 ta PostgreSQL jadvallari va bog‘lanishlar (Users, Channels, Contents va b.)' },
  { path: 'handlers/__init__.py', category: 'Handlerlar (handlers/)', description: 'Barcha routerlarni ustuvorlik tartibida ro‘yxatdan o‘tkazish' },
  { path: 'handlers/states.py', category: 'Handlerlar (handlers/)', description: 'FSM (Finite State Machine) holatlari' },
  { path: 'handlers/user.py', category: 'Handlerlar (handlers/)', description: '/start, chat_member avto-ochish, telefon tasdiqlash va maxsus kod qidirish' },
  { path: 'handlers/admin.py', category: 'Handlerlar (handlers/)', description: 'Statistika (12 ko‘rsatkich), Foydalanuvchilar sahifalash va Xavfsizlik sozlamalari' },
  { path: 'handlers/channels.py', category: 'Handlerlar (handlers/)', description: '1–10 ta majburiy kanalni qo‘shish, tekshirish, o‘zgartirish va o‘chirish' },
  { path: 'handlers/contents.py', category: 'Handlerlar (handlers/)', description: 'Xabarlar, media albomlar va noyob maxsus kodlarni boshqarish' },
  { path: 'handlers/broadcast.py', category: 'Handlerlar (handlers/)', description: 'Ommaviy reklama preview, tasdiqlash va navbatga qo‘yish' },
  { path: 'services/__init__.py', category: 'Xizmatlar (services/)', description: 'Xizmatlar paketi initsializatori' },
  { path: 'services/subscription.py', category: 'Xizmatlar (services/)', description: 'Kanal obunasi va bot admin huquqlarini tekshirish xizmati' },
  { path: 'services/cleanup.py', category: 'Xizmatlar (services/)', description: 'Vaqtinchalik bot xabarlarini belgilangan muddatda avtomatik o‘chirish' },
  { path: 'services/broadcast.py', category: 'Xizmatlar (services/)', description: 'Reklama navbat tizimi va qayta ishga tushganda davom ettirish' },
  { path: 'services/security.py', category: 'Xizmatlar (services/)', description: 'Telefon normalizatsiyasi, brute-force himoyasi va 30 daqiqalik admin kodi' },
  { path: 'services/audit.py', category: 'Xizmatlar (services/)', description: 'Asosiy va vaqtinchalik admin harakatlarini AuditLog ga yozish' },
  { path: 'keyboards/__init__.py', category: 'Klaviaturalar (keyboards/)', description: 'Klaviaturalar paketi initsializatori' },
  { path: 'keyboards/user_kb.py', category: 'Klaviaturalar (keyboards/)', description: 'Foydalanuvchi obuna, kontakt va asosiy menyu klaviaturalari' },
  { path: 'keyboards/admin_kb.py', category: 'Klaviaturalar (keyboards/)', description: 'Asosiy admin va vaqtinchalik admin Reply/Inline klaviaturalari' },
  { path: 'middlewares/__init__.py', category: 'Middleware (middlewares/)', description: 'Middleware paketi initsializatori' },
  { path: 'middlewares/auth_sub.py', category: 'Middleware (middlewares/)', description: 'Baza sessiyasi, foydalanuvchi yangilash, obuna va telefon nazorati' },
  { path: 'middlewares/throttling.py', category: 'Middleware (middlewares/)', description: 'Flood va spamga qarshi cheklov middleware' },
  { path: 'requirements.txt', category: 'Railway va Konfiguratsiya', description: 'Python 3.12+ kutubxonalari ro‘yxati (aiogram, SQLAlchemy, asyncpg)' },
  { path: 'Procfile', category: 'Railway va Konfiguratsiya', description: 'Railway worker jarayonini ishga tushirish konfiguratsiyasi' },
  { path: 'railway.json', category: 'Railway va Konfiguratsiya', description: 'Railway Nixpacks va ALWAYS restart siyosati' },
  { path: '.env.example', category: 'Railway va Konfiguratsiya', description: 'Environment variables namunasi (BOT_TOKEN, ADMIN_ID, DATABASE_URL)' },
  { path: 'README.md', category: 'Railway va Konfiguratsiya', description: 'GitHub va Railway’ga joylash bo‘yicha to‘liq o‘zbekcha yo‘riqnoma' },
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/project-files', (_req, res) => {
    try {
      const files = BOT_PROJECT_FILES.map((item) => {
        const fullPath = path.resolve(__dirname, item.path);
        let content = '';
        if (fs.existsSync(fullPath)) {
          content = fs.readFileSync(fullPath, 'utf-8');
        }
        const lines = content ? content.split('\n').length : 0;
        const sizeBytes = Buffer.byteLength(content, 'utf-8');
        return {
          ...item,
          content,
          lines,
          sizeBytes,
        };
      });
      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: 'Loyiha fayllarini o‘qishda xatolik yuz berdi.' });
    }
  });

  app.get('/api/download-installer', (_req, res) => {
    try {
      const bundleData: Record<string, string> = {};
      for (const item of BOT_PROJECT_FILES) {
        const fullPath = path.resolve(__dirname, item.path);
        if (fs.existsSync(fullPath)) {
          bundleData[item.path] = fs.readFileSync(fullPath, 'utf-8');
        }
      }

      const pythonUnpacker = `#!/usr/bin/env python3
"""
WORKING CODE — Telegram Bot loyihasini avtomatik chiqarib beruvchi (unpacker) skript.
Ishga tushirish: python3 setup_working_code_bot.py
"""
import json
import os
from pathlib import Path

FILES = ${JSON.stringify(bundleData, null, 2)}

def main():
    target_dir = Path("working-code-bot")
    target_dir.mkdir(exist_ok=True)
    for rel_path, content in FILES.items():
        file_path = target_dir / rel_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        print(f"[OK] Yaratildi: {file_path}")
    print("\\n✅ WORKING CODE Telegram bot loyihasi 'working-code-bot/' papkasiga muvaffaqiyatli yaratildi!")

if __name__ == "__main__":
    main()
`;
      res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="setup_working_code_bot.py"');
      res.send(pythonUnpacker);
    } catch (error) {
      res.status(500).send('Yuklab olish faylini tayyorlashda xatolik.');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WORKING CODE Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
