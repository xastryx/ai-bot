import { db } from "./init.js"

export function trackMessage(guildId, userId, channelId, messageLength) {
  const stmt = db.prepare(`
    INSERT INTO messages (guild_id, user_id, channel_id, message_length, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, channelId, messageLength, Date.now())
}

export function trackReaction(guildId, userId, emoji) {
  const stmt = db.prepare(`
    INSERT INTO reactions (guild_id, user_id, emoji, timestamp)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, emoji, Date.now())
}

export function trackMember(guildId, userId, action) {
  const stmt = db.prepare(`
    INSERT INTO members (guild_id, user_id, action, timestamp)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(guildId, userId, action, Date.now())
}

export function getGuildSettings(guildId) {
  let stmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
  let settings = stmt.get(guildId)

  if (!settings) {
    stmt = db.prepare("INSERT INTO guild_settings (guild_id) VALUES (?)")
    stmt.run(guildId)
    settings = { guild_id: guildId, enabled: 1, tracked_channels: "[]", notifications_enabled: 1 }
  }

  return settings
}

export function updateGuildSettings(guildId, updates) {
  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(", ")
  const values = [...Object.values(updates), guildId]
  const stmt = db.prepare(`UPDATE guild_settings SET ${fields} WHERE guild_id = ?`)
  stmt.run(...values)
}

export function getAnalytics(guildId, period = "week") {
  const now = Date.now()
  const timeRange = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  const startTime = now - timeRange

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

  const totalMessages = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ?
  `)
    .get(guildId, startTime).count

  const newMembers = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM members
    WHERE guild_id = ? AND action = 'join' AND timestamp >= ?
  `)
    .get(guildId, startTime).count

  const leftMembers = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM members
    WHERE guild_id = ? AND action = 'leave' AND timestamp >= ?
  `)
    .get(guildId, startTime).count

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

export function getPreviousAnalytics(guildId, period = "week") {
  const now = Date.now()
  const timeRange = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  const startTime = now - timeRange * 2
  const endTime = now - timeRange

  const totalMessages = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE guild_id = ? AND timestamp >= ? AND timestamp < ?
  `)
    .get(guildId, startTime, endTime).count

  return { totalMessages }
}
