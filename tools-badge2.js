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
  const assetsDir = path.join(d, '.github/assets');
  const svgPath = path.join(assetsDir, 'badge-license.svg');

  if (fs.existsSync(svgPath)) {
    let content = fs.readFileSync(svgPath, 'utf8');
    content = content.replace(/aria-label="code signed"/g, 'aria-label="Proprietary License"');
    
    // Nudge divider and second text to make room for "license" (7 chars vs "builds" 6 chars)
    content = content.replace(/M66 7.4v11.2/, 'M70 7.4v11.2');
    content = content.replace(/x="74"/, 'x="78"');
    
    // Expand the box slightly to fit "proprietary"
    content = content.replace(/width="133"/, 'width="143"');
    content = content.replace(/viewBox="0 0 148 26"/, 'viewBox="0 0 158 26"');
    content = content.replace(/width="146\.9"/g, 'width="156.9"');
    
    fs.writeFileSync(svgPath, content, 'utf8');
  }
}