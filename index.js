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

// Load and initialize database
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
            console.log('WhatsApp Bot Connected Successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            if (!text.startsWith('!')) return;

            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const target = mentioned[0] || sender;
            const targetNum = target.split('@')[0];

            // Extract amount or default to 1
            const amountInput = args.find(a => !a.includes('@') && !isNaN(a));
            const amount = amountInput ? parseInt(amountInput) : 1;

            // --- COMMANDS ---

            if (command === 'help' || command === 'commands' || command === 'menu') {
                const helpMessage = 
`╔══════════════════════╗
║   ⚙️ *BOT COMMAND MENU* ⚙️   
╚══════════════════════╝

📌 *GENERAL COMMANDS*
  • *!mypts* / *!points* 
    └ View your balance
  • *!info* (@user) 
    └ Check a user's stats
  • *!top* / *!leaderboard* 
    └ Show Top 10 players

➕ *ADD POINTS & TROPHIES*
  • *!point* / *!addpoint* (@user) [amount]
    └ Add points
  • *!trophy* / *!addtrophy* / *!givecoupe* (@user) [amount]
    └ Add trophies

➖ *DEDUCT & RESET*
  • *!removepoint* (@user) [amount]
    └ Deduct points
  • *!removetrophy* (@user) [amount]
    └ Deduct trophies
  • *!reset* (@user) 
    └ Reset user stats to zero

═════════════════════════
✨ *Powered by Hamza Store* ✨`;

                await sock.sendMessage(from, { text: helpMessage }, { quoted: msg });
            }

            if (command === 'mypts' || command === 'points' || command === 'mypoints') {
                const u = getUser(sender);
                const ptsMessage = 
`╭─── Archives Stats ───╮
│ 👤 *Player:* @${sender.split('@')[0]}
│ 
│ ⭐ *Points:* ${u.points}
│ 🏆 *Trophies:* ${u.trophies}
╰─────────────────────╯`;

                await sock.sendMessage(from, { text: ptsMessage, mentions: [sender] }, { quoted: msg });
            }

            if (command === 'info' || command === 'userinfo') {
                const u = getUser(target);
                const infoMessage = 
`╭─── Player Profile ───╮
│ 🎮 *Target:* @${targetNum}
│ 
│ ⭐ *Points:* ${u.points}
│ 🏆 *Trophies:* ${u.trophies}
╰─────────────────────╯`;

                await sock.sendMessage(from, { text: infoMessage, mentions: [target] }, { quoted: msg });
            }

            if (command === 'top' || command === 'leaderboard') {
                const sorted = Object.entries(db.users)
                    .sort((a, b) => (b[1].trophies * 100 + b[1].points) - (a[1].trophies * 100 + a[1].points))
                    .slice(0, 10);

                if (sorted.length === 0) {
                    await sock.sendMessage(from, { text: `⚠️ No user data recorded yet.` }, { quoted: msg });
                    return;
                }

                let leaderboardMsg = `🏆 *TOP 10 LEADERBOARD* 🏆\n\n`;
                const mentionsArr = [];

                const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

                sorted.forEach(([id, data], index) => {
                    const num = id.split('@')[0];
                    const medal = medals[index] || '👤';
                    leaderboardMsg += `${medal} *@${num}*\n   └ 🏆 Trophies: *${data.trophies}* | ⭐ Points: *${data.points}*\n\n`;
                    mentionsArr.push(id);
                });

                leaderboardMsg += `═════════════════════════`;

                await sock.sendMessage(from, { text: leaderboardMsg, mentions: mentionsArr }, { quoted: msg });
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

            if (command === 'removepoint' || command === 'deductpoint') {
                const u = getUser(target);
                u.points = Math.max(0, u.points - amount);
                saveDB();
                await sock.sendMessage(from, { 
                    text: `📉 Deducted *-${amount}* Point(s) from @${targetNum}!\n\n⭐ Remaining Points: *${u.points}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'removetrophy' || command === 'removecoupe') {
                const u = getUser(target);
                u.trophies = Math.max(0, u.trophies - amount);
                saveDB();
                await sock.sendMessage(from, { 
                    text: `📉 Deducted *-${amount}* Trophy(ies) from @${targetNum}!\n\n🏆 Remaining Trophies: *${u.trophies}*`,
                    mentions: [target]
                }, { quoted: msg });
            }

            if (command === 'reset') {
                if (db.users[target]) {
                    db.users[target] = { points: 0, trophies: 0 };
                    saveDB();
                    await sock.sendMessage(from, { 
                        text: `🔄 Successfully reset points and trophies for @${targetNum} to zero.`,
                        mentions: [target]
                    }, { quoted: msg });
                }
            }

        } catch (err) {
            console.error('Error handling command:', err);
        }
    });
}

connectToWhatsApp();
                    
