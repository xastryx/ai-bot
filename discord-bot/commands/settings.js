import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js"
import { getGuildSettings, updateGuildSettings } from "../database/queries.js"

export const data = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure analytics bot settings")
  .setDefaultMemberPermissions("0x0000000000000020")

export async function execute(interaction) {
  const settings = getGuildSettings(interaction.guild.id)

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("⚙️ Analytics Settings")
    .setDescription("Configure how analytics are tracked and reported")
    .addFields(
      { name: "📊 Tracking", value: settings.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
      { name: "🔔 Notifications", value: settings.notifications_enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
      {
        name: "📢 Log Channel",
        value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : "Not set",
        inline: true,
      },
    )

  const trackedChannels = JSON.parse(settings.tracked_channels || "[]")
  if (trackedChannels.length > 0) {
    const channelMentions = trackedChannels.map((id) => `<#${id}>`).join(", ")
    embed.addFields({ name: "📝 Tracked Channels", value: channelMentions })
  } else {
    embed.addFields({ name: "📝 Tracked Channels", value: "All channels" })
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("toggle_tracking")
      .setLabel(settings.enabled ? "Disable Tracking" : "Enable Tracking")
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji("📊"),
    new ButtonBuilder()
      .setCustomId("toggle_notifications")
      .setLabel(settings.notifications_enabled ? "Disable Alerts" : "Enable Alerts")
      .setStyle(settings.notifications_enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji("🔔"),
  )

  const textChannels = interaction.guild.channels.cache
    .filter((ch) => ch.type === ChannelType.GuildText)
    .map((ch) => ({ label: ch.name, value: ch.id }))
    .slice(0, 25)

  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("set_log_channel")
      .setPlaceholder("Select log channel")
      .addOptions(textChannels),
  )

  await interaction.reply({
    embeds: [embed],
    components: [row1, row2],
    ephemeral: true,
  })

  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    time: 300000,
  })

  collector.on("collect", async (i) => {
    if (i.customId === "toggle_tracking") {
      updateGuildSettings(interaction.guild.id, { enabled: settings.enabled ? 0 : 1 })
      settings.enabled = settings.enabled ? 0 : 1
      await i.reply({ content: `Tracking ${settings.enabled ? "enabled" : "disabled"}!`, ephemeral: true })
    } else if (i.customId === "toggle_notifications") {
      updateGuildSettings(interaction.guild.id, { notifications_enabled: settings.notifications_enabled ? 0 : 1 })
      settings.notifications_enabled = settings.notifications_enabled ? 0 : 1
      await i.reply({
        content: `Notifications ${settings.notifications_enabled ? "enabled" : "disabled"}!`,
        ephemeral: true,
      })
    } else if (i.customId === "set_log_channel") {
      const channelId = i.values[0]
      updateGuildSettings(interaction.guild.id, { log_channel_id: channelId })
      settings.log_channel_id = channelId
      await i.reply({ content: `Log channel set to <#${channelId}>!`, ephemeral: true })
    }

    embed.spliceFields(
      0,
      3,
      { name: "📊 Tracking", value: settings.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
      { name: "🔔 Notifications", value: settings.notifications_enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
      {
        name: "📢 Log Channel",
        value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : "Not set",
        inline: true,
      },
    )

    row1.components[0]
      .setLabel(settings.enabled ? "Disable Tracking" : "Enable Tracking")
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    row1.components[1]
      .setLabel(settings.notifications_enabled ? "Disable Alerts" : "Enable Alerts")
      .setStyle(settings.notifications_enabled ? ButtonStyle.Danger : ButtonStyle.Success)

    await interaction.editReply({ embeds: [embed], components: [row1, row2] })
  })
}
