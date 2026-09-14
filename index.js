const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const fs = require('fs');

const phoneNumber = "212710530141"; 
const authFolder = 'auth_info_baileys';

// إدارة قاعدة البيانات
const dbFile = './database.json';
let db = { users: {} };
if (fs.existsSync(dbFile)) {
    try { db = JSON.parse(fs.readFileSync(dbFile)); } catch (e) { db = { users: {} }; }
} else {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function saveDB() {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Chrome")
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================\n PAIRING CODE: ${code} \n========================================\n`);
            } catch (err) {
                console.error("خطأ أثناء طلب الرمز:", err?.message || err);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('توقف الاتصال، رمز الحالة:', statusCode);
            
            // في حال وجود خلل بالجلسة السابقة يتم إنشاؤها من جديد
            if (statusCode === 401 || statusCode === 428) {
                if (fs.existsSync(authFolder)) {
                    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
                }
            }
            setTimeout(connectToWhatsApp, 5000);
        } else if (connection === 'open') {
            console.log('تم الاتصال بالواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            if (!text.startsWith('!')) return;

            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (!db.users[sender]) db.users[sender] = { points: 0, trophies: 0 };

            if (command === 'help' || command === 'الاوامر') {
                await sock.sendMessage(from, { 
                    text: `🏆 *أوامر البوت* 🏆\n\n• *!نقاطي*\n• *!كأس*\n• *!نقطة*`
                });
            }

            if (command === 'نقاطي' || command === 'points') {
                await sock.sendMessage(from, { 
                    text: `👤 *رصيدك:* النقاط: ${db.users[sender].points} | الكؤوس: ${db.users[sender].trophies}` 
                }, { quoted: msg });
            }

            if (command === 'نقطة' || command === 'addpoint') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
                if (!db.users[target]) db.users[target] = { points: 0, trophies: 0 };
                db.users[target].points += 1;
                saveDB();
                await sock.sendMessage(from, { text: `✅ تمت إضافة نقطة!` });
            }

            if (command === 'كأس' || command === 'addtrophy') {
                const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
                if (!db.users[target]) db.users[target] = { points: 0, trophies: 0 };
                db.users[target].trophies += 1;
                saveDB();
                await sock.sendMessage(from, { text: `🏆 تم إعطاء كأس!` });
            }
        } catch (err) {
            console.error('خطأ:', err);
        }
    });
}

connectToWhatsApp();
                    
