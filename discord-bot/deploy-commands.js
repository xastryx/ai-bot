import { REST, Routes } from "discord.js"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readdirSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const commands = []
const commandsPath = join(__dirname, "commands")
const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith(".js"))

for (const file of commandFiles) {
  const filePath = join(commandsPath, file)
  const command = await import(`file://${filePath}`)
  if ("data" in command) {
    commands.push(command.data.toJSON())
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN)

try {
  console.log(`🔄 Refreshing ${commands.length} application (/) commands...`)

  const data = await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands })

  console.log(`✅ Successfully loaded ${data.length} application (/) commands.`)
} catch (error) {
  console.error("❌ Error deploying commands:", error)
}
