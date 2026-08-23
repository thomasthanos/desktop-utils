const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    
    content = content.replace(/banner(-utils)?\.svg\?v=\d+/g, 'banner.svg?v=2');
    content = content.replace(/footer-author\.svg\?v=\d+/g, 'footer-author.svg?v=2');
    
    fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
            processDirectory(fullPath);
        } else if (stat.isFile() && file === 'README.md') {
            replaceInFile(fullPath);
        }
    }
}

const rootDir = 'H:/Projects/ThomasThanos/desktop-utils';
processDirectory(rootDir);