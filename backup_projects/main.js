const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec, execSync } = require('child_process');
const { diffLines } = require('diff');
const os = require('os');

const CONTEXT_LINES = 3;
const PROJECTS_BACKUP_FOLDER = 'Projects Backup';

// Folders to always skip during backup
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', '__pycache__', 'release']);
const EXCLUDED_FILE_EXTENSIONS = new Set(['.zip', '.rar']);

// ─── App Data Directory — single source of truth for ALL saves ───────────────
// Χρησιμοποιούμε process.env.APPDATA για να δουλεύει σε οποιονδήποτε χρήστη
// → C:\Users\<username>\AppData\Roaming\ThomasThanos\Backup-projects
const APPDATA_ROOT = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const APP_VENDOR_DIR = path.join(APPDATA_ROOT, 'ThomasThanos');
const APP_DATA_DIR = path.join(APP_VENDOR_DIR, 'Backup-projects');
const LEGACY_APP_DATA_DIRS = [
    path.join(APP_VENDOR_DIR, 'BackupStudio'),
].filter(dir => dir !== APP_DATA_DIR);
const DROPBOX_CONFIG_FILE_NAME = '.backup-projects.json';

// All save files live under APP_DATA_DIR
const CONFIG_FILE = path.join(APP_DATA_DIR, 'projects.json');
let lastMirroredConfigJson = null;

// Ensure the directory exists before any write
function ensureAppDataDir() {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

// ─── Default project ──────────────────────────────────────────────────────────
const DEFAULT_PROJECT = {
    id: 'default',
    name: 'MakeYourLifeEasier',
    sourcePath: path.join('D:', 'Projects', 'Make_Your_Life_Easier.A.E'),
    appExe: 'Make_Your_Life_Easier.A.E.exe',
    appName: 'MakeYourLifeEasier'
};

// ─── Config helpers ───────────────────────────────────────────────────────────
function loadConfig() {
    const primaryConfig = readConfigCandidate(CONFIG_FILE);
    if (primaryConfig) {
        syncConfigToDropbox(primaryConfig.config);
        return primaryConfig.config;
    }

    const legacyConfig = getLatestConfigCandidate(
        LEGACY_APP_DATA_DIRS.map(dir => path.join(dir, 'projects.json'))
    );
    if (legacyConfig) {
        writeConfigFile(CONFIG_FILE, legacyConfig.config);
        syncConfigToDropbox(legacyConfig.config);
        return legacyConfig.config;
    }

    const dropboxConfig = readConfigCandidate(getDropboxConfigFile());
    if (dropboxConfig) {
        writeConfigFile(CONFIG_FILE, dropboxConfig.config);
        return dropboxConfig.config;
    }

    const restoredProjects = restoreProjectsFromDropboxFolders();
    if (restoredProjects.length > 0) {
        const config = normalizeConfig({
            activeProjectId: restoredProjects[0].id,
            projects: restoredProjects
        });
        saveConfig(config);
        return config;
    }

    const config = normalizeConfig({ activeProjectId: 'default', projects: [{ ...DEFAULT_PROJECT }] });
    saveConfig(config);
    return config;
}

function saveConfig(config) {
    const normalized = normalizeConfig(config);
    writeConfigFile(CONFIG_FILE, normalized);
    syncConfigToDropbox(normalized);
}

function normalizeConfig(raw) {
    const config = raw && typeof raw === 'object' ? { ...raw } : {};
    const projects = Array.isArray(config.projects)
        ? config.projects
            .filter(project => project && typeof project === 'object')
            .map((project, index) => {
                const safeProject = { ...project };
                if (!safeProject.id || typeof safeProject.id !== 'string') {
                    safeProject.id = `project-${index + 1}`;
                }
                return safeProject;
            })
        : [];

    config.projects = projects.length > 0 ? projects : [{ ...DEFAULT_PROJECT }];
    if (!config.projects.some(project => project.id === config.activeProjectId)) {
        config.activeProjectId = config.projects[0].id;
    }
    return config;
}

function readConfigCandidate(filePath) {
    if (!filePath) return null;
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const stats = fs.statSync(filePath);
        return {
            filePath,
            mtimeMs: stats.mtimeMs || 0,
            config: normalizeConfig(raw)
        };
    } catch {
        return null;
    }
}

function getLatestConfigCandidate(filePaths) {
    return filePaths
        .map(readConfigCandidate)
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function writeConfigFile(filePath, config) {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function getDropboxConfigFile() {
    const dropboxPath = getDropboxPath();
    if (!dropboxPath) return null;
    return path.join(dropboxPath, PROJECTS_BACKUP_FOLDER, DROPBOX_CONFIG_FILE_NAME);
}

function syncConfigToDropbox(config) {
    const filePath = getDropboxConfigFile();
    if (!filePath) return false;

    const serialized = JSON.stringify(config, null, 2);
    if (lastMirroredConfigJson === serialized && fs.existsSync(filePath)) return true;

    try {
        writeConfigFile(filePath, config);
        lastMirroredConfigJson = serialized;
        return true;
    } catch {
        return false;
    }
}

function restoreProjectsFromDropboxFolders() {
    const dropboxPath = getDropboxPath();
    if (!dropboxPath) return [];

    const backupRoot = path.join(dropboxPath, PROJECTS_BACKUP_FOLDER);
    if (!fs.existsSync(backupRoot)) return [];

    try {
        return fs.readdirSync(backupRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .filter(entry => projectFolderHasBackups(path.join(backupRoot, entry.name), entry.name))
            .map((entry, index) => ({
                id: makeRestoredProjectId(entry.name, index),
                name: entry.name,
                sourcePath: '',
                appExe: '',
                appName: entry.name,
                restoredFromDropbox: true
            }));
    } catch {
        return [];
    }
}

function projectFolderHasBackups(projectDir, appName) {
    try {
        return fs.readdirSync(projectDir, { withFileTypes: true })
            .some(entry =>
                entry.isDirectory() &&
                /^(\d{4})-(\d{2})/.test(entry.name) &&
                fs.readdirSync(path.join(projectDir, entry.name), { withFileTypes: true })
                    .some(child => child.isDirectory() && child.name.startsWith(appName))
            );
    } catch {
        return false;
    }
}

function makeRestoredProjectId(name, index) {
    const slug = String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `restored-${slug || `project-${index + 1}`}`;
}

function getActiveProject(config) {
    return config.projects.find(p => p.id === config.activeProjectId) || config.projects[0];
}

// ─── Dropbox Detection ────────────────────────────────────────────────────────
function getDropboxPath() {
    const candidates = [
        path.join(os.homedir(), 'AppData', 'Roaming', 'Dropbox', 'info.json'),
        path.join(os.homedir(), 'AppData', 'Local', 'Dropbox', 'info.json')
    ];

    for (const infoFile of candidates) {
        try {
            if (fs.existsSync(infoFile)) {
                const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
                const dropboxPath = info?.personal?.path || info?.business?.path;
                if (dropboxPath && fs.existsSync(dropboxPath)) return dropboxPath;
            }
        } catch {}
    }

    const defaults = [
        path.join(os.homedir(), 'Dropbox'),
        path.join(os.homedir(), 'OneDrive', 'Dropbox'),
    ];
    for (const d of defaults) {
        if (fs.existsSync(d)) return d;
    }

    return null;
}

function isDropboxRunning() {
    try {
        const result = execSync('tasklist /FI "IMAGENAME eq Dropbox.exe" /NH', { encoding: 'utf8', timeout: 3000 });
        return result.toLowerCase().includes('dropbox.exe');
    } catch {
        return false;
    }
}

function getDropboxStatus() {
    const dropboxPath = getDropboxPath();
    if (!dropboxPath) return { found: false, running: false, path: null };
    return { found: true, running: isDropboxRunning(), path: dropboxPath };
}

function getProjectsBackupRoot() {
    const status = getDropboxStatus();
    if (!status.found || !status.path) return null;
    return path.join(status.path, PROJECTS_BACKUP_FOLDER);
}

function getProjectBackupPath(project) {
    const backupRoot = getProjectsBackupRoot();
    if (!backupRoot || !project?.appName) return null;
    return path.join(backupRoot, project.appName);
}

function isProjectBackupPathSafe(targetPath, backupRoot) {
    if (!targetPath || !backupRoot) return false;
    const relative = path.relative(backupRoot, targetPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removePathWithRetries(targetPath, maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await fs.remove(targetPath);
            return;
        } catch (error) {
            if ((error.code !== 'EBUSY' && error.code !== 'EPERM') || attempt === maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 700));
        }
    }
}

// {DropboxPath}/Projects Backup/{appName}  — created automatically if missing
function resolveDestPath(project) {
    const dest = getProjectBackupPath(project);
    if (!dest) return null;
    fs.mkdirSync(dest, { recursive: true });
    return dest;
}

// ─── Window ──────────────────────────────────────────────────────────────────
let mainWindow;
let splashWindow;

function createWindow() {
    const { screen } = require('electron');
    const { workArea } = screen.getPrimaryDisplay();
    const W = 1000, H = 700;
    const x = Math.round(workArea.x + (workArea.width  - W) / 2);
    const y = Math.round(workArea.y + (workArea.height - H) / 2);

    mainWindow = new BrowserWindow({
        width: W, height: H, x, y,
        minWidth: W, minHeight: H,
        resizable: false,
        maximizable: false,
        frame: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname, 'preload-simple.js') },
        icon: path.join(__dirname, 'backup.ico'),
        backgroundColor: '#0c0c14',
        show: false
    });
    mainWindow.loadFile('index.html');

    // Μόλις είναι έτοιμο: κλείσιμο splash και εμφάνιση main window
    mainWindow.webContents.once('did-finish-load', () => {
        // Δώσε χρόνο στο React να κάνει render πριν εμφανιστεί το main window
        setTimeout(() => {
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.close();
                splashWindow = null;
            }
            mainWindow.show();
            mainWindow.focus();
        }, 900);
    });
}

// Ανοίγει ΑΜΕΣΩΣ splash window — πριν φορτωθεί οτιδήποτε άλλο
function createSplashWindow() {
    const { screen } = require('electron');
    const { bounds } = screen.getPrimaryDisplay();

    splashWindow = new BrowserWindow({
        width: 320, height: 360,
        x: Math.round(bounds.x + (bounds.width  - 320) / 2),
        y: Math.round(bounds.y + (bounds.height - 360) / 2),
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
        icon: path.join(__dirname, 'backup.ico'),
        backgroundColor: '#00000000',
    });
    splashWindow.loadFile('splash.html');
    splashWindow.once('ready-to-show', () => splashWindow.show());
}

// Force Electron to store ALL its data (localStorage, cache, etc.) in our folder
app.setPath('userData', APP_DATA_DIR);

app.whenReady().then(() => {
    createSplashWindow(); // 1ο: splash αμέσως
    createWindow();       // 2ο: main window στο background
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.handle('window-minimize',     () => mainWindow.minimize());
ipcMain.handle('window-maximize',     () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window-close',        () => mainWindow.close());
ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized());

// ─── Smooth resize + re-center ───────────────────────────────────────────────
let _resizeTimer = null;
function animateResize(targetW, targetH, minW, minH) {
    const { screen } = require('electron');
    const [curW, curH] = mainWindow.getSize();
    const [curX, curY] = mainWindow.getPosition();
    const display = screen.getDisplayNearestPoint({ x: curX, y: curY });
    const { bounds } = display;
    const targetX = Math.round(bounds.x + (bounds.width  - targetW) / 2);
    const targetY = Math.round(bounds.y + (bounds.height - targetH) / 2);

    // already there
    if (curW === targetW && curH === targetH && curX === targetX && curY === targetY) return;

    if (_resizeTimer) { clearInterval(_resizeTimer); _resizeTimer = null; }

    mainWindow.setResizable(true);
    mainWindow.setMaximizable(false);
    mainWindow.setMinimumSize(minW, minH);

    const STEPS = 14;
    const MS    = 14; // ~70fps, total ~200ms
    let step = 0;
    const ease = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

    _resizeTimer = setInterval(() => {
        step++;
        const t = ease(step / STEPS);
        mainWindow.setBounds({
            x:      Math.round(curX + (targetX - curX) * t),
            y:      Math.round(curY + (targetY - curY) * t),
            width:  Math.round(curW + (targetW - curW) * t),
            height: Math.round(curH + (targetH - curH) * t),
        });
        if (step >= STEPS) {
            clearInterval(_resizeTimer);
            _resizeTimer = null;
            mainWindow.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
            mainWindow.setResizable(false);
        }
    }, MS);
}

ipcMain.handle('set-view-mode', (event, view) => {
    if (view === 'home') {
        animateResize(1000, 700, 1000, 700);
    } else {
        animateResize(1280, 850, 1280, 850);
    }
    return { success: true };
});

// ─── Dropbox IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('get-dropbox-status', () => getDropboxStatus());

ipcMain.handle('launch-dropbox', () => {
    const candidates = [
        path.join(os.homedir(), 'AppData', 'Local', 'Dropbox', 'Dropbox.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Dropbox', 'client', 'Dropbox.exe'),
        'C:\\Program Files (x86)\\Dropbox\\Client\\Dropbox.exe',
        'C:\\Program Files\\Dropbox\\Client\\Dropbox.exe',
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            exec(`"${candidate}"`);
            return { success: true, path: candidate };
        }
    }

    exec('start "" "Dropbox.exe"', { shell: true });
    return { success: true, path: 'shell' };
});

// ─── Project management IPC ──────────────────────────────────────────────────
ipcMain.handle('get-projects', () => loadConfig());

ipcMain.handle('add-project', (event, project) => {
    const config = loadConfig();
    const newProj = { id: Date.now().toString(), ...project };
    config.projects.push(newProj);
    config.activeProjectId = newProj.id;
    saveConfig(config);
    return { success: true, project: newProj };
});

ipcMain.handle('update-project', (event, project) => {
    const config = loadConfig();
    const idx = config.projects.findIndex(p => p.id === project.id);
    if (idx !== -1) config.projects[idx] = project;
    saveConfig(config);
    return { success: true };
});

ipcMain.handle('remove-project', async (event, projectId) => {
    const config = loadConfig();
    if (config.projects.length <= 1) return { success: false, error: 'Πρέπει να υπάρχει τουλάχιστον ένα project.' };
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Το project δεν βρέθηκε.' };

    const backupRoot = getProjectsBackupRoot();
    if (!backupRoot) {
        return { success: false, error: 'Δεν βρέθηκε το Dropbox, οπότε δεν μπορώ να διαγράψω και τα αρχεία του project.' };
    }

    const backupPath = getProjectBackupPath(project);
    if (!isProjectBackupPathSafe(backupPath, backupRoot)) {
        return { success: false, error: 'Μη ασφαλές path διαγραφής project.' };
    }

    try {
        if (fs.existsSync(backupPath)) {
            await removePathWithRetries(backupPath);
        }
    } catch (error) {
        return { success: false, error: `Αποτυχία διαγραφής αρχείων project: ${error.message}` };
    }

    config.projects = config.projects.filter(p => p.id !== projectId);
    if (config.activeProjectId === projectId) config.activeProjectId = config.projects[0].id;
    saveConfig(config);
    return { success: true, deletedBackupPath: backupPath };
});

ipcMain.handle('set-active-project', (event, projectId) => {
    const config = loadConfig();
    config.activeProjectId = projectId;
    saveConfig(config);
    return { success: true };
});

ipcMain.handle('get-all-projects-stats', () => {
    const config = loadConfig();
    const dropboxStatus = getDropboxStatus();

    return config.projects.map(project => {
        let backupCount = 0;
        let totalSizeBytes = 0;
        let lastBackupDate = null;
        let lastVersion = 0;

        try {
            if (dropboxStatus.found) {
                const destPath = path.join(dropboxStatus.path, PROJECTS_BACKUP_FOLDER, project.appName);
                if (fs.existsSync(destPath)) {
                    const monthFolders = fs.readdirSync(destPath)
                        .filter(f => fs.statSync(path.join(destPath, f)).isDirectory()
                                  && f.toLowerCase() !== 'all - pre release backups');

                    for (const mf of monthFolders) {
                        const monthPath = path.join(destPath, mf);
                        const backupFolders = fs.readdirSync(monthPath)
                            .filter(f => f.startsWith(project.appName)
                                      && fs.statSync(path.join(monthPath, f)).isDirectory());

                        for (const bf of backupFolders) {
                            const fullPath = path.join(monthPath, bf);
                            backupCount++;
                            totalSizeBytes += getFolderSizeRaw(fullPath);
                            const mtime = fs.statSync(fullPath).mtime;
                            if (!lastBackupDate || mtime > lastBackupDate) lastBackupDate = mtime;
                            const m = bf.match(/_V(\d+)$/);
                            if (m) lastVersion = Math.max(lastVersion, parseInt(m[1]));
                        }
                    }
                }
            }
        } catch {}

        return {
            ...project,
            backupCount,
            totalSize: totalSizeBytes > 0 ? formatBytes(totalSizeBytes) : '—',
            lastBackup: lastBackupDate ? lastBackupDate.toLocaleString('el-GR') : null,
            lastVersion
        };
    });
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMonthFolder() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const names = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος',
                   'Μάιος','Ιούνιος','Ιούλιος','Αύγουστος',
                   'Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
    return `${year}-${month} ${names[now.getMonth()]}`;
}

function parseMonthFolder(folderName) {
    const match = folderName.match(/^(\d{4})-(\d{2})\s+(.+)$/);
    if (match) return { year: parseInt(match[1]), month: parseInt(match[2]), name: match[3], display: `${match[3]} ${match[1]}` };
    return { year: 0, month: 0, name: folderName, display: folderName };
}

function getNextVersion(destPath, appName) {
    try {
        if (!fs.existsSync(destPath)) { fs.mkdirSync(destPath, { recursive: true }); return 1; }
        let maxVersion = 0;
        const monthFolders = fs.readdirSync(destPath).filter(f => fs.statSync(path.join(destPath, f)).isDirectory());
        for (const mf of monthFolders) {
            fs.readdirSync(path.join(destPath, mf))
                .filter(f => f.startsWith(appName + '_D'))
                .forEach(f => {
                    const m = f.match(/_V(\d+)$/);
                    if (m) maxVersion = Math.max(maxVersion, parseInt(m[1]));
                });
        }
        return maxVersion + 1;
    } catch { return 1; }
}

function killApp(appExe) {
    return new Promise(resolve => {
        if (!appExe) return setTimeout(resolve, 200);
        exec(`taskkill /F /IM "${appExe}" /T`, () => setTimeout(resolve, 1000));
    });
}

function getAllFiles(dirPath, arrayOfFiles = [], basePath = dirPath) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    fs.readdirSync(dirPath).forEach(file => {
        if (EXCLUDED_DIRS.has(file)) return;
        const fullPath     = path.join(dirPath, file);
        const relativePath = path.relative(basePath, fullPath);
        if (fs.statSync(fullPath).isDirectory()) getAllFiles(fullPath, arrayOfFiles, basePath);
        else arrayOfFiles.push({ path: relativePath, fullPath });
    });
    return arrayOfFiles;
}

function getFileContent(filePath) {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return '[Binary file]'; }
}

function calculateDiff(oldBackupPath, newBackupPath) {
    const diffs = [];
    const oldFiles   = getAllFiles(oldBackupPath);
    const newFiles   = getAllFiles(newBackupPath);
    const oldFileMap = new Map(oldFiles.map(f => [f.path, f.fullPath]));
    const newFileMap = new Map(newFiles.map(f => [f.path, f.fullPath]));

    for (const [relativePath, oldFullPath] of oldFileMap) {
        if (newFileMap.has(relativePath)) {
            const oldContent = getFileContent(oldFullPath);
            const newContent = getFileContent(newFileMap.get(relativePath));
            if (oldContent !== newContent && oldContent !== '[Binary file]')
                diffs.push({ file: relativePath, status: 'modified', changes: diffLines(oldContent, newContent) });
        } else {
            diffs.push({ file: relativePath, status: 'deleted', changes: [] });
        }
    }
    for (const [relativePath] of newFileMap) {
        if (!oldFileMap.has(relativePath))
            diffs.push({ file: relativePath, status: 'added', changes: [] });
    }
    return diffs;
}

function getFolderSizeRaw(folderPath) {
    let total = 0;
    try {
        fs.readdirSync(folderPath, { withFileTypes: true }).forEach(f => {
            try {
                const fp = path.join(folderPath, f.name);
                total += f.isFile() ? (fs.statSync(fp).size || 0) : getFolderSizeRaw(fp);
            } catch {}
        });
    } catch {}
    return total;
}

function getFolderSize(folderPath) { return formatBytes(getFolderSizeRaw(folderPath)); }

function formatBytes(bytes) {
    if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0 || i >= sizes.length || isNaN(i)) return '0 B';
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function makePartialBackupFolderName(backupName, timestamp) {
    return `__partial__${backupName}__${timestamp}`;
}

async function copyFolderRecursive(source, dest, sourceRoot) {
    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const srcPath  = path.join(source, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            await copyFolderRecursive(srcPath, destPath, sourceRoot);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (EXCLUDED_FILE_EXTENSIONS.has(ext)) continue;
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ─── Backup IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('get-backups', async () => {
    try {
        const config   = loadConfig();
        const project  = getActiveProject(config);
        const destPath = resolveDestPath(project);
        if (!destPath || !fs.existsSync(destPath)) return [];

        const allBackups = [];
        const monthFolders = fs.readdirSync(destPath)
            .filter(f => {
                if (f.toLowerCase() === 'all - pre release backups') return false;
                return fs.statSync(path.join(destPath, f)).isDirectory();
            })
            .sort().reverse();

        for (const mf of monthFolders) {
            const monthPath = path.join(destPath, mf);
            const monthInfo = parseMonthFolder(mf);

            fs.readdirSync(monthPath)
                .filter(f => f.startsWith(project.appName))
                .forEach(f => {
                    const fullPath = path.join(monthPath, f);
                    const stats    = fs.statSync(fullPath);
                    const infoPath = path.join(fullPath, '.backup-info.json');
                    const sizeBytes = getFolderSizeRaw(fullPath);
                    let day = 0, version = 0;
                    const newMatch = f.match(/_D(\d+)_V(\d+)$/);
                    const oldMatch = f.match(/_V(\d+)_D(\d+)$/);
                    if (newMatch)      { day = parseInt(newMatch[1]); version = parseInt(newMatch[2]); }
                    else if (oldMatch) { version = parseInt(oldMatch[1]); day = parseInt(oldMatch[2]); }

                    let isMigrated = false;
                    try { if (!fs.existsSync(infoPath)) isMigrated = true; } catch {}
                    if (isMigrated && sizeBytes === 0) return;

                    allBackups.push({
                        name: f, path: fullPath,
                        monthFolder: mf, monthDisplay: monthInfo.display,
                        version, day,
                        date: stats.mtime.toLocaleString('el-GR'),
                        timestamp: stats.mtime.getTime(),
                        size: formatBytes(sizeBytes),
                        isMigrated
                    });
                });
        }
        return allBackups.sort((a, b) => b.version - a.version);
    } catch { return []; }
});

ipcMain.handle('get-paths', async () => {
    const config   = loadConfig();
    const project  = getActiveProject(config);
    const destPath = resolveDestPath(project) || '(Dropbox not found)';
    return { source: project.sourcePath, dest: destPath };
});

ipcMain.handle('create-backup', async () => {
    let tempFolder = null;
    try {
        const config  = loadConfig();
        const project = getActiveProject(config);
        const { sourcePath, appExe, appName } = project;

        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return {
                success: false,
                error: 'Το source path δεν βρέθηκε. Άνοιξε το Edit Project και σύνδεσέ το ξανά.'
            };
        }

        const dropboxStatus = getDropboxStatus();
        if (!dropboxStatus.found)
            return { success: false, error: 'Δεν βρέθηκε το Dropbox. Βεβαιώσου ότι είναι εγκατεστημένο.' };
        if (!dropboxStatus.running)
            return { success: false, error: 'Το Dropbox δεν τρέχει. Άνοιξέ το και δοκίμασε ξανά.' };

        const destPath = resolveDestPath(project);
        if (!destPath) return { success: false, error: 'Αδύνατη εύρεση/δημιουργία φακέλου Dropbox.' };

        mainWindow.webContents.send('backup-status', 'Κλείσιμο εφαρμογής...');
        await killApp(appExe);

        mainWindow.webContents.send('backup-status', 'Προετοιμασία...');

        const now         = new Date();
        const version     = getNextVersion(destPath, appName);
        const day         = now.getDate();
        const monthFolder = getMonthFolder();
        const backupName  = `${appName}_D${day}_V${version}`;

        const monthPath  = path.join(destPath, monthFolder);
        const destFolder = path.join(monthPath, backupName);
        tempFolder = path.join(monthPath, makePartialBackupFolderName(backupName, now.getTime()));
        fs.mkdirSync(monthPath, { recursive: true });
        fs.mkdirSync(tempFolder, { recursive: true });

        mainWindow.webContents.send('backup-status', 'Αντιγραφή αρχείων...');
        await copyFolderRecursive(sourcePath, tempFolder, sourcePath);

        const metadata = {
            name: backupName, version, day, monthFolder,
            createdAt: now.toISOString(),
            timestamp: now.getTime(),
            displayDate: now.toLocaleString('el-GR')
        };
        fs.writeFileSync(
            path.join(tempFolder, '.backup-info.json'),
            JSON.stringify(metadata, null, 2),
            'utf8'
        );
        if (fs.existsSync(destFolder)) {
            throw new Error(`Υπάρχει ήδη backup με όνομα "${backupName}".`);
        }

        mainWindow.webContents.send('backup-status', 'Ολοκλήρωση...');
        await fs.move(tempFolder, destFolder, { overwrite: false });
        tempFolder = null;

        mainWindow.webContents.send('backup-status', 'Ολοκληρώθηκε!');
        return { success: true, backupName, path: destFolder, monthFolder };
    } catch (error) {
        if (tempFolder && fs.existsSync(tempFolder)) {
            try { await removePathWithRetries(tempFolder); } catch {}
        }
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-backup', async (event, backupPath) => {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try { await fs.remove(backupPath); return { success: true }; }
        catch (error) {
            if (error.code !== 'EBUSY' || attempt === 5) return { success: false, error: error.message };
            await new Promise(r => setTimeout(r, 1000));
        }
    }
});

ipcMain.handle('get-diff', async (event, backup1, backup2) => {
    try { return { success: true, diffs: calculateDiff(backup1, backup2) }; }
    catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-file-diff', async (event, backup1Path, backup2Path, filePath) => {
    try {
        const file1    = path.join(backup1Path, filePath);
        const file2    = path.join(backup2Path, filePath);
        const content1 = fs.existsSync(file1) ? getFileContent(file1) : '';
        const content2 = fs.existsSync(file2) ? getFileContent(file2) : '';

        const rawChanges = diffLines(content1, content2);
        const flattened  = [];
        rawChanges.forEach(part => {
            const lines = part.value.split('\n');
            lines.forEach((line, idx) => {
                if (idx === lines.length - 1 && line === '') return;
                flattened.push({ value: line, added: !!part.added, removed: !!part.removed });
            });
        });

        const changedIndices = flattened
            .map((ln, i) => (ln.added || ln.removed) ? i : -1)
            .filter(i => i !== -1);
        let contextualChanges = [];

        if (changedIndices.length > 0) {
            const ranges = [];
            let start = Math.max(0, changedIndices[0] - CONTEXT_LINES);
            let end   = Math.min(flattened.length - 1, changedIndices[0] + CONTEXT_LINES);
            for (let i = 1; i < changedIndices.length; i++) {
                const ns = Math.max(0, changedIndices[i] - CONTEXT_LINES);
                const ne = Math.min(flattened.length - 1, changedIndices[i] + CONTEXT_LINES);
                if (ns <= end + 1) { end = Math.max(end, ne); }
                else { ranges.push([start, end]); start = ns; end = ne; }
            }
            ranges.push([start, end]);
            let cur = 0;
            ranges.forEach(([s, e]) => {
                if (s > cur) contextualChanges.push({ value: '...', added: false, removed: false, omitted: true });
                for (let i = s; i <= e; i++) contextualChanges.push(flattened[i]);
                cur = e + 1;
            });
        }

        return { success: true, changes: contextualChanges, oldContent: content1, newContent: content2 };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('open-folder', (event, folderPath) => {
    exec(`explorer "${folderPath}"`);
    return { success: true };
});

ipcMain.handle('open-url', (event, url) => {
    shell.openExternal(url);
    return { success: true };
});

ipcMain.handle('fetch-release-info', async (event, repoSlug) => {
    try {
        const https = require('https');
        const apiUrl = `https://api.github.com/repos/thomasthanos/${repoSlug}/releases/latest`;
        const data = await new Promise((resolve, reject) => {
            https.get(apiUrl, { headers: { 'User-Agent': 'BackupStudio' } }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
            }).on('error', reject);
        });
        const asset = data.assets?.find(a => a.name.endsWith('.exe') || a.name.endsWith('.zip') || a.name.endsWith('.msi'));
        if (!asset) return { success: false, error: 'Δεν βρέθηκε release asset' };
        return { success: true, url: asset.browser_download_url, name: asset.name, size: asset.size, version: data.tag_name };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('download-release', async (event, repoSlug) => {
    try {
        const { net } = require('electron');
        const fs2 = require('fs');

        // 1. Fetch release info via electron.net (handles auth/redirects)
        const apiUrl = `https://api.github.com/repos/thomasthanos/${repoSlug}/releases/latest`;
        const data = await new Promise((resolve, reject) => {
            const req = net.request({ url: apiUrl, method: 'GET' });
            req.setHeader('User-Agent', 'BackupStudio');
            req.setHeader('Accept', 'application/vnd.github+json');
            let body = '';
            req.on('response', (res) => {
                res.on('data', chunk => body += chunk.toString());
                res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });

        const asset = data.assets?.find(a =>
            a.name.endsWith('.exe') || a.name.endsWith('.zip') || a.name.endsWith('.msi')
        );
        if (!asset) return { success: false, error: 'Δεν βρέθηκε release asset' };

        // 2. Ask user where to save
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: `Αποθήκευση ${asset.name}`,
            defaultPath: path.join(os.homedir(), 'Downloads', asset.name),
        });
        if (canceled || !filePath) return { success: false, error: 'cancelled' };

        const totalSize = asset.size;

        // 3. Download via electron.net — follows all redirects automatically
        await new Promise((resolve, reject) => {
            const req = net.request({ url: asset.browser_download_url, method: 'GET' });
            req.setHeader('User-Agent', 'BackupStudio');
            const file = fs2.createWriteStream(filePath);
            let downloaded = 0;
            req.on('response', (res) => {
                res.on('data', chunk => {
                    file.write(chunk);
                    downloaded += chunk.length;
                    const pct = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : -1;
                    mainWindow.webContents.send('download-progress', { repoSlug, pct, downloaded, total: totalSize });
                });
                res.on('end', () => { file.end(); resolve(); });
                res.on('error', (e) => { file.destroy(); reject(e); });
            });
            req.on('error', (e) => { file.destroy(); reject(e); });
            req.end();
        });

        mainWindow.webContents.send('download-progress', { repoSlug, pct: 100, done: true, filePath });
        return { success: true, filePath, name: asset.name };

    } catch (e) {
        if (e.message !== 'cancelled')
            mainWindow.webContents.send('download-progress', { repoSlug, pct: -1, error: e.message });
        return { success: false, error: e.message };
    }
});
