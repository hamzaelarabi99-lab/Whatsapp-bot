import fs from 'fs';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

const DB_FILE = './database.json';
const AUTH_DIR = './auth_info_baileys';
const DEFAULT_PHONE = '212710530141';

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ groups: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('❌ Error reading database.json:', err);
    return { groups: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensureGroup(db, groupId) {
  if (!db.groups[groupId]) {
    db.groups[groupId] = {
      users: {}
    };
  }
  return db.groups[groupId];
}

function ensureUser(db, groupId, userId, name = 'عضو') {
  const group = ensureGroup(db, groupId);
  if (!group.users[userId]) {
    group.users[userId] = {
      name,
      coupe: 0,
      point: 0
    };
  } else if (name && name !== 'عضو') {
    group.users[userId].name = name;
  }
  return group.users[userId];
}

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

function getMentions(message) {
  return message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

function getSender(msg) {
  return msg.key.participant || msg.key.remoteJid;
}

function getDisplayName(msg, fallback = 'عضو') {
  return (
    msg.pushName ||
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    fallback
  );
}

function normalizeId(id) {
  return id ? id.replace(/:\d+(?=@)/, '') : id;
}

async function isGroupAdmin(sock, groupId, senderId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const sender = normalizeId(senderId);
    const participant = metadata.participants.find(
      (p) => normalizeId(p.id) === sender
    );
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch {
    return false;
  }
}

function mentionTag(jid) {
  return `@${jid.split('@')[0].split(':')[0]}`;
}

function formatTop(db, groupId) {
  const group = ensureGroup(db, groupId);
  const users = Object.entries(group.users);

  const coupeTop = [...users]
    .sort((a, b) => (b[1].coupe || 0) - (a[1].coupe || 0))
    .slice(0, 10);

  const pointTop = [...users]
    .sort((a, b) => (b[1].point || 0) - (a[1].point || 0))
    .slice(0, 10);

  let text = '🏆 *المتصدرين*\n\n';
  text += '👑 *ترتيب الكؤوس:*\n';

  if (!coupeTop.length) {
    text += 'لا يوجد أعضاء بعد.\n';
  } else {
    coupeTop.forEach(([jid, user], i) => {
      text += `${i + 1}. ${user.name || mentionTag(jid)} — 🏆 ${user.coupe || 0}\n`;
    });
  }

  text += '\n⭐ *ترتيب النقاط:*\n';

  if (!pointTop.length) {
    text += 'لا يوجد أعضاء بعد.\n';
  } else {
    pointTop.forEach(([jid, user], i) => {
      text += `${i + 1}. ${user.name || mentionTag(jid)} — ⭐ ${user.point || 0}\n`;
    });
  }

  return text.trim();
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = state.creds.registered;
  let pairingTimer = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // No QR is displayed. Request the pairing code only after the socket
    // reaches the connecting state (or emits the QR reference). This avoids
    // timing-related dead/invalid pairing codes on WhatsApp.
    if ((connection === 'connecting' || qr) && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      clearTimeout(pairingTimer);
      pairingTimer = setTimeout(async () => {
        try {
          const phone = (process.env.PHONE_NUMBER || DEFAULT_PHONE).replace(/\D/g, '');

          if (!phone || phone.length < 10) {
            throw new Error('PHONE_NUMBER غير صالح. استعمل الصيغة الدولية بدون + أو مسافات، مثال: 212710530141');
          }

          console.log(`\n📱 رقم واتساب للبوت: +${phone}`);
          console.log('⏳ جاري إنشاء Pairing Code...');

          const code = await sock.requestPairingCode(phone);
          console.log('\n🔐 كود الربط مع واتساب:', code);
          console.log('📲 واتساب → الأجهزة المرتبطة → ربط جهاز → الربط برقم الهاتف → دخل الكود فوراً.\n');
        } catch (err) {
          console.error('❌ تعذر إنشاء كود الربط:', err?.message || err);
          pairingRequested = false;
        }
      }, 1500);
    }

    if (connection === 'open') {
      console.log('✅ البوت متصل بواتساب بنجاح!');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `⚠️ الاتصال تسد. إعادة الاتصال: ${shouldReconnect ? 'نعم' : 'لا'}`
      );

      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        console.log('🔒 تم تسجيل الخروج. احذف مجلد auth_info_baileys إذا أردت ربط رقم جديد.');
      }
    }
  });

  // Welcome new members.
  sock.ev.on('group-participants.update', async (update) => {
    if (update.action !== 'add') return;

    try {
      const mentions = update.participants || [];
      if (!mentions.length) return;

      const names = mentions.map(mentionTag).join(' و ');
      await sock.sendMessage(update.id, {
        text:
          `🎉 *مرحبا بيك فالمجموعة!*\n\n` +
          `أهلا ${names} 👋\n` +
          `🏆 الكؤوس: !coupe\n` +
          `⭐ النقاط: !point\n` +
          `🏅 المتصدرين: !top`,
        mentions
      });

      const db = loadDB();
      for (const jid of mentions) {
        ensureUser(db, update.id, jid, 'عضو');
      }
      saveDB(db);
    } catch (err) {
      console.error('❌ Welcome error:', err?.message || err);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid || !jid.endsWith('@g.us')) continue;

        const text = getText(msg);
        if (!text.startsWith('!')) continue;

        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();
        const mentions = getMentions(msg);
        const sender = getSender(msg);

        const db = loadDB();

        // !coupe
        if (command === '!coupe') {
          const user = ensureUser(db, jid, sender, msg.pushName || 'عضو');
          saveDB(db);

          await sock.sendMessage(jid, {
            text: `🏆 ${user.name || mentionTag(sender)} عندو *${user.coupe || 0}* كؤوس.`,
            mentions: [sender]
          }, { quoted: msg });

          continue;
        }

        // !point
        if (command === '!point') {
          const user = ensureUser(db, jid, sender, msg.pushName || 'عضو');
          saveDB(db);

          await sock.sendMessage(jid, {
            text: `⭐ ${user.name || mentionTag(sender)} عندو *${user.point || 0}* نقطة.`,
            mentions: [sender]
          }, { quoted: msg });

          continue;
        }

        // !top
        if (command === '!top') {
          await sock.sendMessage(jid, {
            text: formatTop(db, jid)
          }, { quoted: msg });

          continue;
        }

        // Admin-only commands
        if (command === '!setcoupe' || command === '!setpoint') {
          const admin = await isGroupAdmin(sock, jid, sender);
          if (!admin) {
            await sock.sendMessage(jid, {
              text: '⛔ هاد الأمر غير متاح غير لأدمن المجموعة.'
            }, { quoted: msg });
            continue;
          }

          if (!mentions.length) {
            await sock.sendMessage(jid, {
              text:
                command === '!setcoupe'
                  ? '❌ منشن الشخص مع الأمر: !setcoupe @الشخص'
                  : '❌ منشن الشخص والكمية: !setpoint @الشخص 50'
            }, { quoted: msg });
            continue;
          }

          const target = mentions[0];
          const user = ensureUser(db, jid, target, 'عضو');

          if (command === '!setcoupe') {
            user.coupe = (user.coupe || 0) + 1;
            saveDB(db);

            await sock.sendMessage(jid, {
              text: `🏆 تمت إضافة *كأس واحد* إلى ${mentionTag(target)}.\nالمجموع: *${user.coupe}* كؤوس.`,
              mentions: [target]
            }, { quoted: msg });
          } else {
            const amount = Number(parts.find((p) => /^\d+$/.test(p)));
            if (!Number.isInteger(amount) || amount <= 0) {
              await sock.sendMessage(jid, {
                text: '❌ مثال صحيح: !setpoint @الشخص 50'
              }, { quoted: msg });
              continue;
            }

            user.point = (user.point || 0) + amount;
            saveDB(db);

            await sock.sendMessage(jid, {
              text: `⭐ تمت إضافة *${amount} نقطة* إلى ${mentionTag(target)}.\nالمجموع: *${user.point}* نقطة.`,
              mentions: [target]
            }, { quoted: msg });
          }

          continue;
        }
      } catch (err) {
        console.error('❌ Message handler error:', err?.message || err);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
                                  
