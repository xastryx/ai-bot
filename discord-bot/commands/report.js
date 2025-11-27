import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js"
import { getAnalytics, getPreviousAnalytics } from "../database/queries.js"
import { generateActivityChart, generateBarChart, generateHeatmap } from "../services/chart-generator.js"

export const data = new SlashCommandBuilder()
  .setName("report")
  .setDescription("Generate analytics report")
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("Report period")
      .setRequired(true)
      .addChoices({ name: "Weekly", value: "week" }, { name: "Monthly", value: "month" }),
  )
  .addStringOption((option) =>
    option
      .setName("type")
      .setDescription("Report type")
      .setRequired(false)
      .addChoices(
        { name: "Overview", value: "overview" },
        { name: "Top Users", value: "users" },
        { name: "Top Channels", value: "channels" },
        { name: "Heatmap", value: "heatmap" },
      ),
  )

export async function execute(interaction) {
  await interaction.deferReply()

  const period = interaction.options.getString("period")
  const type = interaction.options.getString("type") || "overview"
  const analytics = getAnalytics(interaction.guild.id, period)
  const previous = getPreviousAnalytics(interaction.guild.id, period)

  const periodText = period === "week" ? "Weekly" : "Monthly"

  if (type === "heatmap") {
    const heatmapBuffer = await generateHeatmap(analytics.hourlyActivity)
    const attachment = new AttachmentBuilder(heatmapBuffer, { name: "heatmap.png" })

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`🔥 Activity Heatmap - ${periodText}`)
      .setDescription("Shows when your server is most active throughout the day")
      .setImage("attachment://heatmap.png")
      .setTimestamp()

    return await interaction.editReply({ embeds: [embed], files: [attachment] })
  }

  if (type === "users") {
    const topUsers = await Promise.all(
      analytics.topUsers.slice(0, 10).map(async (u, i) => {
        try {
          const user = await interaction.guild.members.fetch(u.user_id)
          return { label: user.user.username, count: u.count }
        } catch {
          return { label: "Unknown User", count: u.count }
        }
      }),
    )

    const chartBuffer = await generateBarChart(
      topUsers.map((u) => u.count),
      topUsers.map((u) => u.label),
      `Top 10 Contributors - ${periodText}`,
    )

    const attachment = new AttachmentBuilder(chartBuffer, { name: "top-users.png" })

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`🏆 Top Contributors - ${periodText}`)
      .setImage("attachment://top-users.png")
      .setTimestamp()

    return await interaction.editReply({ embeds: [embed], files: [attachment] })
  }

  if (type === "channels") {
    const topChannels = await Promise.all(
      analytics.topChannels.slice(0, 10).map(async (c, i) => {
        try {
          const channel = await interaction.guild.channels.fetch(c.channel_id)
          return { label: channel.name, count: c.count }
        } catch {
          return { label: "Unknown Channel", count: c.count }
        }
      }),
    )

    const chartBuffer = await generateBarChart(
      topChannels.map((c) => c.count),
      topChannels.map((c) => c.label),
      `Top 10 Channels - ${periodText}`,
    )

    const attachment = new AttachmentBuilder(chartBuffer, { name: "top-channels.png" })

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`📺 Most Active Channels - ${periodText}`)
      .setImage("attachment://top-channels.png")
      .setTimestamp()

    return await interaction.editReply({ embeds: [embed], files: [attachment] })
  }

  const change =
    previous.totalMessages > 0
      ? (((analytics.totalMessages - previous.totalMessages) / previous.totalMessages) * 100).toFixed(1)
      : 0

  const topUsersText = await Promise.all(
    analytics.topUsers.slice(0, 5).map(async (u, i) => {
      try {
        const user = await interaction.guild.members.fetch(u.user_id)
        return `${i + 1}. ${user.user.username} - ${u.count} messages`
      } catch {
        return `${i + 1}. Unknown User - ${u.count} messages`
      }
    }),
  )

  const topChannelsText = await Promise.all(
    analytics.topChannels.slice(0, 5).map(async (c, i) => {
      try {
        const channel = await interaction.guild.channels.fetch(c.channel_id)
        return `${i + 1}. #${channel.name} - ${c.count} messages`
      } catch {
        return `${i + 1}. Unknown Channel - ${c.count} messages`
      }
    }),
  )

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`📊 ${periodText} Analytics Report`)
    .setDescription(`Server activity summary for the past ${period === "week" ? "7 days" : "30 days"}`)
    .addFields(
      { name: "💬 Total Messages", value: analytics.totalMessages.toString(), inline: true },
      { name: "📈 Change", value: `${change > 0 ? "+" : ""}${change}%`, inline: true },
      { name: "👥 Member Changes", value: `+${analytics.newMembers} / -${analytics.leftMembers}`, inline: true },
      { name: "🏆 Top Contributors", value: topUsersText.join("\n") || "No data", inline: true },
      { name: "📺 Most Active Channels", value: topChannelsText.join("\n") || "No data", inline: true },
    )
    .setTimestamp()

  const chartBuffer = await generateActivityChart(analytics.dailyActivity, `${periodText} Activity Trend`)
  const attachment = new AttachmentBuilder(chartBuffer, { name: "activity.png" })
  embed.setImage("attachment://activity.png")

  await interaction.editReply({ embeds: [embed], files: [attachment] })
}
