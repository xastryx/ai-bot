# Astryx Insights - Discord Analytics Bot

Advanced Discord analytics bot that tracks server activity, generates beautiful reports, and provides actionable insights.

## Features

- 📊 **Real-time Activity Tracking** - Messages, reactions, member joins/leaves, channel usage
- 📈 **Beautiful Reports** - Weekly and monthly analytics with charts and graphs
- 🔥 **Activity Heatmaps** - Visualize when your community is most active
- ⚙️ **Interactive Settings** - Configure tracking with buttons and dropdowns
- 🔔 **Smart Notifications** - Automated weekly reports and activity alerts

## Setup

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Create a Discord bot at https://discord.com/developers/applications

3. Enable these intents in the Discord Developer Portal:
   - Server Members Intent
   - Message Content Intent

4. Set environment variables:
\`\`\`bash
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
\`\`\`

5. Deploy slash commands:
\`\`\`bash
node deploy-commands.js
\`\`\`

6. Start the bot:
\`\`\`bash
npm start
\`\`\`

## Commands

- `/report <period> [type]` - Generate detailed analytics report
  - period: `weekly` or `monthly`
  - type: `overview`, `users`, `channels`, or `heatmap`

- `/stats` - Quick server statistics for the last 7 days

- `/settings` - Configure bot settings (Admin only)
  - Toggle tracking on/off
  - Enable/disable notifications
  - Set log channel
  - Select tracked channels

## Data Storage

All data is stored locally in SQLite database at `data/analytics.db`. The bot tracks:
- Message counts per user/channel
- Reaction counts
- Member join/leave events
- Timestamps for all activities

## Automated Reports

The bot automatically sends weekly reports every Monday at 9 AM to the configured log channel, including:
- Total message count
- Activity comparison with previous week
- Top contributors
- Growth statistics
- Activity trend chart

## Privacy

This bot only tracks:
- Message counts (not content)
- Public reactions
- Member join/leave events
- Channel activity

No message content or private information is stored.
