const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    for (const [search, replace] of replacements) {
        // Use a global RegExp or string split/join for all occurrences
        const newContent = content.split(search).join(replace);
        if (newContent !== content) {
            content = newContent;
            modified = true;
        }
    }
    
    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Updated: ' + filePath);
    }
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
            processDirectory(fullPath);
        } else if (stat.isFile()) {
            if (file === 'README.md') {
                replaceInFile(fullPath, [
                    ['[![ThomasThanos]', '[![ThomasT]'],
                    ['alt="ThomasThanos"'] // Just in case
                ]);
            } else if (file === 'LICENSE') {
                replaceInFile(fullPath, [
                    ['Thomas Thanos', 'Thomas T.'],
                    ['Thomas Desktop', 'ThomasT Desktop'] // If applicable
                ]);
            } else if (file === 'footer-author.svg') {
                replaceInFile(fullPath, [
                    ['>ThomasThanos<', '>ThomasT<'],
                    ['aria-label="ThomasThanos', 'aria-label="ThomasT']
                ]);
            } else if (file.startsWith('banner') && file.endsWith('.svg')) {
                replaceInFile(fullPath, [
                    ['THOMAS THANOS', 'THOMAS T.'],
                    ['THOMAS THANOS ARSENAL', 'THOMAS T. ARSENAL']
                ]);
            }
        }
    }
}

const rootDir = 'H:/Projects/ThomasThanos/desktop-utils';
processDirectory(rootDir);
console.log('Name replacement complete.');