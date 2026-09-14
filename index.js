const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

// رقم الهاتف بصيغة دولية بدون + أو مسافات
const phoneNumber = "212771007810"; 

// إدارة قاعدة البيانات المحلية (database.json)
const dbFile = './database.json';
let db = { users: {} };

if (fs.existsSync(dbFile)) {
    try {
        db = JSON.parse(fs.readFileSync(dbFile));
    } catch (e) {
        db = { users: {} };
    }
} else {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function saveDB() {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // إيقاف QR code
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // طلب رمز الاقتران تلقائياً في حال عدم وجود جلسة مسجلة
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n========================================\n PAIRING CODE: ${code} \n========================================\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('جاري إعادة الاتصال...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('تم الاتصال بالواتساب بنجاح!');
        }
    });

    // معالجة الرسائل والأوامر
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = msg.key.participant || msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            if (!text.startsWith('!')) return;

            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // إعداد بيانات المستخدم في قاعدة البيانات
            if (!db.users[sender]) {
                db.users[sender] = { points: 0, trophies: 0 };
            }

            // أمر المساعدة والتعريف
            if (command === 'help' || command === 'الاوامر') {
                await sock.sendMessage(from, { 
                    text: `🏆 *أوامر البوت* 🏆\n\n` +
                          `• *!نقاطي* : لعرض رصيدك من النقاط والكؤوس\n` +
                          `• *!كأس* : لإضافة كأس للمستخدم\n` +
                          `• *!نقطة* : لإضافة نقاط للمستخدم\n` +
                          `• *!ترتيب* : لعرض قائمة المتصدرين`
                });
            }

            // أمر عرض النقاط
            if (command === 'نقاطي' || command === 'points') {
                const userPoints = db.users[sender].points;
                const userTrophies = db.users[sender].trophies;
                await sock.sendMessage(from, { 
                    text: `👤 *رصيدك الحالي:*\n\n⭐ النقاط: ${userPoints}\n🏆 الكؤوس: ${userTrophies}` 
                }, { quoted: msg });
            }

            // أمر إضافة نقاط
            if (command === 'نقطة' || command === 'addpoint') {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const target = mentioned[0] || sender;

                if (!db.users[target]) db.users[target] = { points: 0, trophies: 0 };
                db.users[target].points += 1;
                saveDB();

                await sock.sendMessage(from, { 
                    text: `✅ تمت إضافة +1 نقطة للمستخدم! مجموع نقاطه الآن: ${db.users[target].points}` 
                });
            }

            // أمر إضافة كأس
            if (command === 'كأس' || command === 'addtrophy') {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const target = mentioned[0] || sender;

                if (!db.users[target]) db.users[target] = { points: 0, trophies: 0 };
                db.users[target].trophies += 1;
                saveDB();

                await sock.sendMessage(from, { 
                    text: `🏆 تم منح كأس جديد للمستخدم! مجموع كؤوسه الآن: ${db.users[target].trophies}` 
                });
            }

        } catch (err) {
            console.error('خطأ أثناء معالجة الرسالة:', err);
        }
    });
}

connectToWhatsApp();
          
