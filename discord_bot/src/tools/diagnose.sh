#!/usr/bin/env bash
#
# Πλήρης διάγνωση: YouTube, ήχος, φωνή, δίκτυο, logs.
#
#   bash src/tools/diagnose.sh
#
# Δεν τυπώνει ΠΟΤΕ τιμές μυστικών — μόνο αν υπάρχουν και πόσο μεγάλα είναι.
# Ασφαλές να το επικολλήσεις κάπου για βοήθεια.

APP_DIR=${APP_DIR:-/opt/discord-bot}
APP_USER=${APP_USER:-discordbot}
SERVICE=${SERVICE:-discord-bot}
ENV_FILE=${ENV_FILE:-/etc/discord-bot.env}

hr()  { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
inf() { printf '    %s\n' "$*"; }

hr "1. Υπηρεσία"
state=$(systemctl is-active "$SERVICE" 2>/dev/null)
pid=$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null)
[ "$state" = "active" ] && ok "active (PID $pid)" || bad "state: $state"
systemctl show "$SERVICE" -p NRestarts -p MemoryCurrent -p MemoryMax 2>/dev/null | sed 's/^/    /'
inf "instances: $(pgrep -fc "node .*src/index.js" 2>/dev/null || echo 0)  (πρέπει να είναι 1)"

hr "2. Μεταβλητές που ΒΛΕΠΕΙ η διεργασία"
if [ -n "$pid" ] && [ "$pid" != "0" ] && [ -r "/proc/$pid/environ" ]; then
  # Τα μυστικά μόνο ως μήκος. Τα υπόλοιπα ολόκληρα.
  tr '\0' '\n' < "/proc/$pid/environ" \
  | grep -E '^(LOG_LEVEL|DEBUG_AUDIO|YT_|FFMPEG_PATH|YTDLP_PATH|IDLE_MUSIC_URL|DASHBOARD_HOST|PORT|BOT_OWNER_ID|CLIENT_ID|DISCORD_BOT_TOKEN|DASHBOARD_PASSWORD|DASHBOARD_SECRET|SPOTIFY_)' \
  | sort \
  | while IFS='=' read -r k v; do
      case "$k" in
        DISCORD_BOT_TOKEN|DASHBOARD_PASSWORD|DASHBOARD_SECRET|SPOTIFY_CLIENT_SECRET|YT_COOKIE)
          if [ -n "$v" ]; then inf "$k = [ορισμένο, ${#v} χαρακτήρες]"; else bad "$k = ΚΕΝΟ"; fi ;;
        *) inf "$k = $v" ;;
      esac
    done
else
  bad "δεν μπορώ να διαβάσω το περιβάλλον της διεργασίας"
fi

hr "3. Εκδόσεις & binaries"
inf "node    $(node -v 2>/dev/null)"
inf "ffmpeg  $(${FFMPEG_PATH:-ffmpeg} -version 2>/dev/null | head -1 | cut -c1-60)"
inf "yt-dlp  $(${YTDLP_PATH:-yt-dlp} --version 2>/dev/null)"
for p in discord-player discord-player-youtubei youtubei.js @discordjs/voice @discordjs/opus; do
  v=$(node -e "try{console.log(require('$APP_DIR/node_modules/$p/package.json').version)}catch(e){console.log('ΛΕΙΠΕΙ')}" 2>/dev/null)
  inf "$(printf '%-26s' "$p") $v"
done
n=$(ls "$APP_DIR/node_modules/discord-player-youtubei/node_modules/youtubei.js/package.json" 2>/dev/null)
[ -n "$n" ] && bad "ΥΠΑΡΧΕΙ φωλιασμένο youtubei.js — το override δεν έπιασε" \
            || ok "κανένα φωλιασμένο youtubei.js (το override έπιασε)"

hr "4. Στοίβα ήχου (@discordjs/voice)"
(cd "$APP_DIR" && node -e "console.log(require('@discordjs/voice').generateDependencyReport())" 2>&1 | sed 's/^/    /')

hr "5. YouTube: επίλυση + πραγματική ροή"
sudo -u "$APP_USER" npm --prefix "$APP_DIR" run diag:extractors 2>&1 \
  | grep -E "ready:|innerTube|validate|-> |tracks:|first:|✓|✗|ΕΞΑΙΡΕΣΗ|ΣΦΑΛΜΑ" | sed 's/^/    /'

hr "6. Δίκτυο"
inf "εξερχόμενη IPv4: $(curl -s -m 8 -4 https://api.ipify.org 2>/dev/null || echo '—')"
inf "εξερχόμενη IPv6: $(curl -s -m 8 -6 https://api64.ipify.org 2>/dev/null || echo '— (καλό: δεν προτιμά IPv6)')"
inf "discord.com    : $(getent ahosts discord.com | head -1)"
# Το voice του Discord είναι UDP. Χωρίς εξερχόμενο UDP δεν ακούγεται τίποτα,
# και ΚΑΝΕΝΑ σφάλμα δεν εμφανίζεται πουθενά.
if timeout 5 bash -c 'cat < /dev/null > /dev/udp/8.8.8.8/53' 2>/dev/null; then
  ok "εξερχόμενο UDP: επιτρέπεται"
else
  bad "εξερχόμενο UDP: ΜΠΛΟΚΑΡΙΣΜΕΝΟ — το voice δεν μπορεί να δουλέψει"
fi
inf "ufw: $(ufw status verbose 2>/dev/null | grep -i '^Default' || echo 'ανενεργό')"

hr "7. Logs — σφάλματα τελευταίας ώρας"
journalctl -u "$SERVICE" --since "1 hour ago" --no-pager -p warning 2>/dev/null | tail -25 | sed 's/^/    /'
[ -z "$(journalctl -u "$SERVICE" --since '1 hour ago' --no-pager -p warning 2>/dev/null)" ] && inf "(κανένα warning/error)"

hr "8. Logs — τελευταίες 25 γραμμές"
journalctl -u "$SERVICE" -n 25 --no-pager 2>/dev/null | sed 's/^/    /'

hr "ΤΕΛΟΣ"
cat <<'EOF'
  Για ζωντανή παρακολούθηση όσο δοκιμάζεις /play στο Discord:

      journalctl -u discord-bot -f

  Αν το LOG_LEVEL στο βήμα 2 δεν είναι debug, βάλ' το και ξαναδοκίμασε:

      sed -i 's/^LOG_LEVEL=.*/LOG_LEVEL=debug/' /etc/discord-bot.env
      systemctl restart discord-bot
EOF
