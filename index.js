const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode-terminal');

// 1. إعداد سيرفر Express لمنع إيقاف Railway للبوت
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is active and running 24/7!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server is listening on port ${PORT}`);
});

// 2. إدارة قاعدة البيانات المحلية
const dbPath = path.join(__dirname, 'database.json');
let db = { users: {} };

if (fs.existsSync(dbPath)) {
    try {
        db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    } catch (e) {
        console.error('Error reading database file:', e);
    }
}

function saveDB() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('Error saving database file:', e);
    }
}

function getUser(jid) {
    if (!db.users[jid]) {
        db.users[jid] = { points: 0, trophies: 0 };
        saveDB();
    }
    return db.users[jid];
}

// 3. الاتصال بالواتساب
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // طباعة الـ QR في التيرمينال عند الحاجة
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot Connected Successfully!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg || !msg.message) return;

            if (msg.key.fromMe) return;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                ''
            ).trim();

            if (!text) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = isGroup ? (msg.key.participant || msg.participant) : from;

            console.log(`[MESSAGE] From: ${from} | Sender: ${sender} | Text: ${text}`);

            const args = text.split(/\s+/);
            const command = args[0].toLowerCase();

            // الأوامر العامة
            if (['!help', '!commands', '!menu', '!الاوامر'].includes(command)) {
                const helpText = `📌 *قائمة الأوامر المتاحة:*

• *!help / !الاوامر* - عرض القائمة
• *!mypts / !نقاطي* - عرض نقاطك وكؤوسك
• *!info @user* - عرض بيانات عضو محدد
• *!top / !ترتيب* - قائمة أفضل 10 لاعبين

*أوامر الإدارة:*
• *!point @user [عدد]* - إضافة نقاط
• *!trophy @user [عدد]* - إضافة كؤوس
• *!removepoint @user [عدد]* - خصم نقاط
• *!removetrophy @user [عدد]* - خصم كؤوس
• *!reset @user* - تصفير حساب عضو`;

                await sock.sendMessage(from, { text: helpText }, { quoted: msg });
            }

            // عرض النقاط
            else if (['!mypts', '!points', '!mypoints', '!نقاطي'].includes(command)) {
                const user = getUser(sender);
                const reply = `📊 *بياناتك الشخصية:*\n\n⭐ النقاط: *${user.points}*\n🏆 الكؤوس: *${user.trophies}*`;
                await sock.sendMessage(from, { text: reply }, { quoted: msg });
            }

            // قائمة الترتيب
            else if (['!top', '!leaderboard', '!ترتيب'].includes(command)) {
                const sortedUsers = Object.entries(db.users)
                    .sort((a, b) => (b[1].trophies - a[1].trophies) || (b[1].points - a[1].points))
                    .slice(0, 10);

                if (sortedUsers.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ لا يوجد لاعبون مسجلون حتى الآن.' }, { quoted: msg });
                    return;
                }

                let leaderboardText = '🏆 *قائمة أفضل 10 لاعبين:* \n\n';
                sortedUsers.forEach(([jid, data], index) => {
                    const phone = jid.split('@')[0];
                    leaderboardText += `${index + 1}. @${phone} ➔ 🏆 ${data.trophies} | ⭐ ${data.points}\n`;
                });

                await sock.sendMessage(from, { 
                    text: leaderboardText, 
                    mentions: sortedUsers.map(([jid]) => jid) 
                }, { quoted: msg });
            }

            // إضافة نقاط
            else if (['!point', '!addpoint', '!نقطة'].includes(command)) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) {
                    await sock.sendMessage(from, { text: '⚠️ يرجى عمل تاغ للمستخدم (مثال: !نقطة @user 5)' }, { quoted: msg });
                    return;
                }
                const amount = parseInt(args[2]) || 1;
                const user = getUser(mentioned);
                user.points += amount;
                saveDB();

                await sock.sendMessage(from, { 
                    text: `✅ تم إضافة *${amount}* نقطة للمستخدم @${mentioned.split('@')[0]}.\n⭐ المجموع الحالي: *${user.points}*`,
                    mentions: [mentioned]
                }, { quoted: msg });
            }

            // إضافة كؤوس
            else if (['!trophy', '!givecoupe', '!addtrophy', '!coupe', '!كأس'].includes(command)) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) {
                    await sock.sendMessage(from, { text: '⚠️ يرجى عمل تاغ للمستخدم (مثال: !كأس @user 1)' }, { quoted: msg });
                    return;
                }
                const amount = parseInt(args[2]) || 1;
                const user = getUser(mentioned);
                user.trophies += amount;
                saveDB();

                await sock.sendMessage(from, { 
                    text: `🏆 تم منح *${amount}* كأس للمستخدم @${mentioned.split('@')[0]}.\n🏆 المجموع الحالي: *${user.trophies}*`,
                    mentions: [mentioned]
                }, { quoted: msg });
            }

            // خصم نقاط
            else if (['!removepoint', '!deductpoint', '!خصم_نقطة'].includes(command)) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return;
                const amount = parseInt(args[2]) || 1;
                const user = getUser(mentioned);
                user.points = Math.max(0, user.points - amount);
                saveDB();

                await sock.sendMessage(from, { 
                    text: `📉 تم خصم *${amount}* نقطة من @${mentioned.split('@')[0]}.\n⭐ المجموع الحالي: *${user.points}*`,
                    mentions: [mentioned]
                }, { quoted: msg });
            }

            // خصم كؤوس
            else if (['!removetrophy', '!removecoupe', '!خصم_كأس'].includes(command)) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return;
                const amount = parseInt(args[2]) || 1;
                const user = getUser(mentioned);
                user.trophies = Math.max(0, user.trophies - amount);
                saveDB();

                await sock.sendMessage(from, { 
                    text: `📉 تم خصم *${amount}* كأس من @${mentioned.split('@')[0]}.\n🏆 المجموع الحالي: *${user.trophies}*`,
                    mentions: [mentioned]
                }, { quoted: msg });
            }

            // تصفير حساب
            else if (['!reset', '!تصفير'].includes(command)) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!mentioned) return;
                const user = getUser(mentioned);
                user.points = 0;
                user.trophies = 0;
                saveDB();

                await sock.sendMessage(from, { 
                    text: `إعادت تصفير نقاط وكؤوس @${mentioned.split('@')[0]} بنجاح.`,
                    mentions: [mentioned]
                }, { quoted: msg });
            }

        } catch (error) {
            console.error('[COMMAND ERROR]:', error);
        }
    });
}

connectToWhatsApp();
            
