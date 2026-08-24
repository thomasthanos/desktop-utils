<#
  Ανανεώνει τα cookies YouTube του bot, από το PC σου προς τον server.

    powershell -ExecutionPolicy Bypass -File tools\refresh-youtube-cookies.ps1

  ΓΙΑΤΙ ΤΡΕΧΕΙ ΕΔΩ ΚΑΙ ΟΧΙ ΣΤΟΝ SERVER: τα cookies βγαίνουν από browser με
  συνδεδεμένο λογαριασμό. Ο server δεν έχει browser, και το να στηθεί headless
  Chromium εκεί σημαίνει σύνδεση από IP datacenter — ακριβώς το μοτίβο που
  κάνει τη Google να κλειδώνει τον λογαριασμό.

  ΠΡΟΫΠΟΘΕΣΕΙΣ
    - Firefox με συνδεδεμένο τον λογαριασμό ΜΙΑΣ ΧΡΗΣΗΣ στο YouTube
    - yt-dlp.exe στο %USERPROFILE%
    - κλειδί SSH που μπαίνει στον server χωρίς κωδικό
#>

$ErrorActionPreference = 'Stop'

$Server   = 'root@38.45.65.119'
$YtDlp    = Join-Path $env:USERPROFILE 'yt-dlp.exe'
$Local    = Join-Path $env:TEMP 'yt-cookies.txt'
$Remote   = '/etc/discord-bot-cookies.txt'
$Probe    = 'https://www.youtube.com/watch?v=4xDzrJKXOOY'

if (-not (Test-Path $YtDlp)) { throw "Δεν βρέθηκε το yt-dlp.exe στο $YtDlp" }

Write-Host '1/4  Εξαγωγή cookies από Firefox...'
# Το yt-dlp τερματίζει με σφάλμα στο κατέβασμα· το αρχείο γράφεται πριν από αυτό,
# οπότε δεν κοιτάμε τον κωδικό εξόδου αλλά το ΑΡΧΕΙΟ.
& $YtDlp --cookies-from-browser firefox --cookies $Local --skip-download $Probe *> $null

if (-not (Test-Path $Local)) { throw 'Δεν παρήχθη αρχείο cookies. Είναι ο Firefox συνδεδεμένος στο YouTube;' }
$lines = (Get-Content $Local | Where-Object { $_ -and -not $_.StartsWith('#') }).Count
if ($lines -lt 10) { throw "Μόνο $lines cookies — η εξαγωγή δεν είναι σωστή. Ο server ΔΕΝ πειράχτηκε." }
Write-Host "     $lines cookies"

Write-Host '2/4  Αποστολή στον server...'
& scp -o BatchMode=yes $Local "${Server}:$Remote"
if ($LASTEXITCODE -ne 0) { throw 'Απέτυχε το scp.' }

Write-Host '3/4  Ανανέωση ρύθμισης και επανεκκίνηση...'
& ssh -o BatchMode=yes $Server "chmod 600 $Remote && cd /opt/discord-bot && node src/tools/cookies-to-env.js && systemctl restart discord-bot"
if ($LASTEXITCODE -ne 0) { throw 'Απέτυχε η ανανέωση στον server.' }

Write-Host '4/4  Έλεγχος...'
Start-Sleep -Seconds 20
& ssh -o BatchMode=yes $Server "journalctl -u discord-bot --since '-2 min' --no-pager | grep -E 'auth=|Idle radio resumed|Could not resume' | tail -3"

Remove-Item $Local -Force -ErrorAction SilentlyContinue
Write-Host 'Έτοιμο.'
