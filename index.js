const express = require("express");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");

const app = express();
app.use(express.json({ limit: "32kb" }));

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const API_KEY = process.env.API_KEY;
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

if (!API_KEY || API_KEY === "CHANGE_ME_TO_A_LONG_RANDOM_SECRET") {
  console.error("Set a private API_KEY in .env before starting.");
  process.exit(1);
}

const clients = new Map();
const commands = [];
let commandCounter = 0;
let latestProgressPercent = 0;
let isSequenceRunning = false;

const triggerHistory = [];

function now() {
  return Date.now();
}

function getISTTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function createCommand(target) {
  const command = {
    id: ++commandCounter,
    target: target === 2 ? 2 : 1,
    createdAt: now(),
    acknowledgements: new Map()
  };

  commands.unshift(command);
  if (commands.length > 100) commands.pop();
  return command;
}

function authenticate(req, res, next) {
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

function pruneClients() {
  const cutoff = now() - 30000;
  for (const [id, client] of clients) {
    if (client.lastSeen < cutoff) clients.delete(id);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAndCheckProgress() {
  try {
    const res = await axios.get("https://api.solanafatboys.com/api/rain/state");
    const percent = res.data?.triggerProgressPercent;

    if (typeof percent === "number" && percent !== latestProgressPercent) {
      console.log(`[RAIN STATE] Trigger progress updated: ${latestProgressPercent}% -> ${percent}%`);
      latestProgressPercent = percent;

      if (percent === 99 && !isSequenceRunning) {
        runAutoSequence();
      }
    }
  } catch (err) {
    // Silently ignore network glitches
  }
}

async function runAutoSequence() {
  if (isSequenceRunning) return;
  isSequenceRunning = true;

  const startTimeMs = now();
  const startTimeStr = getISTTime(startTimeMs);
  let repeatLoopsCount = 0;

  console.log(`🚀 Starting 99% automated click sequence at ${startTimeStr} IST`);

  try {
    createCommand(1);
    console.log("Clicked Button 1 (at 99%)");

    await wait(40000);

    createCommand(2);
    console.log("Clicked Button 2 (after 40s)");

    while (latestProgressPercent === 99) {
      await wait(5000);
      if (latestProgressPercent !== 99) break;

      createCommand(1);
      await wait(3000);
      if (latestProgressPercent !== 99) break;

      createCommand(2);
      await wait(25000);
      if (latestProgressPercent !== 99) break;

      createCommand(1);
      await wait(3000);
      if (latestProgressPercent !== 99) break;

      createCommand(2);
      repeatLoopsCount++;

      await wait(25000);
    }
  } catch (err) {
    console.error("Error in automation sequence:", err);
  }

  console.log("🛑 Progress dropped from 99%. Executing shutdown confirmation clicks on Button 2...");
  
  createCommand(2);
  await wait(5000);
  createCommand(2);
  await wait(5000);
  createCommand(2);

  const stopTimeMs = now();
  const stopTimeStr = getISTTime(stopTimeMs);
  const durationSec = Math.floor((stopTimeMs - startTimeMs) / 1000);
  const durationMins = Math.floor(durationSec / 60);
  const remainingSec = durationSec % 60;
  const durationFormatted = `${durationMins}m ${remainingSec}s`;

  triggerHistory.unshift({
    startTime: startTimeStr,
    stopTime: stopTimeStr,
    duration: durationFormatted,
    loops: repeatLoopsCount,
    details: `Hit 99% at ${startTimeStr}, did 40s initial sequence, repeated loop ${repeatLoopsCount} times, stopped at ${stopTimeStr}`
  });

  if (triggerHistory.length > 5) {
    triggerHistory.pop();
  }

  isSequenceRunning = false;
}

// Background poller for Solana Fat Boys rain state API (every 5 seconds)
setInterval(fetchAndCheckProgress, 5000);

app.get("/", (req, res) => {
  res.type("text/plain").send("Shockwave Discord API is running.");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "shockwave-discord-bot" });
});

app.get("/shockwave-clicker.user.js", (req, res) => {
  const file = path.join(__dirname, "shockwave-clicker.user.js");
  if (!fs.existsSync(file)) return res.status(404).send("Script not found.");
  res.type("application/javascript; charset=utf-8");
  res.sendFile(file);
});

app.post("/api/shockwave/register", authenticate, (req, res) => {
  const requestedId = typeof req.body?.clientId === "string"
    ? req.body.clientId.trim()
    : "";

  const clientId = requestedId || `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

  clients.set(clientId, {
    clientId,
    connectedAt: now(),
    lastSeen: now(),
    userAgent: req.get("user-agent") || "unknown"
  });

  console.log(`[DEBUG] Client registered: ${clientId} (Total active: ${clients.size})`);
  res.json({ ok: true, clientId });
});

app.post("/api/shockwave/heartbeat", authenticate, (req, res) => {
  const clientId = req.body?.clientId;
  const record = clients.get(clientId);

  if (!record) {
    console.log(`[DEBUG] Heartbeat rejected: Client ID ${clientId} not found in active map.`);
    return res.status(404).json({ ok: false, error: "Client not registered" });
  }

  record.lastSeen = now();
  res.json({ ok: true });
});

app.get("/api/shockwave", authenticate, (req, res) => {
  const clientId = req.query.clientId;
  const after = Number(req.query.after || 0);

  if (clientId && clients.has(clientId)) {
    clients.get(clientId).lastSeen = now();
  }

  const command = commands.find(c => c.id > after);

  res.json({
    ok: true,
    progressPercent: latestProgressPercent,
    command: command
      ? { id: command.id, target: command.target, createdAt: command.createdAt }
      : null
  });
});

app.post("/api/shockwave/ack", authenticate, (req, res) => {
  const clientId = req.body?.clientId;
  const commandId = Number(req.body?.commandId);
  const command = commands.find(c => c.id === commandId);

  if (!command) {
    console.log(`[DEBUG] ACK failed: Command ID ${commandId} not found.`);
    return res.status(404).json({ ok: false, error: "Command not found" });
  }

  const success = Boolean(req.body?.success);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;

  command.acknowledgements.set(clientId || "unknown", {
    success,
    reason,
    timestamp: now()
  });

  if (success) {
    console.log(`[DEBUG] ✅ Client ${clientId} successfully executed Command #${commandId} (Target ${command.target})`);
  } else {
    console.log(`[DEBUG] ❌ Client ${clientId} FAILED Command #${commandId}. Reason: ${reason}`);
  }

  if (clientId && clients.has(clientId)) {
    clients.get(clientId).lastSeen = now();
  }

  res.json({ ok: true });
});

app.get("/api/shockwave/status", authenticate, (req, res) => {
  pruneClients();

  res.json({
    ok: true,
    clients: clients.size,
    clientsList: [...clients.values()].map(c => ({
      clientId: c.clientId,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen
    }))
  });
});

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

discord.once("ready", () => {
  console.log(`Discord: logged in as ${discord.user.tag}`);
  console.log(`Application ID: ${APPLICATION_ID || "(not set)"}`);
  console.log(`HTTP API: port ${process.env.SERVER_PORT || process.env.PORT || 3000}`);
  console.log(`Script URL: ${PUBLIC_URL ? `${PUBLIC_URL}/shockwave-clicker.user.js` : "(set PUBLIC_URL first)"}`);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on("line", async (line) => {
  const input = line.trim().toLowerCase();

  if (input === "!status") {
    pruneClients();
    console.log(`[CONSOLE STATUS] Active clients: ${clients.size}`);
    for (const [id, c] of clients) {
      console.log(` - Client ID: ${id} | Last Seen: ${Math.floor((now() - c.lastSeen) / 1000)}s ago`);
    }
  }
});

function buildPanelPayload() {
  const scriptUrl = PUBLIC_URL
    ? `${PUBLIC_URL}/shockwave-clicker.user.js`
    : "https://YOUR_PUBLIC_HOST_URL/shockwave-clicker.user.js";

  const installUrl =
    `https://www.tampermonkey.net/script_installation.php#url=${encodeURIComponent(scriptUrl)}`;

  const embed = new EmbedBuilder()
    .setTitle("⚡ Shockwave Control")
    .setDescription(
      "Remote click control panel.\n\n" +
      `📊 **Trigger Progress:** ${latestProgressPercent}%\n` +
      `🔄 **Auto Sequence Status:** ${isSequenceRunning ? "🟢 Running Active Sequence" : "⚪ Standby"}`
    )
    .setColor(0x5865F2)
    .setFooter({ text: "Shockwave Remote Control" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("shockwave_click_1")
      .setLabel("Click Button 1")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("shockwave_click_2")
      .setLabel("Click Button 2")
      .setEmoji("🔵")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("shockwave_refresh")
      .setLabel("Refresh Stats")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("shockwave_history")
      .setLabel("Last 5 Triggers")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Get Script")
      .setStyle(ButtonStyle.Link)
      .setURL(installUrl)
  );

  return { embeds: [embed], components: [row1, row2] };
}

discord.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.content.trim() !== "!panel") return;

  await message.channel.send(buildPanelPayload());
});

discord.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "shockwave_refresh") {
    await fetchAndCheckProgress();
    return interaction.update(buildPanelPayload());
  }

  if (interaction.customId === "shockwave_history") {
    let historyText = "No history recorded yet for the last 5 triggers.";
    if (triggerHistory.length > 0) {
      historyText = triggerHistory.map((h, i) => 
        `**#${i+1}**\n• Start (IST): \`${h.startTime}\`\n• Stop (IST): \`${h.stopTime}\`\n• Duration: \`${h.duration}\`\n• Loops Completed: **${h.loops}**\n• Details: *${h.details}*`
      ).join("\n\n");
    }

    return interaction.reply({
      content: `📜 **Last 5 Trigger History Logs:**\n\n${historyText}`,
      ephemeral: true
    });
  }

  const target =
    interaction.customId === "shockwave_click_1" ? 1 :
    interaction.customId === "shockwave_click_2" ? 2 :
    null;

  if (!target) return;

  await interaction.deferReply({ ephemeral: true });

  pruneClients();

  const onlineBefore = clients.size;
  const command = createCommand(target);

  await new Promise(resolve => setTimeout(resolve, 1800));

  const acknowledgements = [...command.acknowledgements.values()];
  const successful = acknowledgements.filter(a => a.success).length;
  const failed = acknowledgements.filter(a => !a.success).length;

  if (onlineBefore === 0) {
    return interaction.editReply(
      `❌ **Click ${target} failed**\nReason: no connected Tampermonkey clients.`
    );
  }

  if (acknowledgements.length === 0) {
    return interaction.editReply(
      `❌ **Click ${target} failed**\nReason: connected clients did not acknowledge the command.`
    );
  }

  const failureReasons = acknowledgements
    .filter(a => !a.success && a.reason)
    .map(a => a.reason)
    .slice(0, 3);

  let text =
    `✅ **Click ${target} completed**\n\n` +
    `📡 Clients online when sent: **${onlineBefore}**\n` +
    `📥 Clients received: **${acknowledgements.length}**\n` +
    `✅ Successful clicks: **${successful}**\n` +
    `❌ Failed clicks: **${failed}**`;

  if (failureReasons.length) {
    text += `\n\n**Failure reasons:**\n${failureReasons.map(r => `• ${r}`).join("\n")}`;
  }

  await interaction.editReply(text);
});

const port = process.env.SERVER_PORT || process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

discord.login(BOT_TOKEN).catch(err => {
  console.error("Discord login failed:", err.message);
  process.exit(1);
});