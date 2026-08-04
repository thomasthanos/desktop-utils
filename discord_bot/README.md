# Discord Dashboard Bot

Discord bot with a synced Node.js web dashboard for music/idle playback, moderation, and invite tracking.

---

## ✨ Features

- 🎵 **Music / Idle Player** — play, queue, volume control, live idle playlist sync
- 🖥️ **Web Dashboard** — Express + EJS dashboard synced live via Socket.IO
- 🛡️ **Moderation** — clear, wipe-channel, authorized-user management
- 📋 **Invite Logging** — tracks and logs invite usage
- 💾 **SQLite storage** — via `better-sqlite3`

---

## 🛠️ Requirements

- Node.js v18+
- A Discord bot token (`.env` — not included, see below)

---

## 🚀 Getting Started

```bash
npm install
npm start        # production
npm run dev       # nodemon, auto-restart
npm run check     # syntax check core files
```

Create a `.env` file in the project root with your bot credentials, e.g.:

```
DISCORD_TOKEN=your-bot-token
```

---

## 🗂️ Structure

```
src/
├── index.js            # bot entrypoint
├── database.js         # SQLite setup
├── prefix-commands.js  # legacy prefix command handling
├── idle-live.js         # live idle playback sync
├── idle-pending.js      # pending idle queue
├── commands/            # slash commands (play, stop, volume, clear, ...)
├── dashboard/            # Express + EJS + Socket.IO web dashboard
└── utils/                # attachments, authorization helpers
```

---

## 📄 License

MIT
