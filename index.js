const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const fs = require('fs');

const authFolder = 'auth_info_baileys';
const dbFile = './database.json';

// تحميل وتحديث قاعدة البيانات
let db = { users: {} };
if (fs.existsSync(dbFile)) {
    try { db = JSON.parse(fs.readFileSync(dbFile)); } catch (e) { db = { users: {} }; }
} else {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function saveDB() {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function getUser(id) {
    if (!db.users[id]) {
        db.users[id] = { points: 0, trophies: 0 };
    }
    return db.users[id];
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

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 3000);
            }
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

            // استخراج العضو المشار إليه (Mentioned) أو صاحب الرسالة
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const target = mentioned[0] || sender;
            const targetNum = target.split('@')[0];

            // استخراج العدد المحدد في الأمر إن وجد (مثل !نقطة @user 5)
            const amountInput = args.find(a => !a.includes('@'));
            const amount = parseInt(amountInput) && parseInt(amountInput) > 0 ? parseInt(amountInput) : 1;

            // --- الأوامر العامة ---

            if (command === 'help' || command === 'الاوامر' || command === 'أوامر') {
                await sock.sendMessage(from, { 
                    text: `🏆 *قائمة أوامر البوت الشاملة* 🏆\n\n` +
                          `📌 *عرض البيانات:*\n` +
                          `• *!نقاطي* : عرض رصيدك الشخصي\n` +
                          `• *!معلومات* / *!info* (@عضو) : عرض رصيد عضو آخر\n` +
                          `• *!ترتيب* / *!top* : عرض ترتيب أفضل 10 مشاركين\n\n` +
                          `➕ *إضافة النقاط والكؤوس:*\n` +
                          `• *!نقطة* / *!point* (@عضو) (العدد)\n` +
                          `• *!كأس* / *!coupe* / *!givecoupe* (@عضو) (العدد)\n\n` +
                          `➖ *الخصم وإعادة الضبط:*\n` +
                          `• *!خصم_نقطة* (@عضو) (العدد)\n` +
                          `• *!خصم_كأس* (@عضو) (العدد)\n` +
                          `• *!تصفير* (@عضو) : إعادة ضبط النقاط لعضو محدد`
                }, { quoted: msg });
            }

            if (command === 'نقاطي' || command === 'points') {
                const u = getUser(sender);
                await sock.sendMessage(from, { 
                    text: `👤 *رصيدك الحالي:*\n⭐ النقاط: *${u.points}*\n🏆 الكؤوس: *${u.trophies}*` 
                }, { quoted: msg });
            }

            if (command === 'معلومات' || command === 'info' || command === 'enfo') {
                const u = getUser(target);
                await sock.sendMessage(from, { 
                    text: `📊 *بيانات المستخدم* (@${targetNum}):\n⭐ النقاط: *${u.points}*\n🏆 الكؤوس: *${u.trophies}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'ترتيب' || command === 'top') {
                const sorted = Object.entries(db.users)
                    .sort((a, b) => (b[1].trophies * 100 + b[1].points) - (a[1].trophies * 100 + a[1].points))
                    .slice(0, 10);

                if (sorted.length === 0) {
                    await sock.sendMessage(from, { text: `لا توجد بيانات مسجلة بعد.` }, { quoted: msg });
                    return;
                }

                let leaderBoard = `🏅 *قائمة أفضل 10 متصدرين* 🏅\n\n`;
                const mentionsArr = [];

                sorted.forEach(([id, data], index) => {
                    const num = id.split('@')[0];
                    leaderBoard += `${index + 1}. @${num} ⬅️ 🏆 *${data.trophies}* | ⭐ *${data.points}*\n`;
                    mentionsArr.push(id);
                });

                await sock.sendMessage(from, { text: leaderBoard, mentions: mentionsArr }, { quoted: msg });
            }

            // --- أوامر الإضافة والخصم ---

            if (command === 'نقطة' || command === 'point' || command === 'addpoint') {
                const u = getUser(target);
                u.points += amount;
                saveDB();
                await sock.sendMessage(from, { 
                    text: `✅ تمت إضافة +${amount} نقطة لـ @${targetNum}!\nمجموع النقاط: *${u.points}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'كأس' || command === 'coupe' || command === 'givecoupe' || command === 'addtrophy') {
                const u = getUser(target);
                u.trophies += amount;
                saveDB();
                await sock.sendMessage(from, { 
                    text: `🏆 تم منح +${amount} كأس لـ @${targetNum}!\nمجموع الكؤوس: *${u.trophies}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'خصم_نقطة' || command === 'removepoint') {
                const u = getUser(target);
                u.points = Math.max(0, u.points - amount);
                saveDB();
                await sock.sendMessage(from, { 
                    text: `📉 تم خصم -${amount} نقطة من @${targetNum}!\nالمتبقي: *${u.points}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'خصم_كأس' || command === 'removecoupe') {
                const u = getUser(target);
                u.trophies = Math.max(0, u.trophies - amount);
                saveDB();
                await sock.sendMessage(from, { 
                    text: `📉 تم خصم -${amount} كأس من @${targetNum}!\nالمتبقي: *${u.trophies}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'تصفير' || command === 'reset') {
                if (db.users[target]) {
                    db.users[target] = { points: 0, trophies: 0 };
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `🔄 تم إعادة ضبط نقاط وكؤوس @${targetNum} إلى الصفر.`,
                        mentions: [target]
                    }, { quoted: msg });
                }
            }

        } catch (err) {
            console.error('خطأ في معالجة الأمر:', err);
        }
    });
}

connectToWhatsApp();
