require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once("ready", async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  const embed = new EmbedBuilder()
    .setTitle("🍑 ACCÈS +18 UNIQUEMENT")
    .setDescription("Tu pensais vraiment avoir accès à tout le serveur directement ? 😈\n\nUne partie du contenu est **caché** uniquement réservé à nos membres majeurs vérifiés 🔐\n\nListe des salons ci-dessous")
    .setImage(process.env.IMAGE_URL)
    .setFooter({ text: "Clique sur le bouton pour te faire vérifier" })
    .setColor(0xff6b00);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("verify_age").setLabel("🔓 Vérifier mon âge").setStyle(ButtonStyle.Primary)
  );
  await channel.send({ embeds: [embed], components: [row] });
});

client.on("interactionCreate", async (i) => {
  if (i.customId !== "verify_age") return;
  try {
    await i.member.roles.add(process.env.ROLE_ID);
    await i.reply({ content: "Accès débloqué.", ephemeral: true });
  } catch {
    await i.reply({ content: "Erreur : vérifie mes permissions et la hiérarchie des rôles.", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
