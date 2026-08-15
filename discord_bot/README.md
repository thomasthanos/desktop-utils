# Discord music bot + dashboard

Discord bot με μουσική, αρχειοθέτηση μηνυμάτων και ζωντανό web dashboard.
Node.js 22 · discord.js v14 · discord-player v7 · Express + socket.io · SQLite.

---

## Τι κάνει

**Μουσική** — `/play` από YouTube ή Spotify link, ουρά με `/queue` `/skip`
`/pause` `/resume` `/shuffle` `/loop` `/remove` `/seek` `/nowplaying` `/volume`,
και **24/7 ραδιόφωνο** (`/idlemusic`) που ξαναρχίζει μόνο του μετά από crash ή
reboot. Όταν αδειάσει το κανάλι φωνής, φεύγει μετά από **5 λεπτά** χάρης — ή
ποτέ, αν ο ιδιοκτήτης του server γράψει `/247 on`.

**Στα DM** — `/help` και `/ask` δουλεύουν σε ιδιωτική συνομιλία, και το bot
απαντάει όταν του γράφεις. Οι μουσικές εντολές θέλουν κανάλι φωνής, οπότε
μένουν μέσα στους servers.

**AI (προαιρετικό)** — με `GEMINI_API_KEY` ενεργοποιείται η `/ask`: κουβέντα
και εντολές με κανονικά λόγια («βάλε κάτι χαλαρό», «τι παίζει;»). Δωρεάν tier,
χωρίς κάρτα. Δεν εκτελεί ποτέ `/clear`, `/wipe-channel` ή αλλαγές δικαιωμάτων —
σου γράφει την εντολή για να την τρέξεις εσύ. **Χωρίς κλειδί δεν αλλάζει
απολύτως τίποτα.**

**Διαχείριση** — `/clear` με deep-delete πέρα από το όριο των 14 ημερών,
`/wipe-channel`, πλήρη transcripts με συνημμένα στο dashboard, `/invite-logger`
για το ποιος έφερε ποιον, `/addauthorized` για δικαιώματα ανά εντολή.

**Dashboard** — ζωντανά στατιστικά, transcripts με προεπισκόπηση, έλεγχος
player από τον browser. Προστατευμένο με κωδικό, δεμένο στο loopback.

Κάθε εντολή δουλεύει και ως slash (`/play`) και ως prefix (`!play`), με
ελληνικά aliases (`!π`).

---

## Γρήγορη εκκίνηση (τοπικά)

```bash
npm ci
cp .env.example .env    # συμπλήρωσε DISCORD_BOT_TOKEN και CLIENT_ID
npm start
```

Απαιτεί **Node 22 LTS**. Στο Discord Developer Portal πρέπει να είναι
ενεργοποιημένα τα privileged intents **Message Content** και **Server Members**.

Το dashboard: `http://127.0.0.1:3000`. Χωρίς `DASHBOARD_PASSWORD` τρέχει χωρίς
κωδικό — επιτρέπεται μόνο στο loopback και το bot **αρνείται να ξεκινήσει** αν
το δέσεις σε δικτυακή διεύθυνση χωρίς κωδικό.

---

## Εντολές

```bash
npm start              # εκκίνηση
npm run dev            # με auto-reload
npm test               # όλοι οι έλεγχοι (ή: node src/tests/run.js music voice)
npm run smoke          # υγεία: modules, εντολές, βάση, στοίβα ήχου
npm run lint           # πιάνει μεταβλητές που δεν δηλώθηκαν (runtime σφάλματα)
npm run backup         # αντίγραφο της βάσης
npm run diag:ai        # ποια μοντέλα δέχεται ΟΝΤΩΣ το κλειδί σου
npm run diag:extractors # ποιος extractor αναλαμβάνει όντως ένα /play
```

Μεμονωμένοι έλεγχοι, χωρίς ξεχωριστό npm script ο καθένας:

```bash
node src/tests/run.js security   # auth του dashboard + XSS
node src/tests/run.js music      # βοηθοί μουσικής + αποθηκευμένη κατάσταση + 24/7
node src/tests/run.js voice      # αποσύνδεση από άδειο κανάλι (150ms αντί για 5 λεπτά)
node src/tests/run.js dm         # ποιες εντολές φτάνουν στα DM — και ποιες ΔΕΝ πρέπει
node src/tests/run.js ai         # ασφάλεια AI: το enum, ο εκτελεστής, η ιδιωτικότητα
node src/tests/run.js dates      # η ανάγνωση ημερομηνίας του /clear
```

Το `npm run smoke` είναι το πρώτο πράγμα που τρέχεις μετά από deploy: δείχνει
αν το `@discordjs/opus` είναι όντως εγκατεστημένο (αλλιώς το 24/7 ραδιόφωνο
τρέχει σε JavaScript encoder και τραυλίζει σε μικρό μηχάνημα).

---

## Δομή

```
src/
  index.js              bootstrap — 71 γραμμές
  lifecycle.js          instance lock, graceful shutdown, σήματα
  player.js             discord-player + extractors
  command-loader.js     αναδρομική φόρτωση εντολών
  database.js           SQLite (better-sqlite3, WAL)
  idle-live.js          το 24/7 ραδιόφωνο (ffmpeg + yt-dlp)
  idle-pending.js       ουρά αναμονής όσο παίζει το ραδιόφωνο
  prefix-commands.js    δρομολόγηση εντολών με πρόθεμα
  commands/             18 εντολές
  events/               ένα αρχείο ανά ομάδα γεγονότων
  utils/                logger, music, embeds, attachments, notify, auth helpers
  dashboard/            Express + socket.io + EJS
  tests/                harness.js + ένα αρχείο ανά τομέα, run.js τα τρέχει όλα
  tools/                backup, διαγνωστικά (diag-ai, diag-extractors)
deploy/                 systemd units, timers, setup.sh
```

---

## Ρύθμιση

Όλες οι μεταβλητές τεκμηριώνονται στο [.env.example](.env.example). Οι
σημαντικότερες:

| Μεταβλητή | Τι κάνει |
|---|---|
| `DISCORD_BOT_TOKEN`, `CLIENT_ID` | απαραίτητα |
| `BOT_OWNER_ID` | ειδοποιήσεις βλάβης σε DM + δικαιώματα ιδιοκτήτη |
| `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET` | είσοδος στο dashboard |
| `IDLE_MUSIC_URL` | πηγή 24/7 ραδιοφώνου — **προτίμησε Icecast από YouTube** |
| `YT_COOKIE`, `YT_COOKIES_FILE` | για datacenter IPs· **διαφορετικές μορφές** |
| `ATTACHMENT_MAX_MB` | όριο ανά αρχειοθετημένο αρχείο (default 25) |
| `LOG_LEVEL` | `error` `warn` `info` `debug` |

---

## Deployment 24/7

Πλήρης οδηγός: **[DEPLOY.md](DEPLOY.md)**. Περιληπτικά: VPS ~$12/χρόνο,
systemd με auto-restart, Cloudflare Tunnel για το dashboard, νυχτερινά backups
σε ιδιωτικό repo. Σύνολο ~10-11€/χρόνο.

```bash
sudo bash deploy/setup.sh
```

---

## Σημειώσεις

**Δύο διαδρομές ήχου.** Ο `/play` περνά από το discord-player (native encoder
mediaplex). Το ραδιόφωνο περνά από `@discordjs/voice` + prism-media, που ψάχνει
μόνο `@discordjs/opus` → `opusscript`. Χωρίς εγκατεστημένο `@discordjs/opus`
πέφτει στον JavaScript encoder — δουλεύει, αλλά καίει CPU 24 ώρες το 24ωρο.
Είναι `optionalDependency` γιατί στα Windows δεν χτίζεται χωρίς MSVC.

**Δύο μορφές cookie για το YouTube.** `YT_COOKIE` είναι raw `Cookie:` header
(για το `/play`), `YT_COOKIES_FILE` είναι αρχείο Netscape (για το yt-dlp του
ραδιοφώνου). Το μπέρδεμά τους είναι ο κλασικός λόγος που «δεν δουλεύουν τα
cookies».

**Το `ffmpeg-static` είναι devDependency.** Σε production χρησιμοποιείται το
ffmpeg του συστήματος μέσω `FFMPEG_PATH`. Ως runtime dependency προκαλούσε το
prism-media και το @discord-player/ffmpeg να επιλέγουν **διαφορετικά** binaries
στην ίδια διεργασία.
