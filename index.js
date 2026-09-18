import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import config from './config.js';
import { db } from './src/db.js';
import { handleCommand } from './src/commands.js';
import { handleWelcome } from './src/welcome.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
let reconnectTimer = null;
let stopping = false;
let pairingRequested = false;

function getErrorStatus(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode;
}

function ownerJid() {
  return `${config.ownerNumber}@s.whatsapp.net`;
}

async function startBot() {
  if (stopping) return;

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('V6'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !state.creds.registered && !config.pairingCode) {
      console.log('\n📱 امسح QR من WhatsApp > الأجهزة المرتبطة > ربط جهاز:');
      qrcode.generate(qr, { small: true });
    }

    if (qr && !state.creds.registered && config.pairingCode && !pairingRequested) {
      pairingRequested = true;
      try {
        const number = String(config.pairingNumber).replace(/\D/g, '');
        const code = await sock.requestPairingCode(number);
        console.log(`\n🔐 V6 Pairing Code: ${code.match(/.{1,4}/g)?.join('-') || code}`);
        console.log('في WhatsApp: الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف.');
      } catch (error) {
        pairingRequested = false;
        console.error('❌ فشل إنشاء Pairing Code:', error?.message || error);
      }
    }

    if (connection === 'open') {
      pairingRequested = false;
      console.log('✅ V6 متصل بواتساب.');
    }

    if (connection === 'close') {
      const statusCode = getErrorStatus(lastDisconnect?.error);
      console.error(`⚠️ الاتصال تسد. statusCode: ${statusCode ?? 'unknown'}`);

      if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
        stopping = true;
        console.error('🔒 تم تسجيل الخروج (401). احذف مجلد auth_info_baileys إذا أردت ربط رقم جديد، ثم شغّل البوت من جديد.');
        return;
      }

      if (stopping) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        pairingRequested = false;
        startBot().catch((error) => console.error('❌ خطأ أثناء إعادة الاتصال:', error));
      }, 3000);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      await handleWelcome(sock, update);
    } catch (error) {
      console.error('❌ خطأ في الترحيب:', error?.message || error);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        if (!message?.message || message.key.fromMe) continue;
        const remoteJid = message.key.remoteJid;
        if (!remoteJid || !remoteJid.endsWith('@g.us')) continue;

        await handleCommand(sock, message, {
          db,
          ownerJid: ownerJid(),
          jidNormalizedUser
        });
      } catch (error) {
        console.error('❌ خطأ في معالجة رسالة:', error?.message || error);
      }
    }
  });
}

process.on('unhandledRejection', (error) => {
  console.error('⚠️ unhandledRejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ uncaughtException:', error);
});

process.on('SIGINT', () => {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  db.close();
  process.exit(0);
});

startBot().catch((error) => {
  console.error('❌ فشل تشغيل V6:', error);
  process.exitCode = 1;
});
