const fs = require('fs');
const path = require('path');

function removeSection(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // For root README
    content = content.replace(/## <img[^>]+icon-key\.svg[^>]+> How to use[\s\S]*?(?=<br>\s*## <img[^>]+icon-license\.svg)/, '');
    
    // For sub-project READMEs
    content = content.replace(/## <img[^>]+icon-install\.svg[^>]+> How to run[\s\S]*?(?=<br>\s*## <img[^>]+icon-license\.svg)/, '');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Removed run instructions from ' + filePath);
}

const dirs = [
  'H:/Projects/ThomasThanos/desktop-utils',
  'H:/Projects/ThomasThanos/desktop-utils/Github-Build-Release',
  'H:/Projects/ThomasThanos/desktop-utils/backup_projects',
  'H:/Projects/ThomasThanos/desktop-utils/discord_bot',
  'H:/Projects/ThomasThanos/desktop-utils/autoclicker_premium'
];

for (const d of dirs) {
    removeSection(path.join(d, 'README.md'));
}