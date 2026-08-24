# Deployment — 24/7 στον VPS

Οδηγός από το μηδέν μέχρι bot που τρέχει μόνο του. Χρόνος: ~45 λεπτά.

---

## 0. Ο server

**Little Creek «Micro VPS - Special»** — 1 CPU, 2GB RAM, 25GB NVMe, 2TB/μήνα,
KVM, $12/χρόνο.

Επιβεβαιωμένο από τον πάροχο:

- **Λειτουργικό:** διαθέσιμα Ubuntu 22.04 και 24.04 → **διάλεξε 24.04**
  (υποστήριξη μέχρι το 2029, και αυτό προϋποθέτει το `setup.sh`).
- **Τοποθεσία:** Durham, North Carolina. **Μετακόμιση σε Richmond, Virginia
  την 1η Ιανουαρίου 2027.**

### Τι σημαίνει η αμερικανική τοποθεσία

Το bot **στέλνει** ήχο, δεν συνομιλεί: διαβάζει ένα stream και σπρώχνει πακέτα
Opus προς τον voice server του Discord. Τα ~100ms υπερατλαντικής καθυστέρησης
προστίθενται στο «/play → ακούγεται», που ήδη παίρνει δευτερόλεπτα λόγω της
ανάλυσης του yt-dlp. Η καθυστέρηση από μόνη της **δεν** προκαλεί τραύλισμα —
αυτό το προκαλούν το jitter και η απώλεια πακέτων.

Αν ακούσεις κοψίματα, έλεγξε **πρώτα** το `npm run smoke` για το
`@discordjs/opus`: ο JavaScript encoder είναι πολύ πιθανότερη αιτία από τη
γεωγραφία. Το τεστ των 30 λεπτών στο βήμα 7 είναι εκεί ακριβώς γι' αυτό.

### Η μετακόμιση του Ιανουαρίου 2027

Σχεδόν αδιάφορη, χάρη στο Cloudflare Tunnel: συνδέεται **από μέσα προς τα
έξω**, οπότε το `dash.thomast.uk` δεν είναι δεμένο σε καμία IP. Αλλάζει η IP →
το tunnel ξανασυνδέεται μόνο του. (Με ανοιχτή πόρτα και DNS A record θα έπρεπε
να το κυνηγήσεις.)

Τι χρειάζεται όντως:

- **Νέα IP για SSH** — ζήτα την από τον πάροχο ή δες τη στο panel.
- **Διακοπή κατά τη μετάβαση** — ρώτα τους πόση θα είναι και αν μεταφέρουν το
  VM ή πρέπει να ξαναστήσεις. Αν είναι το δεύτερο: `deploy/setup.sh` +
  επαναφορά του τελευταίου backup, ~20 λεπτά.
- **Το backup να είναι εκτός μηχανήματος** πριν την ημερομηνία (βλ. §8).

---

## 1. Πρώτη σύνδεση

```bash
ssh root@<IP-του-server>
```

**Στον server** — βάλε το δημόσιο κλειδί σου (`type .ssh\id_ed25519.pub` στα
Windows για να το δεις):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<το ssh public key σου>" > ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> Από **δεύτερο** παράθυρο στα Windows επιβεβαίωσε ότι `ssh root@<IP>` μπαίνει
> **χωρίς κωδικό**, πριν προχωρήσεις. Αλλιώς κλειδώνεσαι έξω.

Μετά κλείσε το login με κωδικό. **Προσοχή:** σκέτο `sed` στο `sshd_config`
**δεν αρκεί** στο Ubuntu 22.04+ — το `Include /etc/ssh/sshd_config.d/*.conf`
βρίσκεται στην κορυφή του αρχείου και ο sshd κρατάει την **πρώτη** τιμή που θα
βρει, οπότε το `50-cloud-init.conf` του παρόχου (που γράφει
`PasswordAuthentication yes`) κερδίζει σιωπηλά:

```bash
mkdir -p /etc/ssh/sshd_config.d
sed -i -E 's/^[[:space:]]*#?[[:space:]]*(PasswordAuthentication)[[:space:]]+.*/\1 no/I' /etc/ssh/sshd_config.d/*.conf 2>/dev/null
printf 'PasswordAuthentication no\nPubkeyAuthentication yes\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-hardening.conf
sshd -t && systemctl restart ssh
sshd -T | grep -iE '^(passwordauthentication|pubkeyauthentication|permitrootlogin)'
```

Το `sshd -t` ελέγχει τη σύνταξη **πριν** το restart. Πρέπει να δεις
`passwordauthentication no` — αν δεις `yes`, κάτι άλλο το επιβάλλει, ψάξ' το με
`grep -rn -i passwordauthentication /etc/ssh/`.

Και οι ενημερώσεις, όσο είσαι εδώ (τα fresh images έχουν εκατοντάδες):

```bash
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -qq && apt-get upgrade -y && apt-get autoremove -y
[ -f /var/run/reboot-required ] && reboot
```

---

## 2. Deploy key (το repo είναι ιδιωτικό)

Ο server δεν μπορεί να κατεβάσει ιδιωτικό repo χωρίς διαπιστευτήρια. Δίνουμε
**deploy key**: κλειδί μόνο για ανάγνωση, δεμένο μόνο σε αυτό το repo — όχι
token του λογαριασμού, που θα έδινε στον server πρόσβαση σε ό,τι έχεις.

Στον server:

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/deploy_key -C "bot-vps-deploy"
cat /root/.ssh/deploy_key.pub
```

Πρόσθεσέ το στο GitHub — από τον υπολογιστή σου:

```bash
gh repo deploy-key add <αρχείο-με-το-public-key> --repo thomasthanos/discord-dashboard-bot --title "bot-vps"
```

(ή χειροκίνητα: repo → Settings → Deploy keys → Add deploy key, **χωρίς** write access)

Πες στο git να το χρησιμοποιεί, στον server:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/deploy_key
  IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config
ssh -T git@github.com   # "Hi ...! You've successfully authenticated" = εντάξει
```

---

## 3. Εγκατάσταση

```bash
git clone git@github.com:thomasthanos/discord-dashboard-bot.git /tmp/bot-setup
sudo bash /tmp/bot-setup/deploy/setup.sh
```

Το script είναι επαναληπτικό — αν κάτι σκάσει, το ξανατρέχεις. Κάνει:
swap 2GB · Node 22 LTS · ffmpeg · static yt-dlp · χρήστη `discordbot` ·
κώδικα στο `/opt/discord-bot` · `npm ci` · systemd units και timers ·
ufw με ανοιχτή **μόνο** τη θύρα 22.

Θα προειδοποιήσει ότι λείπει το αρχείο μυστικών — αυτό είναι το επόμενο βήμα.

---

## 4. Μυστικά

**Πρώτα κάνε reset το Discord token** (Developer Portal → Bot → Reset Token),
ώστε το token που φεύγει προς τον server να έχει καθαρή ιστορία.

```bash
sudo nano /etc/discord-bot.env
```

```ini
DISCORD_BOT_TOKEN=<το ΝΕΟ token>
CLIENT_ID=<Application ID>
BOT_OWNER_ID=<το Discord ID σου>

DASHBOARD_PASSWORD=<δικός σου κωδικός>
DASHBOARD_SECRET=<γέννησέ το με την εντολή παρακάτω>
DASHBOARD_HOST=127.0.0.1
PORT=3000

FFMPEG_PATH=/usr/bin/ffmpeg
YTDLP_PATH=/usr/local/bin/yt-dlp

# Icecast αντί για YouTube: μηδενικός έλεγχος bot, δεν σπάει από datacenter IP.
IDLE_MUSIC_URL=https://ice1.somafm.com/groovesalad-256-mp3

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
LOG_LEVEL=info
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
sudo chmod 600 /etc/discord-bot.env && sudo chown root:root /etc/discord-bot.env
```

> Το `.env` **ποτέ** δεν ανεβαίνει σε git και ποτέ δεν γίνεται scp. Τα μυστικά
> ζουν μόνο εδώ.

---

## 5. Εκκίνηση

```bash
sudo systemctl enable --now discord-bot
journalctl -u discord-bot -f
```

Περίμενε να δεις `Logged in as <όνομα>`.

---

## 6. Dashboard μέσω Cloudflare Tunnel

Το dashboard ακούει **μόνο** στο `127.0.0.1`. Καμία πόρτα δεν ανοίγει προς το
internet — το tunnel συνδέεται από μέσα προς τα έξω.

**6.1** Βάλε το `thomast.uk` στο Cloudflare (αλλαγή nameservers στον registrar).

**6.2** Στον server:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
cloudflared tunnel login
cloudflared tunnel create discord-bot
cloudflared tunnel route dns discord-bot dash.thomast.uk
```

**6.3** `/etc/cloudflared/config.yml`:

```yaml
tunnel: discord-bot
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: dash.thomast.uk
    service: http://127.0.0.1:3000
  - service: http_status:404
```

**6.4**

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Άνοιξε `https://dash.thomast.uk` → σελίδα login → βάλε το `DASHBOARD_PASSWORD`.

> Το login μένει ούτως ή άλλως: το tunnel δίνει **διεύθυνση**, όχι έλεγχο πρόσβασης.

### 6.5 Σύνδεση με Discord (χρειάζεται για τον έλεγχο μουσικής)

Ο κωδικός δείχνει τα πάντα αλλά **δεν** χειρίζεται μουσική: τα κουμπιά
απαιτούν να βρίσκεσαι σε voice κανάλι εκείνου του server, και ο κωδικός δεν
λέει στο dashboard ποιος είσαι. Αυτό το λύνει η σύνδεση με Discord.

**α)** Discord Developer Portal → η εφαρμογή σου → **OAuth2** → αντίγραψε
`Client ID` και `Client Secret`.

**β)** Στο ίδιο σημείο, **Redirects** → `Add Redirect`, ακριβώς αυτό:

```
https://dash.thomast.uk/auth/discord/callback
```

Πρέπει να ταιριάζει **χαρακτήρα προς χαρακτήρα** με το `DASHBOARD_URL` — μία
παραπανίσια κάθετος και το Discord απαντά `invalid_request`.

**γ)** Στο `/etc/discord-bot.env`:

```bash
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DASHBOARD_URL=https://dash.thomast.uk
```

Το `DISCORD_CLIENT_SECRET` είναι **διαπιστευτήριο**: μένει μόνο εκεί, με
`chmod 600`, ποτέ στο git — όπως το `YT_COOKIE`.

**δ)** Ποιος μπαίνει: όποιος είναι στο `BOT_OWNER_ID`, συν ό,τι βάλεις στο
`DASHBOARD_ALLOWED_USERS` (κόμματα). **Αν και τα δύο είναι κενά, η σύνδεση με
Discord μένει σβηστή επίτηδες** — αλλιώς θα έμπαινε οποιοσδήποτε λογαριασμός
Discord στον πλανήτη. Το log στην εκκίνηση το λέει καθαρά.

**ε)** `sudo systemctl restart discord-bot`. Στα logs πρέπει να δεις:

```
INFO [dashboard] Discord login enabled for 1 account(s). Redirect URI: https://dash.thomast.uk/auth/discord/callback
```

Κράτα και τον `DASHBOARD_PASSWORD`: αν κάτι στραβώσει στο OAuth, μπαίνεις με
κωδικό και το διορθώνεις χωρίς να κλειδωθείς έξω.

### 6.6 Ποιος βλέπει τι

Το dashboard **δεν** έχει δικούς του ρόλους: διαβάζει αυτούς του Discord, ανά server.
Μπαίνει όποιος έχει **Manage Server** σε τουλάχιστον έναν server που έχει το bot, και
βλέπει **μόνο** αυτούς τους servers. Το `BOT_OWNER_ID` τα βλέπει όλα.

| Ενότητα | Τι χρειάζεται |
|---|---|
| Επισκόπηση, στατιστικά | Manage Server |
| Έλεγχος μουσικής | Manage Server **και** να είσαι σε voice κανάλι εκείνου του server |

Ο κανόνας του voice **δεν είναι μόνο του dashboard**: ισχύει και για τις εντολές στο
Discord (`/skip`, `/stop`, `/volume`, `/pause`, `/247`…). Δεν μετράει το AFK κανάλι,
ούτε όποιος είναι server-deafened. Το `/queue` και το `/nowplaying` μένουν ανοιχτά —
δεν αλλάζουν τίποτα.

| Ιστορικό εντολών | Manage Server |
| Προσκλήσεις | Manage Server |
| **Ιστορικό διαγραφών** (πλήρες κείμενο μηνυμάτων) | **Administrator** |
| Σελίδα «Δικαιώματα» | **Administrator** |

Για εξαιρέσεις υπάρχει η σελίδα **Δικαιώματα**: ανά άτομο και ανά ενότητα διαλέγεις
«Κληρονομιά» (ό,τι λέει ο ρόλος), «Ναι» ή «Όχι». Οι εξαιρέσεις ισχύουν **μόνο για τον
συγκεκριμένο server** και **ποτέ** για το `BOT_OWNER_ID` — δεν γίνεται να κλειδωθείς έξω
από το ίδιο σου το bot.

> **Ο κωδικός είναι εφεδρεία, όχι δεύτερος λογαριασμός.** Μια συνεδρία μόνο με
> `DASHBOARD_PASSWORD` βλέπει τα πάντα, **συμπεριλαμβανομένων των διαγραμμένων
> μηνυμάτων**, ώστε να μπορείς να ξεμπλοκάρεις μια χαλασμένη ρύθμιση OAuth. Δεν
> ελέγχει μουσική, γιατί χωρίς ταυτότητα Discord δεν γίνεται να επαληθευτεί το voice.
> Αν σε ενοχλεί, σβήσε το `DASHBOARD_PASSWORD` αφού βεβαιωθείς ότι το Discord login
> δουλεύει.

---

## 7. Επαλήθευση

```bash
npm --prefix /opt/discord-bot run smoke
```

Πρέπει να δείξει `@discordjs/opus` **παρόν** (στα Windows έλειπε — εδώ είναι το
σημείο που το 24/7 ραδιόφωνο περνά σε native encoder).

```bash
# Ακούει ΜΟΝΟ τοπικά; Δεν πρέπει να δεις ποτέ 0.0.0.0:3000
ss -lntp | grep node

# Επιβιώνει σε crash;
sudo kill -9 $(systemctl show -p MainPID --value discord-bot); sleep 8
systemctl is-active discord-bot

# Επιβιώνει σε reboot;
sudo reboot
```

Μετά το reboot: το bot online, **ξαναμπαίνει μόνο του** στο voice channel και
ξαναρχίζει το ραδιόφωνο.

Στο Discord: `/play`, `/queue`, `/skip`, `/pause`, `/nowplaying`, `/volume 30`,
`/idlemusic`. **Άσε το ραδιόφωνο 30 λεπτά** — αυτός ο κύκλος είναι όλο το νόημα.

```bash
# Δοκιμή επαναφοράς — ένα backup που δεν το έχεις επαναφέρει δεν είναι backup
sudo systemctl start discord-bot-backup.service
sqlite3 /opt/discord-bot/backups/bot-$(date +%F).db \
  "PRAGMA integrity_check; SELECT COUNT(*) FROM clear_logs;"
```

---

## 8. Καθημερινή χρήση

| Τι θέλεις | Εντολή |
|---|---|
| Logs ζωντανά | `journalctl -u discord-bot -f` |
| Μόνο προβλήματα | `journalctl -u discord-bot -p warning --since today` |
| Ενημέρωση κώδικα | `cd /opt/discord-bot && sudo -u discordbot git pull && sudo -u discordbot npm ci --omit=dev && sudo systemctl restart discord-bot` |
| Επανεκκίνηση | `sudo systemctl restart discord-bot` |
| Χρήση μνήμης | `systemd-cgtop -1 --depth=1` |
| Χειροκίνητο backup | `sudo systemctl start discord-bot-backup.service` |
| Χρονοδιαγράμματα | `systemctl list-timers` |

### Εντολές στα DM: περίμενε έως μία ώρα

Οι εντολές που δουλεύουν σε DM (`/help`) καταχωρούνται **καθολικά**, όχι ανά
server — οι guild εντολές δεν εμφανίζονται ποτέ σε ιδιωτική συνομιλία. Το
Discord διαδίδει τις καθολικές εντολές **έως και μία ώρα** την πρώτη φορά.

Δηλαδή: μετά το πρώτο deploy, γράφεις `/` στο DM του bot και δεν βλέπεις
τίποτα. **Δεν έχει σπάσει.** Έλεγξε ότι η καταχώρηση όντως έγινε:

```bash
journalctl -u discord-bot | grep "in DMs"
```

Αν δεις `Slash commands unchanged — skipping registration` ενώ πρόσθεσες
εντολή DM, τότε υπάρχει πρόβλημα: το `commands_hash` περιλαμβάνει πλέον και τις
εντολές DM ακριβώς για να μη συμβαίνει αυτό.

Αν εμφανιστούν **διπλές** εντολές μέσα σε server, τρέξε μία φορά με
`CLEAR_GLOBAL_COMMANDS=1` και μετά ξαναβγάλ' το.

### Backups εκτός μηχανήματος (δωρεάν)

Φτιάξε ιδιωτικό repo `discord-bot-backups`, πρόσθεσε deploy key με δικαίωμα
εγγραφής, και βάλε στο `/etc/discord-bot.env`:

```ini
BACKUP_GIT_REMOTE=git@github.com:thomasthanos/discord-bot-backups.git
```

~2MB τη νύχτα, 14 ημέρες διατήρηση. Τα attachments **δεν** ανεβαίνουν — είναι
εκατοντάδες MB και υπάρχουν ήδη στο CDN του Discord.

---

## 9. Όταν σταματήσει να παίζει YouTube

Το πιο πιθανό πρόβλημα μετά τη μεταφορά. Το YouTube μπλοκάρει τα datacenter IPs.

**Διάγνωση:**

```bash
journalctl -u discord-bot | grep YT_AUTH_EXPIRED
```

Θα λάβεις και DM. Με τη σειρά, σταμάτα μόλις δουλέψει:

**9.1 — Δώσε ταυτότητα με cookies.** Αυτή είναι η **βασική λύση**, μετρημένη.

Στο PC σου, με **Firefox** συνδεδεμένο στο YouTube με λογαριασμό **μιας
χρήσης** (το Chrome/Edge κρυπτογραφούν τα cookies από την έκδοση 127 και η
εξαγωγή σπάει):

```powershell
powershell -ExecutionPolicy Bypass -File local/refresh-youtube-cookies.ps1
```

Κάνει τα πάντα: εξαγωγή, αποστολή, παραγωγή του `YT_COOKIE`, restart, έλεγχο.
Για αυτόματη ημερήσια ανανέωση, βλ. §9.1γ.

**Γιατί cookies και όχι OAuth.** Δοκιμάστηκαν και τα δύο στον ίδιο server:

| | αποτέλεσμα |
|---|---|
| OAuth (`generateOauthTokens`) | συνδέεται (`logged_in = true`), αλλά το endpoint αναπαραγωγής απαντά **400 σε κάθε client** |
| Cookies | περνάει καθαρά, **HLS manifest σε WEB/TV/MWEB/IOS/ANDROID** |

Ο κώδικας δέχεται και τα δύο (`YT_OAUTH`, `YT_COOKIE`) και ανοίγει την
αυθεντικοποιημένη διαδρομή με όποιο υπάρχει — αλλά **μόνο τα cookies
δουλεύουν σήμερα**. Το τίμημά τους: λήγουν, γι' αυτό υπάρχει το §9.1γ.

**9.1γ — Αυτόματη ανανέωση.** Scheduled Task στο PC σου, μία φορά τη μέρα:

```powershell
$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File H:/Projects/ThomasThanos/discord-dashboard-bot/local/refresh-youtube-cookies.ps1"
$t = New-ScheduledTaskTrigger -Daily -At 9am
Register-ScheduledTask -TaskName "YouTube cookies -> discord bot" -Action $a -Trigger $t
```

Ο server δεν μπορεί να το κάνει μόνος του: δεν έχει browser, και μια σύνδεση
στη Google από IP datacenter είναι ακριβώς αυτό που κλειδώνει λογαριασμούς.

**9.1β — Άλλαξε τον InnerTube client.** Ήταν κάποτε η βασική λύση, με το
`TV_EMBEDDED` να περνάει χωρίς λογαριασμό. **Δεν ισχύει πια**: μετρήθηκε ότι
κάθε τιμή απορρίπτεται με «Sign in to confirm you're not a bot». Μένει εδώ
γιατί δεν βλάπτει και ίσως ξαναδουλέψει. Δες ποιοι περνάνε από τη δική σου IP:

```bash
V=https://www.youtube.com/watch?v=dQw4w9WgXcQ
for c in tv_embedded android_vr tv_simply ios web_safari mweb tv; do
  printf '%-12s ' "$c"
  timeout 25 yt-dlp --extractor-args "youtube:player_client=$c" --no-warnings --skip-download --print "%(title)s" "$V" 2>&1 | head -1
done
```

Όποιος επιστρέψει τίτλο δουλεύει — **κεφαλαία** για το `/play`, **πεζά** για
το yt-dlp:

```ini
YT_CLIENT=TV_EMBEDDED
YTDLP_EXTRACTOR_ARGS=youtube:player_client=tv_embedded,android_vr
```

**9.2 — Το ραδιόφωνο να μη χρησιμοποιεί καθόλου YouTube.** Αν το
`IDLE_MUSIC_URL` δείχνει ακόμα σε YouTube, βάλε Icecast. Ίδιο ffmpeg pipeline,
μηδενικός έλεγχος bot.

**9.3 — Ήδη ενεργά:** PoToken και εφεδρική διαδρομή yt-dlp
(`YT_POTOKEN=0` / `YT_USE_YTDLP=0` για απενεργοποίηση).

**9.4 — Ενημέρωσε το yt-dlp** (γίνεται εβδομαδιαία μόνο του, αλλά μετά από
αλλαγή του YouTube μπορεί να θες άμεσα):

```bash
sudo systemctl start yt-dlp-update.service
```

**9.5 — Cookies. Τελευταία λύση, όχι πρώτη.**

> ⚠️ **Τα YouTube cookies λήγουν σε 3-5 μέρες**, ακόμα κι από ανώνυμο παράθυρο —
> το YouTube τα περιστρέφει επίτηδες. Δεν υπάρχει ασφαλής αυτόματη ανανέωση από
> server. Το OAuth (`generateOauthTokens`) **δεν δουλεύει πια** — το ίδιο το
> `discord-player-youtubei` συνιστά πλέον cookies αντ' αυτού.
>
> Γι' αυτό το 9.1 είναι πρώτο: δεν λήγει ποτέ.

Αν παρ' όλα αυτά τα χρειαστείς: λογαριασμός **μιας χρήσης**, ποτέ ο προσωπικός
σου. Σύνδεση σε **ανώνυμο παράθυρο** → youtube.com → εξαγωγή cookies →
**κλείσε το παράθυρο χωρίς αποσύνδεση** (η αποσύνδεση ακυρώνει αμέσως το
session — ο Νο1 λόγος που «δεν δουλεύουν»).

Δύο διαδρομές, **δύο διαφορετικές μορφές**:

```ini
# /play  → raw Cookie header, μία γραμμή
YT_COOKIE=name=value; name2=value2
# ραδιόφωνο → αρχείο Netscape cookies.txt
YT_COOKIES_FILE=/opt/discord-bot/data/yt-cookies.txt
```

```bash
sudo chown discordbot:discordbot /opt/discord-bot/data/yt-cookies.txt
sudo chmod 600 /opt/discord-bot/data/yt-cookies.txt
```

**9.6 — Cloudflare WARP** μόνο για την κίνηση YouTube. Τα IP του WARP είναι κι
αυτά συχνά μπλοκαρισμένα — μπορεί να χειροτερέψει. Δοκίμασε, μην το υποθέσεις.
**Ποτέ** μην περνάς την κίνηση voice από proxy.

**9.7 — Αν τίποτα δεν δουλεύει:** η μόνη πραγματικά μόνιμη λύση για datacenter
IP είναι residential proxy (30-90$/μήνα, εκτός budget). Η εναλλακτική είναι
άλλη πηγή που δεν μπλοκάρει — SoundCloud· μικρότερος κατάλογος, μηδενική
συντήρηση.

---

## 10. Αντιμετώπιση προβλημάτων

| Σύμπτωμα | Αιτία / λύση |
|---|---|
| Το service κάνει βρόχο επανεκκίνησης | `journalctl -u discord-bot -n 50`. Μετά από 5 αποτυχίες σε 5 λεπτά το systemd σταματά — συνήθως λάθος token. `systemctl reset-failed discord-bot` μετά τη διόρθωση. |
| `Port 3000 is already in use` | Σκόπιμο: πεθαίνει αντί να μετακινηθεί σιωπηλά σε άλλη πόρτα και να χαλάσει το tunnel. `ss -lntp \| grep 3000` |
| Ο ήχος τραυλίζει | `npm run smoke`. Αν το `@discordjs/opus` λείπει, το ραδιόφωνο τρέχει σε JavaScript encoder: `cd /opt/discord-bot && sudo -u discordbot npm rebuild @discordjs/opus` |
| Το dashboard δεν κάνει login | Σε http χωρίς HTTPS ο browser απορρίπτει σιωπηλά το cookie `Secure`. Πίσω από το tunnel υπάρχει HTTPS. Για τοπική δοκιμή μόνο: `DASHBOARD_COOKIE_SECURE=0` |
| «Refusing to start: DASHBOARD_HOST…» | Σκόπιμο: δικτυακά προσβάσιμο **χωρίς** κωδικό. Βάλε `DASHBOARD_PASSWORD` ή γύρνα στο `127.0.0.1`. |
| Γεμάτος δίσκος | Θα πάρεις DM στο 85%. `du -sh /opt/discord-bot/data/*` και χαμήλωσε `ATTACHMENT_MAX_TOTAL_MB`. |
| Το bot μένει στο voice μετά από restart | Δεν πρέπει πλέον — αν συμβεί, το `TimeoutStopSec` έληξε. Δες `journalctl` για `Teardown timed out`. |
| Το bot δεν φεύγει από άδειο κανάλι | Έλεγξε το `/247` — αν είναι ενεργό, αυτό ακριβώς κάνει. Αλλιώς `VOICE_EMPTY_GRACE_MS` (προεπιλογή 5 λεπτά). |
| Η `/ask` λέει «Δεν μπορώ να απαντήσω τώρα» | Το AI απέτυχε και έπεσε στον εφεδρικό router — **δεν** είναι κατάρρευση. `npm run diag:ai` για τον λόγο. Συνήθως 404 = λάθος `AI_MODEL`. |
| `AI provider returned 404` | Το μοντέλο δεν υπάρχει για αυτό το κλειδί. **Μη μαντεύεις όνομα:** `sudo node src/tools/diag-ai.js` τυπώνει τι δέχεται όντως και προτείνει τιμή για το `AI_MODEL`. |
| Το `diag:ai` λέει «ΔΕΝ ΕΧΕΙ ΟΡΙΣΤΕΙ» ενώ το bot δουλεύει | Τα διαγνωστικά θέλουν **root**: το `/etc/discord-bot.env` είναι `600 root:root`, οπότε ως `discordbot` δεν διαβάζεται. `sudo node src/tools/diag-ai.js` |

---

## Τι κοστίζει

| | |
|---|---|
| VPS (1 CPU, 2GB RAM, 25GB NVMe) | $12/χρόνο |
| Domain `thomast.uk` | το έχεις ήδη |
| Cloudflare Tunnel, backups, TLS | 0€ |
| **Σύνολο** | **~10-11€/χρόνο** |
