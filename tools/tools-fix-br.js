const fs = require('fs');
const path = require('path');

const dirs = [
  'H:/Projects/ThomasThanos/desktop-utils',
  'H:/Projects/ThomasThanos/desktop-utils/Github-Build-Release',
  'H:/Projects/ThomasThanos/desktop-utils/backup_projects',
  'H:/Projects/ThomasThanos/desktop-utils/discord_bot',
  'H:/Projects/ThomasThanos/desktop-utils/autoclicker_premium'
];

for (const d of dirs) {
    const filePath = path.join(d, 'README.md');
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/<br>\s*<br>/g, '<br>');
    fs.writeFileSync(filePath, content, 'utf8');
}