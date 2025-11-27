import { SlashCommandBuilder, EmbedBuilder } from "discord.js"
import { getAnalytics } from "../database/queries.js"

export const data = new SlashCommandBuilder().setName("stats").setDescription("Quick server statistics")

export async function execute(interaction) {
  await interaction.deferReply()

  const analytics = getAnalytics(interaction.guild.id, "week")

  const topUser = analytics.topUsers[0]
  let topUserText = "No data"
  if (topUser) {
    try {
      const user = await interaction.guild.members.fetch(topUser.user_id)
      topUserText = `${user.user.username} (${topUser.count} messages)`
    } catch {
      topUserText = `Unknown User (${topUser.count} messages)`
    }
  }

  const topChannel = analytics.topChannels[0]
  let topChannelText = "No data"
  if (topChannel) {
    try {
      const channel = await interaction.guild.channels.fetch(topChannel.channel_id)
      topChannelText = `#${channel.name} (${topChannel.count} messages)`
    } catch {
      topChannelText = `Unknown Channel (${topChannel.count} messages)`
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("📊 Quick Stats (Last 7 Days)")
    .addFields(
      { name: "💬 Total Messages", value: analytics.totalMessages.toString(), inline: true },
      { name: "👥 New Members", value: analytics.newMembers.toString(), inline: true },
      { name: "👋 Left Members", value: analytics.leftMembers.toString(), inline: true },
      { name: "🏆 Top User", value: topUserText },
      { name: "📺 Top Channel", value: topChannelText },
    )
    .setTimestamp()

  await interaction.editReply({ embeds: [embed] })
}
