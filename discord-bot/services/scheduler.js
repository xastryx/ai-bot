import { getAnalytics, getPreviousAnalytics, getGuildSettings } from "../database/queries.js"
import { EmbedBuilder, AttachmentBuilder } from "discord.js"
import { generateActivityChart } from "./chart-generator.js"

export async function sendWeeklyReport(guild) {
  const settings = getGuildSettings(guild.id)
  if (!settings.notifications_enabled || !settings.log_channel_id) return

  const channel = guild.channels.cache.get(settings.log_channel_id)
  if (!channel) return

  const analytics = getAnalytics(guild.id, "week")
  const previous = getPreviousAnalytics(guild.id, "week")

  const change =
    previous.totalMessages > 0
      ? (((analytics.totalMessages - previous.totalMessages) / previous.totalMessages) * 100).toFixed(1)
      : 0

  const topUsersText = await Promise.all(
    analytics.topUsers.slice(0, 5).map(async (u, i) => {
      try {
        const user = await guild.members.fetch(u.user_id)
        return `${i + 1}. ${user.user.username} - ${u.count} messages`
      } catch {
        return `${i + 1}. Unknown User - ${u.count} messages`
      }
    }),
  )

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("📊 Weekly Analytics Report")
    .setDescription(`Server activity summary for the past 7 days`)
    .addFields(
      { name: "💬 Total Messages", value: analytics.totalMessages.toString(), inline: true },
      { name: "📈 Change", value: `${change > 0 ? "+" : ""}${change}%`, inline: true },
      { name: "👥 New Members", value: `+${analytics.newMembers} / -${analytics.leftMembers}`, inline: true },
      { name: "🏆 Top Contributors", value: topUsersText.join("\n") || "No data" },
    )
    .setTimestamp()

  try {
    const chartBuffer = await generateActivityChart(analytics.dailyActivity, "Weekly Activity")
    const attachment = new AttachmentBuilder(chartBuffer, { name: "activity.png" })
    embed.setImage("attachment://activity.png")

    await channel.send({ embeds: [embed], files: [attachment] })
  } catch (error) {
    console.error("Failed to send weekly report:", error)
  }
}
