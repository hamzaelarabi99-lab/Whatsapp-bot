import baileysPackage from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';

const makeWASocket = baileysPackage.default || baileysPackage;
const { useMultiFileAuthState, DisconnectReason } = baileysPackage;

const BOT_OWNER = '212710530141';
const DB_FILE = './database.json';

function getDB() {
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(db, jid) {
    if (!db[jid]) db[jid] = { cups: 0, points: 0 };
    return db[jid];
}

let isPairingRequested = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log('❌ انقطع الاتصال، جاري إعادة المحاولة بعد 10 ثوانٍ...');
            isPairingRequested = false;
            if (shouldReconnect) {
                setTimeout(startBot, 10000);
            }
        } else if (connection === 'connecting') {
            console.log('⏳ جاري الاتصال بالسيرفر...');
            
            if (!sock.authState.creds.registered && !isPairingRequested) {
                isPairingRequested = true;
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(BOT_OWNER);
                        console.log(`\n====================================`);
                        console.log(`📱 الرقم: +${BOT_OWNER}`);
                        console.log(`🔑 رمز الربط: ${code}`);
                        console.log(`====================================\n`);
                    } catch (err) {
                        console.log('⚠️ خطأ فـ طلب الرمز، كايتسنى المحاولة الجاية...');
                        isPairingRequested = false;
                    }
                }, 10000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بالواتساب بنجاح! البوت جاهز ومستقر.');
        }
    });

    // الترحيب بالأعضاء الجدد
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action === 'add') {
            for (const participant of participants) {
                await sock.sendMessage(id, {
                    text: `مرحباً بك @${participant.split('@')[0]} في المجموعة! 🥳👋`,
                    mentions: [participant]
                });
            }
        }
    });

    // الأوامر
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');

        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text || '';

        const db = getDB();

        if (text.startsWith('!setcoupe')) {
            if (senderNumber !== BOT_OWNER) {
                await sock.sendMessage(from, { text: '⚠️ هذا الأمر مخصص لمالك البوت فقط!' });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length === 0) return;
            const target = mentioned[0];
            const u = getUser(db, target);
            u.cups += 1;
            saveDB(db);
            await sock.sendMessage(from, { text: `🏆 تم إضافة كأس لـ @${target.split('@')[0]}!`, mentions: [target] });
        }
        else if (text.trim() === '!coupe') {
            const u = getUser(db, sender);
            await sock.sendMessage(from, { text: `🏆 @${sender.split('@')[0]} لديك: ${u.cups} كأس.`, mentions: [sender] });
        }
        else if (text.startsWith('!setpoint')) {
            if (senderNumber !== BOT_OWNER) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const args = text.trim().split(/\s+/);
            const amt = args.find(a => !isNaN(a) && a.trim() !== '');
            if (mentioned.length === 0 || !amt) return;
            const target = mentioned[0];
            const u = getUser(db, target);
            u.points += parseInt(amt, 10);
            saveDB(db);
            await sock.sendMessage(from, { text: `⭐ تم إضافة ${amt} نقطة لـ @${target.split('@')[0]}!`, mentions: [target] });
        }
        else if (text.trim() === '!point') {
            const u = getUser(db, sender);
            await sock.sendMessage(from, { text: `⭐ @${sender.split('@')[0]} لديك: ${u.points} نقطة.`, mentions: [sender] });
        }
        else if (text.trim() === '!top') {
            const entries = Object.entries(db);
            if (entries.length === 0) return;
            const sortedByCups = [...entries].sort((a, b) => b[1].cups - a[1].cups).slice(0, 5);
            let res = '🏆 *المتصدرين في الكؤوس:*\n';
            let mentions = [];
            sortedByCups.forEach(([jid, d], i) => {
                res += `${i + 1}. @${jid.split('@')[0]} 👈 ${d.cups} كأس\n`;
                mentions.push(jid);
            });
            await sock.sendMessage(from, { text: res, mentions });
        }
    });
}

startBot();
