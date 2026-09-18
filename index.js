import fs from 'fs';
import pino from 'pino';
import makeWASocket, {
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
  } catch {
    return { groups: {} };
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getGroup(groupId) {
  if (!db.groups[groupId]) db.groups[groupId] = { users: {} };
  return db.groups[groupId];
}

function getUser(groupId, jid, name = '') {
  const group = getGroup(groupId);
  if (!group.users[jid]) {
    group.users[jid] = { name: name || 'Unknown', coupe: 0, point: 0 };
  } else if (name) {
    group.users[jid].name = name;
  }
  return group.users[jid];
}

function getMentionedJid(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
    || msg.message?.imageMessage?.contextInfo?.mentionedJid?.[0]
    || msg.message?.videoMessage?.contextInfo?.mentionedJid?.[0]
    || msg.message?.documentMessage?.contextInfo?.mentionedJid?.[0]
    || null;
}

function getText(msg) {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || msg.message?.documentMessage?.caption
    || '';
}

async function isAdmin(sock, groupId, jid) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const participant = metadata.participants.find(p => p.id === jid);
    return !!participant &&
      (participant.admin === 'admin' || participant.admin === 'superadmin');
  } catch {
    return false;
  }
}

async function send(sock, jid, text, options = {}) {
  await sock.sendMessage(jid, { text, ...options });
}

async function handleCommand(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid || !jid.endsWith('@g.us')) return;

  const text = getText(msg).trim();
  if (!text.startsWith('!')) return;

  const parts = text.slice(1).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const sender = msg.key.participant || msg.key.remoteJid;
  const senderName = msg.pushName || 'عضو';

  getUser(jid, sender, senderName);

  if (command === 'coupe') {
    const user = getUser(jid, sender, senderName);
    return send(sock, jid, `🏆 ${senderName}\nعندك حالياً: ${user.coupe} كأس`);
  }

  if (command === 'point') {
    const user = getUser(jid, sender, senderName);
    return send(sock, jid, `⭐ ${senderName}\nعندك حالياً: ${user.point} نقطة`);
  }

  if (command === 'setcoupe') {
    if (!(await isAdmin(sock, jid, sender))) {
      return send(sock, jid, '❌ هاد الأمر خاص غير بالأدمن.');
    }

    const target = getMentionedJid(msg);
    if (!target) {
      return send(sock, jid, '❌ استعمل: !setcoupe @الشخص');
    }

    const user = getUser(jid, target);
    user.coupe += 1;
    saveDB();

    return send(
      sock,
      jid,
      `🏆 تمت إضافة كأس لـ @${target.split('@')[0]}\nالمجموع: ${user.coupe}`,
      { mentions: [target] }
    );
  }

  if (command === 'setpoint') {
    if (!(await isAdmin(sock, jid, sender))) {
      return send(sock, jid, '❌ هاد الأمر خاص غير بالأدمن.');
    }

    const target = getMentionedJid(msg);
    const amount = Number(parts[0]);

    if (!target || !Number.isFinite(amount)) {
      return send(sock, jid, '❌ استعمل: !setpoint @الشخص 10');
    }

    const user = getUser(jid, target);
    user.point += amount;
    saveDB();

    return send(
      sock,
      jid,
      `⭐ تمت إضافة ${amount} نقطة لـ @${target.split('@')[0]}\nالمجموع: ${user.point}`,
      { mentions: [target] }
    );
  }

  if (command === 'top') {
    const group = getGroup(jid);
    const users = Object.entries(group.users);

    if (!users.length) {
      return send(sock, jid, '📊 مازال ما كاين حتى إحصائيات.');
    }

    const cups = [...users]
      .sort((a, b) => b[1].coupe - a[1].coupe)
      .slice(0, 10);

    const points = [...users]
      .sort((a, b) => b[1].point - a[1].point)
      .slice(0, 10);

    let out = '🏆 TOP الكؤوس\n';
    cups.forEach(([id, u], i) => {
      out += `${i + 1}. ${u.name || id.split('@')[0]} — ${u.coupe} 🏆\n`;
    });

    out += '\n⭐ TOP النقاط\n';
    points.forEach(([id, u], i) => {
      out += `${i + 1}. ${u.name || id.split('@')[0]} — ${u.point} ⭐\n`;
    });

    return send(sock, jid, out);
  }
}

let restarting = false;
let pairingRequested = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    browser: ['Ubuntu', 'Chrome', '122.0.0.0'],
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Wait for WhatsApp to provide the QR reference, then request the pairing code.
    if (qr && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;

      try {
        const phone = (process.env.PHONE_NUMBER || DEFAULT_PHONE).replace(/\D/g, '');

        if (!phone || phone.length < 10) {
          throw new Error(
            'PHONE_NUMBER غير صالح. استعمل الرقم الدولي بدون + أو مسافات، مثال: 212710530141'
          );
        }

        console.log(`📱 رقم واتساب للبوت: +${phone}`);
        console.log('⏳ جاري إنشاء Pairing Code...');

        const code = await sock.requestPairingCode(phone);

        console.log(`🔐 كود الربط مع واتساب: ${code}`);
        console.log(
          '📲 واتساب → الأجهزة المرتبطة → ربط جهاز → الربط برقم الهاتف → دخل الكود فوراً.'
        );
      } catch (err) {
        pairingRequested = false;
        console.error('❌ تعذر إنشاء كود الربط:', err?.message || err);
      }
    }

    if (connection === 'open') {
      console.log('✅ البوت متصل بواتساب بنجاح!');
      pairingRequested = true;
    }

    if (connection === 'close') {
      const statusCode =
        new Boom(lastDisconnect?.error)?.output?.statusCode;

      console.error('❌ CONNECTION CLOSED');
      console.error('🔢 Status code:', statusCode ?? 'unknown');
      console.error(
        '📄 Error:',
        lastDisconnect?.error?.message || lastDisconnect?.error || 'unknown'
      );

      const loggedOut =
        statusCode === DisconnectReason.loggedOut || statusCode === 401;

      if (loggedOut) {
        if (!restarting) {
          restarting = true;

          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            console.log('🧹 تم حذف جلسة auth القديمة بعد loggedOut/401.');
            console.log('🔄 غادي نعاود نبدأ جلسة Pairing جديدة مرة واحدة...');
          } catch (e) {
            console.error('❌ فشل حذف auth:', e?.message || e);
          }

          setTimeout(() => {
            restarting = false;
            pairingRequested = false;
            startBot().catch(err => console.error('❌ startBot:', err));
          }, 2500);
        } else {
          console.error('🛑 تم إيقاف إعادة المحاولة لمنع loop لا نهائي.');
        }

        return;
      }

      if (!restarting) {
        restarting = true;

        setTimeout(() => {
          restarting = false;
          pairingRequested = false;
          startBot().catch(err => console.error('❌ startBot:', err));
        }, 3000);
      }
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    if (update.action !== 'add') return;

    const groupId = update.id;

    for (const participant of update.participants) {
      const name = participant.split('@')[0];
      getUser(groupId, participant, name);

      try {
        await sock.sendMessage(groupId, {
          text: `👋 مرحباً @${name}!\n🎉 مرحبا بك فالمجموعة!`,
          mentions: [participant]
        });
      } catch (e) {
        console.error('❌ welcome error:', e?.message || e);
      }
    }

    saveDB();
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      try {
        await handleCommand(sock, msg);
      } catch (e) {
        console.error('❌ command error:', e?.message || e);
      }
    }
  });
}

startBot().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
    
