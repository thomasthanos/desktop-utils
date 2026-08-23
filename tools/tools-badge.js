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
  const oldSvgPath = path.join(assetsDir, 'badge-signed.svg');
  const newSvgPath = path.join(assetsDir, 'badge-license.svg');
  const readmePath = path.join(d, 'README.md');

  if (fs.existsSync(oldSvgPath)) {
    let content = fs.readFileSync(oldSvgPath, 'utf8');
    
    // The original text was "builds" and "code-signed"
    content = content.replace(/builds/g, 'license');
    content = content.replace(/code-signed/g, 'proprietary');
    // It says aria-label="Code-signed builds"
    content = content.replace(/Code-signed builds/g, 'Proprietary License');
    
    // Write new file and delete old
    fs.writeFileSync(newSvgPath, content, 'utf8');
    fs.unlinkSync(oldSvgPath);
    console.log('Fixed SVG in ' + assetsDir);
  }
  
  if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    readme = readme.replace(/badge-signed\.svg\?v=\d+/g, 'badge-license.svg?v=1');
    fs.writeFileSync(readmePath, readme, 'utf8');
    console.log('Fixed README in ' + d);
  }
}