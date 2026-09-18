import fs from 'fs';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

const DB_FILE = './database.json';
const AUTH_DIR = './auth_info_baileys';
const DEFAULT_PHONE = '212710530141';

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = { groups: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      return db;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { groups: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensureGroup(db, groupId) {
  if (!db.groups[groupId]) db.groups[groupId] = { users: {} };
  return db.groups[groupId];
}

function jidFromMention(message) {
  return message?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
    || message?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
}

function getText(message) {
  const m = message?.message;
  return m?.conversation
    || m?.extendedTextMessage?.text
    || m?.imageMessage?.caption
    || m?.videoMessage?.caption
    || '';
}

function senderJid(message) {
  return message?.key?.participant || message?.key?.remoteJid;
}

async function isGroupAdmin(sock, groupId, userJid) {
  try {
    const meta = await sock.groupMetadata(groupId);
    const p = meta.participants.find(x => x.id === userJid);
    return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
  } catch {
    return false;
  }
}

function upsertUser(group, jid, name = '') {
  if (!group.users[jid]) group.users[jid] = { name, coupe: 0, point: 0 };
  if (name) group.users[jid].name = name;
  return group.users[jid];
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let waVersion;
  try {
    const latest = await fetchLatestWaWebVersion({});
    if (latest?.isLatest && Array.isArray(latest.version)) {
      waVersion = latest.version;
      console.log(`🌐 WhatsApp Web version: [${waVersion.join(', ')}]`);
    } else {
      console.log('⚠️ تعذر جلب أحدث WhatsApp Web version، سيتم استعمال النسخة الافتراضية.');
    }
  } catch (err) {
    console.log('⚠️ فشل جلب WhatsApp Web version:', err?.message || err);
  }

  const sockOptions = {
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000
  };

  if (waVersion) sockOptions.version = waVersion;

  const sock = makeWASocket(sockOptions);
  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = state.creds.registered;
  let pairingTimer = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if ((connection === 'connecting' || qr) && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      clearTimeout(pairingTimer);
      pairingTimer = setTimeout(async () => {
        try {
          const phone = (process.env.PHONE_NUMBER || DEFAULT_PHONE).replace(/\D/g, '');
          if (!phone || phone.length < 10) throw new Error('PHONE_NUMBER غير صالح.');

          console.log(`\n📱 رقم واتساب للبوت: +${phone}`);
          console.log('⏳ جاري إنشاء Pairing Code...');

          const code = await sock.requestPairingCode(phone);
          console.log(`\n🔐 كود الربط مع واتساب: ${code}`);
          console.log('📲 واتساب → الأجهزة المرتبطة → ربط جهاز → الربط برقم الهاتف → دخل الكود فوراً.\n');
        } catch (err) {
          console.error('❌ تعذر إنشاء كود الربط:', err?.message || err);
          pairingRequested = false;
        }
      }, 2000);
    }

    if (connection === 'open') {
      console.log('✅ البوت متصل بواتساب بنجاح!');
    }

    if (connection === 'close') {
      const boom = new Boom(lastDisconnect?.error);
      const statusCode = boom.output?.statusCode;
      console.log(`⚠️ الاتصال تسد. statusCode: ${statusCode ?? 'غير معروف'}`);
      console.log(`⚠️ إعادة الاتصال: ${statusCode !== DisconnectReason.loggedOut ? 'نعم' : 'لا'}`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🔒 تم تسجيل الخروج. احذف مجلد auth_info_baileys إذا أردت ربط رقم جديد.');
        return;
      }

      setTimeout(startBot, 3000);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    if (update.action !== 'add') return;

    const db = loadDB();
    const group = ensureGroup(db, update.id);

    for (const participant of update.participants) {
      upsertUser(group, participant);
    }
    saveDB(db);

    for (const participant of update.participants) {
      try {
        await sock.sendMessage(update.id, {
          text: `👋 مرحباً @${participant.split('@')[0]}! نورت المجموعة 🎉`,
          mentions: [participant]
        });
      } catch {}
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages?.[0];
    if (!message || message.key.fromMe) return;

    const groupId = message.key.remoteJid;
    if (!groupId || !groupId.endsWith('@g.us')) return;

    const text = getText(message).trim();
    if (!text.startsWith('!')) return;

    const sender = senderJid(message);
    const commandLine = text.slice(1).trim();
    const parts = commandLine.split(/\s+/);
    const command = (parts.shift() || '').toLowerCase();

    const db = loadDB();
    const group = ensureGroup(db, groupId);
    const senderUser = upsertUser(group, sender);

    if (command === 'coupe') {
      await sock.sendMessage(groupId, {
        text: `🏆 @${sender.split('@')[0]} عندك *${senderUser.coupe}* كأس/كؤوس.`,
        mentions: [sender]
      });
      saveDB(db);
      return;
    }

    if (command === 'point') {
      await sock.sendMessage(groupId, {
        text: `⭐ @${sender.split('@')[0]} عندك *${senderUser.point}* نقطة/نقاط.`,
        mentions: [sender]
      });
      saveDB(db);
      return;
    }

    if (command === 'top') {
      const users = Object.entries(group.users);
      const cups = [...users].sort((a,b) => (b[1].coupe||0)-(a[1].coupe||0)).slice(0,10);
      const points = [...users].sort((a,b) => (b[1].point||0)-(a[1].point||0)).slice(0,10);

      const cupText = cups.length
        ? cups.map(([jid,u],i)=>`${i+1}. @${jid.split('@')[0]} — 🏆 ${u.coupe||0}`).join('\n')
        : 'لا يوجد بعد.';
      const pointText = points.length
        ? points.map(([jid,u],i)=>`${i+1}. @${jid.split('@')[0]} — ⭐ ${u.point||0}`).join('\n')
        : 'لا يوجد بعد.';

      const mentions = [...new Set([...cups.map(x=>x[0]), ...points.map(x=>x[0])])];
      await sock.sendMessage(groupId, {
        text: `🏆 *TOP الكؤوس*\n${cupText}\n\n⭐ *TOP النقاط*\n${pointText}`,
        mentions
      });
      saveDB(db);
      return;
    }

    if (command === 'setcoupe' || command === 'setpoint') {
      const admin = await isGroupAdmin(sock, groupId, sender);
      if (!admin) {
        await sock.sendMessage(groupId, { text: '❌ هاد الأمر غير متاح غير للأدمن.' });
        return;
      }

      const target = jidFromMention(message);
      if (!target) {
        await sock.sendMessage(groupId, {
          text: command === 'setcoupe'
            ? '❌ استعمل: !setcoupe @الشخص'
            : '❌ استعمل: !setpoint @الشخص المبلغ'
        });
        return;
      }

      const targetUser = upsertUser(group, target);

      if (command === 'setcoupe') {
        targetUser.coupe += 1;
        await sock.sendMessage(groupId, {
          text: `🏆 تمت إضافة كأس لـ @${target.split('@')[0]}.\nالمجموع: *${targetUser.coupe}*`,
          mentions: [target]
        });
      } else {
        const amount = Number(parts[0]);
        if (!Number.isFinite(amount) || amount <= 0) {
          await sock.sendMessage(groupId, { text: '❌ المبلغ خاصو يكون رقم أكبر من 0.\nمثال: !setpoint @الشخص 50' });
          return;
        }
        targetUser.point += amount;
        await sock.sendMessage(groupId, {
          text: `⭐ تمت إضافة *${amount}* نقطة لـ @${target.split('@')[0]}.\nالمجموع: *${targetUser.point}*`,
          mentions: [target]
        });
      }

      saveDB(db);
    }
  });
}

startBot().catch(err => {
  console.error('❌ خطأ قاتل:', err);
  process.exit(1);
});
        
