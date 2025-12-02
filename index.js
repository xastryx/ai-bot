import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js"
import Database from "better-sqlite3"
import { ChartJSNodeCanvas } from "chartjs-node-canvas"
import cron from "node-cron"
import { mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// Get directory path for data storage (needed for ES modules)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize database connection
// Creates data directory if it doesn't exist and opens SQLite database file
const dataDir = join(__dirname, "data")
mkdirSync(dataDir, { recursive: true })
const db = new Database(join(dataDir, "analytics.db"))

// Chart.js canvas renderer configuration
// Generates 1200x800px PNG images for all chart visualizations
const width = 1200
const height = 800
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height })

// ============================================================================
// DATABASE INITIALIZATION & SCHEMA
// ============================================================================

// Initialize database with all required tables and indexes for analytics tracking
function initDatabase() {
  db.exec(`
    -- Messages table: stores every message sent in tracked guilds
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,           -- Server ID where message was sent
      user_id TEXT NOT NULL,            -- User who sent the message
      channel_id TEXT NOT NULL,         -- Channel where message was sent
      message_length INTEGER DEFAULT 0, -- Length of message content for activity analysis
      timestamp INTEGER NOT NULL        -- Unix timestamp when message was sent
    );
    
    -- Reactions table: tracks emoji reactions on messages
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,    -- Server ID where reaction occurred
      user_id TEXT NOT NULL,     -- User who added the reaction
      emoji TEXT NOT NULL,       -- Emoji name or ID
      timestamp INTEGER NOT NULL -- Unix timestamp when reaction was added
    );
    
    -- Members table: tracks user joins and leaves
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,    -- Server ID
      user_id TEXT NOT NULL,     -- User ID
      action TEXT NOT NULL,      -- Action: 'join' or 'leave'
      timestamp INTEGER NOT NULL -- Unix timestamp of the action
    );
    
    -- Guild settings table: stores per-server configuration
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,              -- Server ID (unique key)
      enabled INTEGER DEFAULT 1,              -- Whether tracking is enabled (1 = true, 0 = false)
      log_channel_id TEXT,                    -- Channel ID where weekly reports are sent
      tracked_channels TEXT DEFAULT '[]',     -- JSON array of channel IDs to track (empty = all)
      notifications_enabled INTEGER DEFAULT 1 -- Whether to send automated weekly reports
    );
    
    -- Create indexes for faster queries on common search patterns
    CREATE INDEX IF NOT EXISTS idx_messages_guild ON messages(guild_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_members_guild ON members(guild_id, timestamp);
  `)

  console.log("Database initialized")
}

// ============================================================================
// TRACKING FUNCTIONS - Record user activity
// ============================================================================

// Record a message sent in the guild
function trackMessage(guildId, userId, channelId, messageLength) {
  const stmt = db.prepare(`
    INSERT INTO messages (guild_id, user_id, channel_id, message_length, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, channelId, messageLength, Date.now())
}

// Record a reaction added to a message
function trackReaction(guildId, userId, emoji) {
  const stmt = db.prepare(`
    INSERT INTO reactions (guild_id, user_id, emoji, timestamp)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, emoji, Date.now())
}

// Record a member joining or leaving the guild
function trackMember(guildId, userId, action) {
  const stmt = db.prepare(`
    INSERT INTO members (guild_id, user_id, action, timestamp)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, action, Date.now())
}

// ============================================================================
// SETTINGS MANAGEMENT - Per-guild configuration
// ============================================================================

// Get or create guild settings with defaults
function getGuildSettings(guildId) {
  let stmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
  let settings = stmt.get(guildId)

  // If guild doesn't have settings yet, create default settings
  if (!settings) {
    stmt = db.prepare("INSERT INTO guild_settings (guild_id) VALUES (?)")
    stmt.run(guildId)
    settings = { guild_id: guildId, enabled: 1, tracked_channels: "[]", notifications_enabled: 1 }
  }

  return settings
}

// Update guild settings (tracking enabled, notifications, channels, etc.)
function updateGuildSettings(guildId, updates) {
  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(", ")
  const values = [...Object.values(updates), guildId]
  const stmt = db.prepare(`UPDATE guild_settings SET ${fields} WHERE guild_id = ?`)
  stmt.run(...values)
}

// ============================================================================
// ANALYTICS QUERIES - Fetch aggregated data from database
// ============================================================================

// Get comprehensive analytics for a guild over a specified period
function getAnalytics(guildId, period = "week") {
  const now = Date.now()
  // Convert period to milliseconds (week = 7 days, month = 30 days)
  const timeRange = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  const startTime = now - timeRange

  // Get top 10 most active users by message count
  const topUsers = db
    .prepare(`
    SELECT user_id, COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
    GROUP BY user_id
    ORDER BY count DESC
    LIMIT 10
  `)
    .all(guildId, startTime)

  // Get top 10 most active channels by message count
  const topChannels = db
    .prepare(`
    SELECT channel_id, COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
    GROUP BY channel_id
    ORDER BY count DESC
    LIMIT 10
  `)
    .all(guildId, startTime)

  // Count total messages in period
  const totalMessages = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
  `)
    .get(guildId, startTime).count

  // Count members who joined in period
  const newMembers = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM members
    WHERE guild_id = ? AND action = 'join' AND timestamp >= ?
  `)
    .get(guildId, startTime).count

  // Count members who left in period
  const leftMembers = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM members
    WHERE guild_id = ? AND action = 'leave' AND timestamp >= ?
  `)
    .get(guildId, startTime).count

  // Get daily message counts for activity trend chart
  const dailyActivity = db
    .prepare(`
    SELECT 
      DATE(timestamp / 1000, 'unixepoch') as date,
      COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
    GROUP BY date
    ORDER BY date
  `)
    .all(guildId, startTime)

  // Get hourly message counts for heatmap visualization (24-hour distribution)
  const hourlyActivity = db
    .prepare(`
    SELECT 
      CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) as hour,
      COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
    GROUP BY hour
    ORDER BY hour
  `)
    .all(guildId, startTime)

  return {
    topUsers,
    topChannels,
    totalMessages,
    newMembers,
    leftMembers,
    dailyActivity,
    hourlyActivity,
  }
}

// Get analytics from the previous period (for comparison and percentage calculations)
function getPreviousAnalytics(guildId, period = "week") {
  const now = Date.now()
  const timeRange = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  const startTime = now - timeRange * 2 // Start from 2 periods ago
  const endTime = now - timeRange // End at 1 period ago

  // Count total messages in the previous period
  const totalMessages = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ? AND timestamp < ?
  `)
    .get(guildId, startTime, endTime).count

  return { totalMessages }
}

// ============================================================================
// CHART GENERATION - Create visual representations of data
// ============================================================================

// Generate a line chart showing daily activity trends
async function generateActivityChart(dailyActivity, title) {
  const configuration = {
    type: "line",
    data: {
      labels: dailyActivity.map((d) => d.date),
      datasets: [
        {
          label: "Messages",
          data: dailyActivity.map((d) => d.count),
          borderColor: "rgb(99, 102, 241)", // Indigo blue
          backgroundColor: "rgba(99, 102, 241, 0.1)", // Semi-transparent fill
          fill: true, // Fill area under line
          tension: 0.4, // Smooth curve
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 24 },
        },
        legend: {
          display: true,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}

// Generate a bar chart for comparing discrete values (top users, top channels)
async function generateBarChart(data, labels, title) {
  const configuration = {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Count",
          data: data,
          backgroundColor: "rgba(99, 102, 241, 0.7)", // Semi-transparent indigo
          borderColor: "rgb(99, 102, 241)", // Solid indigo border
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 24 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}

// Generate a 24-hour activity heatmap showing when the server is most active
async function generateHeatmap(hourlyActivity) {
  // Create array of all 24 hours with message counts (0 if no activity)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const counts = hours.map((h) => {
    const found = hourlyActivity.find((a) => a.hour === h)
    return found ? found.count : 0
  })

  // Color intensity is based on activity level (darker = more active)
  const configuration = {
    type: "bar",
    data: {
      labels: hours.map((h) => `${h}:00`),
      datasets: [
        {
          label: "Activity Level",
          data: counts,
          // Dynamically set background color based on activity intensity
          backgroundColor: counts.map((c) => {
            const max = Math.max(...counts)
            const intensity = c / max
            return `rgba(99, 102, 241, ${intensity})`
          }),
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Activity Heatmap (24 Hours)",
          font: { size: 24 },
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Messages",
          },
        },
        x: {
          title: {
            display: true,
            text: "Hour of Day",
          },
        },
      },
    },
  }

  return await chartJSNodeCanvas.renderToBuffer(configuration)
}

// ============================================================================
// REPORTING - Generate and send automated weekly reports
// ============================================================================

// Send a comprehensive weekly analytics report to the configured log channel
async function sendWeeklyReport(guild) {
  const settings = getGuildSettings(guild.id)
  // Don't send if notifications disabled or no log channel configured
  if (!settings.notifications_enabled || !settings.log_channel_id) return

  const channel = guild.channels.cache.get(settings.log_channel_id)
  if (!channel) return

  // Fetch analytics for current week and previous week for comparison
  const analytics = getAnalytics(guild.id, "week")
  const previous = getPreviousAnalytics(guild.id, "week")

  // Calculate percentage change from previous week
  const change =
    previous.totalMessages > 0
      ? (((analytics.totalMessages - previous.totalMessages) / previous.totalMessages) * 100).toFixed(1)
      : 0

  // Get top 5 contributors with their usernames
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

  // Create embed with summary statistics
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("Weekly Analytics Report")
    .setDescription(`Server activity summary for the past 7 days`)
    .addFields(
      { name: "Total Messages", value: analytics.totalMessages.toString(), inline: true },
      { name: "Change", value: `${change > 0 ? "+" : ""}${change}%`, inline: true },
      { name: "New Members", value: `+${analytics.newMembers} / -${analytics.leftMembers}`, inline: true },
      { name: "Top Contributors", value: topUsersText.join("\n") || "No data" },
    )
    .setTimestamp()

  try {
    // Generate and attach activity trend chart
    const chartBuffer = await generateActivityChart(analytics.dailyActivity, "Weekly Activity")
    const attachment = new AttachmentBuilder(chartBuffer, { name: "activity.png" })
    embed.setImage("attachment://activity.png")

    await channel.send({ embeds: [embed], files: [attachment] })
  } catch (error) {
    console.error("Failed to send weekly report:", error)
  }
}

// ============================================================================
// COMMAND DEFINITIONS - Interactive slash commands
// ============================================================================

// Collection to store all registered commands
const commands = new Collection()

// Stats command
const statsCommand = {
  data: new SlashCommandBuilder().setName("stats").setDescription("Quick server statistics"),
  async execute(interaction) {
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
      .setTitle("Quick Stats (Last 7 Days)")
      .addFields(
        { name: "Total Messages", value: analytics.totalMessages.toString(), inline: true },
        { name: "New Members", value: analytics.newMembers.toString(), inline: true },
        { name: "Left Members", value: analytics.leftMembers.toString(), inline: true },
        { name: "Top User", value: topUserText },
        { name: "Top Channel", value: topChannelText },
      )
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
  },
}

// Report command
const reportCommand = {
  data: new SlashCommandBuilder()
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
    ),
  async execute(interaction) {
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
        .setTitle(`Activity Heatmap - ${periodText}`)
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
        .setTitle(`Top Contributors - ${periodText}`)
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
        .setTitle(`Most Active Channels - ${periodText}`)
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
      .setTitle(`${periodText} Analytics Report`)
      .setDescription(`Server activity summary for the past ${period === "week" ? "7 days" : "30 days"}`)
      .addFields(
        { name: "Total Messages", value: analytics.totalMessages.toString(), inline: true },
        { name: "Change", value: `${change > 0 ? "+" : ""}${change}%`, inline: true },
        { name: "Member Changes", value: `+${analytics.newMembers} / -${analytics.leftMembers}`, inline: true },
        { name: "Top Contributors", value: topUsersText.join("\n") || "No data", inline: true },
        { name: "Most Active Channels", value: topChannelsText.join("\n") || "No data", inline: true },
      )
      .setTimestamp()

    const chartBuffer = await generateActivityChart(analytics.dailyActivity, `${periodText} Activity Trend`)
    const attachment = new AttachmentBuilder(chartBuffer, { name: "activity.png" })
    embed.setImage("attachment://activity.png")

    await interaction.editReply({ embeds: [embed], files: [attachment] })
  },
}

// Settings command
const settingsCommand = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure analytics bot settings")
    .setDefaultMemberPermissions("0x0000000000000020"),
  async execute(interaction) {
    const settings = getGuildSettings(interaction.guild.id)

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle("Analytics Settings")
      .setDescription("Configure how analytics are tracked and reported")
      .addFields(
        { name: "Tracking", value: settings.enabled ? "Enabled" : "Disabled", inline: true },
        { name: "Notifications", value: settings.notifications_enabled ? "Enabled" : "Disabled", inline: true },
        {
          name: "Log Channel",
          value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : "Not set",
          inline: true,
        },
      )

    const trackedChannels = JSON.parse(settings.tracked_channels || "[]")
    if (trackedChannels.length > 0) {
      const channelMentions = trackedChannels.map((id) => `<#${id}>`).join(", ")
      embed.addFields({ name: "Tracked Channels", value: channelMentions })
    } else {
      embed.addFields({ name: "Tracked Channels", value: "All channels" })
    }

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("toggle_tracking")
        .setLabel(settings.enabled ? "Disable Tracking" : "Enable Tracking")
        .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("toggle_notifications")
        .setLabel(settings.notifications_enabled ? "Disable Alerts" : "Enable Alerts")
        .setStyle(settings.notifications_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
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
        { name: "Tracking", value: settings.enabled ? "Enabled" : "Disabled", inline: true },
        { name: "Notifications", value: settings.notifications_enabled ? "Enabled" : "Disabled", inline: true },
        {
          name: "Log Channel",
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
  },
}

commands.set(statsCommand.data.name, statsCommand)
commands.set(reportCommand.data.name, reportCommand)
commands.set(settingsCommand.data.name, settingsCommand)

// ============================================================================
// DISCORD CLIENT SETUP & EVENT LISTENERS
// ============================================================================

// Create Discord client with necessary intents for tracking
// Intents specify which events the bot should receive
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Guild/server events
    GatewayIntentBits.GuildMessages, // Message events in guilds
    GatewayIntentBits.GuildMembers, // Member join/leave events
    GatewayIntentBits.MessageContent, // Full message content (needed to read messages)
    GatewayIntentBits.GuildMessageReactions, // Reaction events
  ],
})

// Attach commands collection to client for command execution
client.commands = commands

// Event: Bot is ready and logged in
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`)

  // Initialize database tables and indexes
  initDatabase()

  // Schedule weekly reports to run every Monday at 9 AM
  // Cron format: minute hour day-of-month month day-of-week
  cron.schedule("0 9 * * 1", () => {
    client.guilds.cache.forEach((guild) => {
      sendWeeklyReport(guild)
    })
  })

  console.log("Analytics tracking enabled")
})

// Event: Message sent in any guild
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return
  // Ignore DMs
  if (!message.guild) return

  // Check if tracking is enabled for this guild
  const settings = getGuildSettings(message.guild.id)
  if (!settings.enabled) return

  // Check if we're only tracking specific channels
  const trackedChannels = JSON.parse(settings.tracked_channels || "[]")
  if (trackedChannels.length > 0 && !trackedChannels.includes(message.channel.id)) return

  // Record the message
  trackMessage(message.guild.id, message.author.id, message.channel.id, message.content.length)
})

// Event: Reaction added to a message
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  // Ignore bot reactions
  if (user.bot) return
  // Ignore reactions outside guilds (DMs)
  if (!reaction.message.guild) return

  // Record the reaction
  trackReaction(reaction.message.guild.id, user.id, reaction.emoji.name)
})

// Event: User joined a guild
client.on(Events.GuildMemberAdd, async (member) => {
  trackMember(member.guild.id, member.id, "join")
})

// Event: User left a guild
client.on(Events.GuildMemberRemove, async (member) => {
  trackMember(member.guild.id, member.id, "leave")
})

// Event: Slash command or interaction executed
client.on(Events.InteractionCreate, async (interaction) => {
  // Only handle slash commands (not buttons, menus, etc.)
  if (!interaction.isChatInputCommand()) return

  // Get the command from our collection
  const command = client.commands.get(interaction.commandName)
  if (!command) return

  try {
    // Execute the command
    await command.execute(interaction)
  } catch (error) {
    // Log error and notify user
    console.error("Command error:", error)
    const reply = { content: "There was an error executing this command.", ephemeral: true }
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply)
    } else {
      await interaction.reply(reply)
    }
  }
})

// ============================================================================
// BOT LOGIN
// ============================================================================

// Get bot token from environment variables
const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error("DISCORD_TOKEN not found in environment variables")
  process.exit(1)
}

// Login to Discord
client.login(token)
