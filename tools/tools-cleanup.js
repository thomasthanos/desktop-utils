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
  const readmePath = path.join(d, 'README.md');
  const assetsDir = path.join(d, '.github/assets');
  
  if (fs.existsSync(readmePath) && fs.existsSync(assetsDir)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    
    const matches = readmeContent.match(/\.github\/assets\/([^"?)>]+\.svg)/g);
    const usedSvgs = new Set();
    if (matches) {
      for (const m of matches) {
        usedSvgs.add(path.basename(m));
      }
    }
    
    const assetFiles = fs.readdirSync(assetsDir);
    let deletedCount = 0;
    for (const file of assetFiles) {
      if (file.endsWith('.svg') && !usedSvgs.has(file)) {
        fs.unlinkSync(path.join(assetsDir, file));
        deletedCount++;
      }
    }
    console.log('Cleaned up ' + deletedCount + ' unused SVGs from ' + d);
  }
}