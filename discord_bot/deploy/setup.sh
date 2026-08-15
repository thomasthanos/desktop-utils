#!/usr/bin/env bash
#
# Στήσιμο του server, από την αρχή. Επαναληπτικό — ασφαλές να ξανατρέξει.
#
#   sudo bash deploy/setup.sh
#
# Τι κάνει:
#   - πακέτα συστήματος, Node 22 LTS, ffmpeg, static yt-dlp
#   - 2GB swap (το node-gyp θέλει >512MB για να χτίσει το better-sqlite3)
#   - χρήστη discordbot χωρίς δικαίωμα σύνδεσης
#   - το repo στο /opt/discord-bot, npm ci, έλεγχο υγείας
#   - systemd units και timers
#   - ufw με ανοιχτή ΜΟΝΟ τη θύρα 22
#
# Τι ΔΕΝ κάνει: δεν γράφει τα μυστικά. Το /etc/discord-bot.env το φτιάχνεις με
# το χέρι (βλ. DEPLOY.md) ώστε να μην περάσουν ποτέ από ιστορικό εντολών.

set -euo pipefail

APP_DIR=/opt/discord-bot
APP_USER=discordbot
ENV_FILE=/etc/discord-bot.env
# Το repo είναι ιδιωτικό, οπότε το HTTPS URL θα ζητούσε διαπιστευτήρια. Το SSH
# URL δουλεύει με deploy key — κλειδί μόνο για ανάγνωση, μόνο για αυτό το repo
# (βλ. DEPLOY.md §2). Παρακάμπτεται με REPO=... bash deploy/setup.sh
REPO="${REPO:-git@github.com:thomasthanos/discord-dashboard-bot.git}"
NODE_MAJOR=22

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m !  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m ✗  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."

# --- 1. swap ----------------------------------------------------------------
# Πριν από το npm ci: η μεταγλώττιση native modules ξεπερνά εύκολα τη μνήμη
# ενός μικρού VPS και ο OOM killer δίνει εντελώς παραπλανητικά σφάλματα.
log "Swap"
if swapon --show | grep -q '/swapfile'; then
  echo "already active"
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2GB swap enabled"
fi
sysctl -qw vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

# --- 2. πακέτα --------------------------------------------------------------
log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential + python3: χρειάζονται μόνο αν δεν υπάρχει έτοιμο prebuild
# για better-sqlite3 / @discordjs/opus. Η απουσία τους μετατρέπει ένα
# λειτουργικό npm ci σε δυσνόητη αποτυχία.
apt-get install -y -qq \
  build-essential python3 ffmpeg git curl ca-certificates sqlite3 ufw

# --- 3. Node 22 LTS ---------------------------------------------------------
log "Node.js ${NODE_MAJOR} LTS"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# --- 4. yt-dlp static -------------------------------------------------------
# Το youtube-dl-exec κατεβάζει το Python zipapp, που απαιτεί εγκατεστημένη
# Python και αποτυγχάνει με μπερδεμένο μήνυμα. Το static binary δεν χρειάζεται.
log "yt-dlp (static binary)"
case "$(uname -m)" in
  x86_64)  YTDLP_ASSET=yt-dlp_linux ;;
  aarch64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;;
  *)       die "Unsupported architecture: $(uname -m)" ;;
esac
curl -fsSL -o /usr/local/bin/yt-dlp \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}"
chmod +x /usr/local/bin/yt-dlp
echo "yt-dlp $(/usr/local/bin/yt-dlp --version)"

# --- 5. χρήστης -------------------------------------------------------------
log "Service user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
echo "$APP_USER ready"

# --- 6. κώδικας -------------------------------------------------------------
log "Application code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin
  git -C "$APP_DIR" reset --quiet --hard origin/main
else
  git clone --quiet "$REPO" "$APP_DIR"
fi
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Το clone γίνεται ως root, αλλά οι ενημερώσεις τρέχουν ως discordbot — που
# χωρίς πρόσβαση στο deploy key θα αποτύγχανε στο πρώτο `git pull`. Δίνουμε
# αντίγραφο μόνο για ανάγνωση στον χρήστη της υπηρεσίας.
if [ -f /root/.ssh/deploy_key ]; then
  APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/deploy_key "$APP_HOME/.ssh/deploy_key"
  cat > "$APP_HOME/.ssh/config" <<EOF
Host github.com
  IdentityFile $APP_HOME/.ssh/deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chown "$APP_USER:$APP_USER" "$APP_HOME/.ssh/config"
  chmod 600 "$APP_HOME/.ssh/config"
  echo "deploy key provisioned for $APP_USER"
fi

log "Dependencies"
# --omit=dev: το ffmpeg-static (80MB) είναι devDependency· εδώ χρησιμοποιούμε
# το ffmpeg του συστήματος.
sudo -u "$APP_USER" YOUTUBE_DL_SKIP_DOWNLOAD=true npm --prefix "$APP_DIR" ci --omit=dev --no-audit --no-fund

# --- 7. έλεγχος υγείας ------------------------------------------------------
log "Health check"
if [ -f "$ENV_FILE" ]; then
  sudo -u "$APP_USER" env FFMPEG_PATH=/usr/bin/ffmpeg YTDLP_PATH=/usr/local/bin/yt-dlp \
    npm --prefix "$APP_DIR" run smoke || warn "Smoke test reported problems — read the output above."
else
  warn "$ENV_FILE does not exist yet. Create it before starting the service (see DEPLOY.md)."
fi

# --- 8. systemd -------------------------------------------------------------
log "systemd units"
install -m 644 "$APP_DIR/deploy/discord-bot.service"        /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/discord-bot-backup.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/discord-bot-backup.timer"   /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/yt-dlp-update.service"      /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/yt-dlp-update.timer"        /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now discord-bot-backup.timer yt-dlp-update.timer
echo "timers enabled"

# --- 9. journald ------------------------------------------------------------
log "Log retention"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-discord-bot.conf <<'EOF'
[Journal]
SystemMaxUse=200M
MaxRetentionSec=2week
EOF
systemctl restart systemd-journald

# --- 10. firewall -----------------------------------------------------------
# Το dashboard δένει στο 127.0.0.1 και βγαίνει μέσω Cloudflare Tunnel, οπότε
# ΔΕΝ ανοίγουμε τη θύρα 3000. Αυτό είναι σκόπιμο.
log "Firewall"
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -n 5

log "Done"
cat <<EOF

Next steps:
  1. Create $ENV_FILE (chmod 600, owned by root) — see DEPLOY.md.
  2. sudo systemctl enable --now discord-bot
  3. journalctl -u discord-bot -f
  4. Set up the Cloudflare tunnel for dash.thomast.uk — see DEPLOY.md.

EOF
