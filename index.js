const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const DB_FILE = './database.json';

// تحميل وتوفير قاعدة البيانات
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUserData(db, jid) {
  if (!db.users[jid]) {
    db.users[jid] = { points: 0, gold: 0, diamond: 0, bronze: 0 };
  }
  return db.users[jid];
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('--- QR CODE ---');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot Connected Successfully!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) return;

    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!body.startsWith('!')) return;

    const args = body.trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const sender = msg.key.participant || msg.participant;

    const groupMetadata = await sock.groupMetadata(from);
    const participants = groupMetadata.participants;
    const admins = participants.filter((p) => p.admin !== null).map((p) => p.id);
    const isAdmin = admins.includes(sender);

    const db = loadDB();

    if (command === '!info') {
      const infoText = 
`✨ *━━━━━━[ BOT INFO ]━━━━━━* ✨

👤 *صاحب البوت:* dev_hamza
📞 *Num:* 0710530141

✨ *━━━━━━━━━━━━━━━━━━* ✨`;
      await sock.sendMessage(from, { text: infoText }, { quoted: msg });
    }

    if (command === '!givepoints') {
      if (!isAdmin) return sock.sendMessage(from, { text: '❌ هذا الأمر خاص بالأدمن فقط!' }, { quoted: msg });

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const amount = parseInt(args[0]) || parseInt(args[1]);

      if (!mentioned || isNaN(amount)) {
        return sock.sendMessage(from, { text: '⚠️ الاستخدام الصحيح: `!givepoints [العدد] @منشن`' }, { quoted: msg });
      }

      const userData = getUserData(db, mentioned);
      userData.points += amount;
      saveDB(db);

      const successMsg = 
`✅ *تم إضافة النقاط بنجاح!*

👤 *المستخدم:* @${mentioned.split('@')[0]}
➕ *النقاط المضافة:* +${amount}
💰 *إجمالي النقاط الآن:* ${userData.points}`;

      await sock.sendMessage(from, { text: successMsg, mentions: [mentioned] }, { quoted: msg });
    }

    if (command === '!givecoupe') {
      if (!isAdmin) return sock.sendMessage(from, { text: '❌ هذا الأمر خاص بالأدمن فقط!' }, { quoted: msg });

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const type = args[0]?.toLowerCase();

      if (!mentioned || !['gold', 'diamond', 'bronze'].includes(type)) {
        const usageMsg = 
`🏆 *اختر الكأس المراد منحه:*

1️⃣ \`!givecoupe gold @منشن\` ➔ 🏆 *كأس ذهبي*
2️⃣ \`!givecoupe diamond @منشن\` ➔ 🔷 *كأس الماسي*
3️⃣ \`!givecoupe bronze @منشن\` ➔ 🥈 *كأس برونزي*`;
        return sock.sendMessage(from, { text: usageMsg }, { quoted: msg });
      }

      const userData = getUserData(db, mentioned);
      let cupName = '';

      if (type === 'gold') {
        userData.gold += 1;
        cupName = '🏆 ذهبي';
      } else if (type === 'diamond') {
        userData.diamond += 1;
        cupName = '🔷 الماسي';
      } else if (type === 'bronze') {
        userData.bronze += 1;
        cupName = '🥈 برونزي';
      }

      saveDB(db);

      const successCupMsg = 
`🎉 *تم إعطاء الكأس بنجاح!*

👤 *المستلم:* @${mentioned.split('@')[0]}
🏆 *نوع الكأس:* ${cupName}`;

      await sock.sendMessage(from, { text: successCupMsg, mentions: [mentioned] }, { quoted: msg });
    }

    if (command === '!points') {
      const sortedUsers = Object.entries(db.users)
        .sort((a, b) => b[1].points - a[1].points);

      if (sortedUsers.length === 0) {
        return sock.sendMessage(from, { text: '📊 لا توجد نقاط مسجلة بعد في المجموعة.' }, { quoted: msg });
      }

      let leaderboard = `📊 *━━━━[ لائحة ترتيب النقاط ]━━━━* 📊\n\n`;
      let mentionsList = [];

      sortedUsers.forEach(([jid, data], index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
        leaderboard += `${medal} *#${index + 1}* - @${jid.split('@')[0]}\n┗ 💰 النقاط: *${data.points}*\n\n`;
        mentionsList.push(jid);
      });

      leaderboard += `✨ *━━━━━━━━━━━━━━━━━━━━━━* ✨`;

      await sock.sendMessage(from, { text: leaderboard, mentions: mentionsList }, { quoted: msg });
    }

    if (command === '!coups' || command === '!couppes') {
      const sortedUsers = Object.entries(db.users)
        .map(([jid, data]) => ({
          jid,
          totalCups: data.gold + data.diamond + data.bronze,
          ...data
        }))
        .filter(u => u.totalCups > 0)
        .sort((a, b) => b.totalCups - a.totalCups);

      if (sortedUsers.length === 0) {
        return sock.sendMessage(from, { text: '🏆 لا توجد كؤوس مسجلة لأي شخص بعد.' }, { quoted: msg });
      }

      let cupBoard = `🏆 *━━━━[ قائمة أصحاب الكؤوس ]━━━━* 🏆\n\n`;
      let mentionsList = [];

      sortedUsers.forEach((user, index) => {
        cupBoard += `🏅 *#${index + 1}* @${user.jid.split('@')[0]}\n`;
        cupBoard += ` ┣ 🏆 ذهبي (GOLD): *${user.gold}*\n`;
        cupBoard += ` ┣ 🔷 الماسي (DIAMOND): *${user.diamond}*\n`;
        cupBoard += ` ┗ 🥈 برونزي (BRONZE): *${user.bronze}*\n\n`;
        mentionsList.push(user.jid);
      });

      cupBoard += `✨ *━━━━━━━━━━━━━━━━━━━━━━* ✨`;

      await sock.sendMessage(from, { text: cupBoard, mentions: mentionsList }, { quoted: msg });
    }

    if (command === '!ban') {
      if (!isAdmin) return sock.sendMessage(from, { text: '❌ هذا الأمر خاص بالأدمن فقط!' }, { quoted: msg });

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!mentioned) {
        return sock.sendMessage(from, { text: '⚠️ المرجو منشن الشخص المراد طرده: `!ban @منشن`' }, { quoted: msg });
      }

      try {
        await sock.groupParticipantsUpdate(from, [mentioned], 'remove');
        await sock.sendMessage(from, { text: `🚫 تم طرد العضو @${mentioned.split('@')[0]} بنجاح من المجموعة.`, mentions: [mentioned] }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ فشل طرد العضو. تأكد أن البوت يملك صلاحية الأدمن!' }, { quoted: msg });
      }
    }

    if (command === '!unban') {
      if (!isAdmin) return sock.sendMessage(from, { text: '❌ هذا الأمر خاص بالأدمن فقط!' }, { quoted: msg });

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      if (!mentioned) {
        return sock.sendMessage(from, { text: '⚠️ المرجو منشن الشخص لإلغاء الحظر عنه: `!unban @منشن`' }, { quoted: msg });
      }

      try {
        await sock.groupParticipantsUpdate(from, [mentioned], 'add');
        await sock.sendMessage(from, { text: `✅ تم إعادة إدخال العضو @${mentioned.split('@')[0]} إلى المجموعة.`, mentions: [mentioned] }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ فشل إضافة العضو. قد تكون إعدادات الخصوصية لدى العضو تمنع إضافته أوتوماتيكياً.' }, { quoted: msg });
      }
    }
  });
}

startBot();
    
