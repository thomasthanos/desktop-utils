# ThomasThanos Projects Hub

Ενιαίο repository που συγκεντρώνει τα παρακάτω projects, το καθένα στον δικό του φάκελο με το δικό του README:

| Project | Περιγραφή | Stack |
|---|---|---|
| [`Github-Build-Release`](./Github-Build-Release) | Desktop app διαχείρισης GitHub releases με AI release notes | Electron, React, Vite |
| [`backup_projects`](./backup_projects) | Backup Studio — Electron app για backup projects με Dropbox sync | Electron, React |
| [`discord_bot`](./discord_bot) | Discord bot με music/idle player, moderation και web dashboard | Node.js, Discord.js, Express |
| [`autoclicker_premium`](./autoclicker_premium) | Configurable auto-clicker για Windows | Electron, React |

---

## Δομή

```
thomasthanos-hub/
├── Github-Build-Release/
├── backup_projects/
├── discord_bot/
├── autoclicker_premium/
└── README.md
```

Κάθε φάκελος είναι αυτόνομος (δικό του `package.json`, δικό του README) — μπες σε κάθε έναν για οδηγίες εγκατάστασης/build.

---

## Σημειώσεις

- Τα `node_modules`, `dist`, `release`, `.env` και άλλα build/secret αρχεία έχουν εξαιρεθεί κατά τη μεταφορά (βλ. `.gitignore` κάθε project).
- Το ιστορικό git των αρχικών repos **δεν** μεταφέρθηκε — αυτό εδώ ξεκινά ως νέο, ενιαίο repository.
- Original repos:
  - https://github.com/thomasthanos/Github-Build-Release
  - https://github.com/thomasthanos/backup_projects
  - https://github.com/thomasthanos/discord_bot
  - https://github.com/thomasthanos/autoclicker_premium

Made with ⚡ by ThomasThanos
