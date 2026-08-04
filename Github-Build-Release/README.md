# 🚀 ReleaseFlow — GitHub Release Manager

Desktop app for managing GitHub releases with AI-powered notes and integrated build tools. Built with **Electron + React + Vite**.

---

## ✨ Features

- **Create Releases** — Set version tag (auto-suggested from `package.json`), write a title and Markdown release notes with live preview
- **AI Format** — Describe your changes in plain text; DeepSeek V4 Flash generates a professional title + structured release notes automatically
- **Release History** — View, browse and delete GitHub releases and git tags; open them directly on GitHub
- **Build Console** — Run your build command in real-time with log output, auto-opens `dist/` on success
- **Themes** — Dark/Light mode, glassmorphism UI, toast notifications

---

## 🛠️ Requirements

- Node.js v18+
- [GitHub CLI](https://cli.github.com/) — installed and authenticated (`gh auth login`)
- [DeepSeek API key](https://platform.deepseek.com/) — only for AI features

---

## 🚀 Getting Started

```bash
npm install
npm run dev      # Development
npm run build    # Build Windows installer → release/
```

---

## 🗂️ Structure

```
electron/
  main.js          # IPC handlers, GitHub CLI, AI API, build runner
  preload.js       # Context bridge
src/
  components/      # CreateRelease, ReleaseHistory, BuildLogs, Sidebar, Header, Modal, Toast
  styles/          # Per-component CSS
  App.jsx          # Root state
```

---

## 🔑 AI Setup

1. Get a key from [DeepSeek Platform](https://platform.deepseek.com/)
2. In the app: **Create Release → AI Format → enter key → Save**
3. Key is stored locally in `AppData/Roaming/ThomasThanos/GithubReleaseManager/`

ReleaseFlow uses `deepseek-v4-flash` with thinking disabled. It never falls back to the Pro model. AI prompts and responses are capped, and generated build/lock-file contents are excluded from raw diffs to reduce token usage.

---

## 📄 License

MIT
