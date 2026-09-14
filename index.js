const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const fs = require('fs');

// --- 1. خادم الويب الخاص بـ Railway ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('WhatsApp Bot is Online & Healthy');
});

// الاستجابة لاختبار الصحة الخاصة بـ Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Express Server is running on port ${PORT}`);
});

// --- 2. إدارة قاعدة البيانات المحلية ---
const authFolder = 'auth_info_baileys';
const dbFile = './database.json';

let db = { users: {} };

function loadDB() {
    try {
        if (fs.existsSync(dbFile)) {
            const rawData = fs.readFileSync(dbFile, 'utf8');
            db = JSON.parse(rawData);
        } else {
            saveDB();
        }
    } catch (e) {
        console.error("[DB ERROR] Error loading database:", e.message);
        db = { users: {} };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error("[DB ERROR] Error saving database:", e.message);
    }
}

function getUser(id) {
    if (!db.users[id]) {
        db.users[id] = { points: 0, trophies: 0 };
    }
    return db.users[id];
}

loadDB();

// --- 3. اتصال Baileys الواتساب ---
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            printQRInTerminal: true,
            auth: state,
            browser: Browsers.ubuntu("Chrome")
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`[BOT] Connection closed. Code: ${statusCode}`);
                if (statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                console.log('[BOT] WhatsApp Connected Successfully!');
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg || !msg.message || msg.key.fromMe) return;

                const from = msg.key.remoteJid;
                const sender = msg.key.participant || msg.key.remoteJid;
                
                // الحصول على نص الرسالة بأمان
                const text = msg.message.conversation || 
                             msg.message.extendedTextMessage?.text || 
                             "";

                if (!text.startsWith('!')) return;

                const args = text.slice(1).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const target = mentioned[0] || sender;
                const targetNum = target.split('@')[0];

                const amountInput = args.find(a => !a.includes('@') && !isNaN(a));
                const amount = amountInput ? parseInt(amountInput) : 1;

                // --- الأوامر ---

                if (command === 'help' || command === 'commands' || command === 'menu' || command === 'الاوامر') {
                    let menuText = "╔══════════════════════╗\n";
                    menuText += "║   ⚙️ *BOT COMMAND MENU* ⚙️   \n";
                    menuText += "╚══════════════════════╝\n\n";
                    menuText += "📌 *GENERAL COMMANDS*\n";
                    menuText += "  • *!mypts* / *!points*\n";
                    menuText += "  • *!info* (@user)\n";
                    menuText += "  • *!top* / *!leaderboard*\n\n";
                    menuText += "➕ *ADD POINTS & TROPHIES*\n";
                    menuText += "  • *!point* (@user) [amount]\n";
                    menuText += "  • *!trophy* / *!givecoupe* (@user) [amount]\n\n";
                    menuText += "➖ *DEDUCT & RESET*\n";
                    menuText += "  • *!removepoint* (@user) [amount]\n";
                    menuText += "  • *!removetrophy* (@user) [amount]\n";
                    menuText += "  • *!reset* (@user)\n\n";
                    menuText += "═════════════════════════";

                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }

                if (command === 'mypts' || command === 'points' || command === 'mypoints' || command === 'نقاطي') {
                    const u = getUser(sender);
                    let ptsText = "╭─── Archives Stats ───╮\n";
                    ptsText += `│ 👤 *Player:* @${sender.split('@')[0]}\n│ \n`;
                    ptsText += `│ ⭐ *Points:* ${u.points}\n`;
                    ptsText += `│ 🏆 *Trophies:* ${u.trophies}\n`;
                    ptsText += "╰─────────────────────╯";

                    await sock.sendMessage(from, { text: ptsText, mentions: [sender] }, { quoted: msg });
                }

                if (command === 'info' || command === 'userinfo' || command === 'معلومات') {
                    const u = getUser(target);
                    let infoText = "╭─── Player Profile ───╮\n";
                    infoText += `│ 🎮 *Target:* @${targetNum}\n│ \n`;
                    infoText += `│ ⭐ *Points:* ${u.points}\n`;
                    infoText += `│ 🏆 *Trophies:* ${u.trophies}\n`;
                    infoText += "╰─────────────────────╯";

                    await sock.sendMessage(from, { text: infoText, mentions: [target] }, { quoted: msg });
                }

                if (command === 'top' || command === 'leaderboard' || command === 'ترتيب') {
                    const sorted = Object.entries(db.users)
                        .sort((a, b) => (b[1].trophies * 100 + b[1].points) - (a[1].trophies * 100 + a[1].points))
                        .slice(0, 10);

                    if (sorted.length === 0) {
                        await sock.sendMessage(from, { text: "⚠️ No user data recorded yet." }, { quoted: msg });
                        return;
                    }

                    let lbMsg = "🏆 *TOP 10 LEADERBOARD* 🏆\n\n";
                    const mentionsArr = [];
                    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

                    sorted.forEach(([id, data], index) => {
                        const num = id.split('@')[0];
                        const medal = medals[index] || '👤';
                        lbMsg += `${medal} *@${num}*\n   └ 🏆 Trophies: *${data.trophies}* | ⭐ Points: *${data.points}*\n\n`;
                        mentionsArr.push(id);
                    });

                    lbMsg += "═════════════════════════";

                    await sock.sendMessage(from, { text: lbMsg, mentions: mentionsArr }, { quoted: msg });
                }

                if (command === 'point' || command === 'addpoint' || command === 'نقطة') {
                    const u = getUser(target);
                    u.points += amount;
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `✅ Added *+${amount}* Point(s) to @${targetNum}!\n\n⭐ Total Points: *${u.points}*`,
                        mentions: [target]
                    }, { quoted: msg });
                }

                if (command === 'trophy' || command === 'givecoupe' || command === 'addtrophy' || command === 'coupe' || command === 'كأس') {
                    const u = getUser(target);
                    u.trophies += amount;
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `🏆 Awarded *+${amount}* Trophy(ies) to @${targetNum}!\n\n🏆 Total Trophies: *${u.trophies}*`,
                        mentions: [target]
                    }, { quoted: msg });
                }

                if (command === 'removepoint' || command === 'deductpoint' || command === 'خصم_نقطة') {
                    const u = getUser(target);
                    u.points = Math.max(0, u.points - amount);
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `📉 Deducted *-${amount}* Point(s) from @${targetNum}!\n\n⭐ Remaining Points: *${u.points}*`,
                        mentions: [target]
                    }, { quoted: msg });
                }

                if (command === 'removetrophy' || command === 'removecoupe' || command === 'خصم_كأس') {
                    const u = getUser(target);
                    u.trophies = Math.max(0, u.trophies - amount);
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `📉 Deducted *-${amount}* Trophy(ies) from @${targetNum}!\n\n🏆 Remaining Trophies: *${u.trophies}*`,
                        mentions: [target]
                    }, { quoted: msg });
                }

                if (command === 'reset' || command === 'تصفير') {
                    if (db.users[target]) {
                        db.users[target] = { points: 0, trophies: 0 };
                        saveDB();
                        await sock.sendMessage(from, { 
                            text: `🔄 Successfully reset stats for @${targetNum} to zero.`,
                            mentions: [target]
                        }, { quoted: msg });
                    }
                }

            } catch (cmdErr) {
                console.error('[COMMAND ERROR] Error executing command:', cmdErr);
            }
        });

    } catch (err) {
        console.error('[FATAL ERROR] Failed to start WhatsApp:', err);
        setTimeout(connectToWhatsApp, 5000);
    }
}

connectToWhatsApp();
                            
