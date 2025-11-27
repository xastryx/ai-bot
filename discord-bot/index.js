import { Client, GatewayIntentBits, Collection, Events } from "discord.js"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readdirSync } from "fs"
import cron from "node-cron"
import { initDatabase } from "./database/init.js"
import { trackMessage, trackReaction, trackMember, getGuildSettings } from "./database/queries.js"
import { sendWeeklyReport } from "./services/scheduler.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
})

client.commands = new Collection()

const commandsPath = join(__dirname, "commands")
const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith(".js"))

for (const file of commandFiles) {
  const filePath = join(commandsPath, file)
  const command = await import(`file://${filePath}`)
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command)
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`)

  initDatabase()

  cron.schedule("0 9 * * 1", () => {
    client.guilds.cache.forEach((guild) => {
      sendWeeklyReport(guild)
    })
  })

  console.log("📊 Analytics tracking enabled")
})

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return
  if (!message.guild) return

  const settings = getGuildSettings(message.guild.id)
  if (!settings.enabled) return

  const trackedChannels = JSON.parse(settings.tracked_channels || "[]")
  if (trackedChannels.length > 0 && !trackedChannels.includes(message.channel.id)) return

  trackMessage(message.guild.id, message.author.id, message.channel.id, message.content.length)
})

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return
  if (!reaction.message.guild) return

  trackReaction(reaction.message.guild.id, user.id, reaction.emoji.name)
})

client.on(Events.GuildMemberAdd, async (member) => {
  trackMember(member.guild.id, member.id, "join")
})

client.on(Events.GuildMemberRemove, async (member) => {
  trackMember(member.guild.id, member.id, "leave")
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  const command = client.commands.get(interaction.commandName)
  if (!command) return

  try {
    await command.execute(interaction)
  } catch (error) {
    console.error("Command error:", error)
    const reply = { content: "There was an error executing this command.", ephemeral: true }
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply)
    } else {
      await interaction.reply(reply)
    }
  }
})

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error("❌ DISCORD_TOKEN not found in environment variables")
  process.exit(1)
}

client.login(token)
