const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// ─── Custom userData path: AppData\Roaming\ThomasThanos\AutoClicker ───────────
app.setPath('userData', path.join(app.getPath('appData'), 'ThomasThanos', 'AutoClicker'));

// =============================================================================
// Persistent PowerShell Runspace for ultra-fast clicks
// =============================================================================
// Instead of spawning a new powershell.exe for each click (~50-200ms overhead),
// we keep a single process alive and send commands via stdin.

let psProcess = null;
let psReady = false;
let psCommandQueue = [];
let psCurrentResolve = null;
let psResponseBuffer = '';

const PS_READY_MARKER = '[[PS_READY]]';
const PS_DONE_MARKER = '[[PS_DONE]]';

const initPersistentPowerShell = () => {
  if (psProcess) return;

  psProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-NoLogo',
    '-ExecutionPolicy', 'Bypass',
    '-Command', '-'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  psProcess.stdout.on('data', (data) => {
    psResponseBuffer += data.toString();
    
    // Check for ready marker (initial setup complete)
    if (!psReady && psResponseBuffer.includes(PS_READY_MARKER)) {
      psReady = true;
      psResponseBuffer = '';
      processNextCommand();
      return;
    }
    
    // Check for command completion marker
    if (psCurrentResolve && psResponseBuffer.includes(PS_DONE_MARKER)) {
      const resolve = psCurrentResolve;
      psCurrentResolve = null;
      psResponseBuffer = '';
      resolve();
      processNextCommand();
    }
  });

  psProcess.stderr.on('data', (data) => {
    // Ignore stderr for now, but could log for debugging
  });

  psProcess.on('close', () => {
    psProcess = null;
    psReady = false;
    // Reject any pending commands
    if (psCurrentResolve) {
      psCurrentResolve();
      psCurrentResolve = null;
    }
  });

  // Initialize: load assemblies and define functions ONCE
  const initScript = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $sig = '[DllImport("user32.dll", CharSet=CharSet.Auto, CallingConvention=CallingConvention.StdCall)] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, UIntPtr dwExtraInfo);'
    $global:MouseType = Add-Type -MemberDefinition $sig -Name 'MouseEvent' -Namespace 'Win32Funcs' -PassThru
    function global:DoClick([uint32]$down, [uint32]$up, [bool]$double) {
      $global:MouseType::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      $global:MouseType::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
      if ($double) {
        Start-Sleep -Milliseconds 40
        $global:MouseType::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
        $global:MouseType::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
      }
    }
    function global:MoveTo([int]$x, [int]$y) {
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    }
    Write-Output '${PS_READY_MARKER}'
  `;
  psProcess.stdin.write(initScript + '\n');
};

const processNextCommand = () => {
  if (!psReady || psCurrentResolve || psCommandQueue.length === 0) return;
  
  const { cmd, resolve } = psCommandQueue.shift();
  psCurrentResolve = resolve;
  psProcess.stdin.write(cmd + `; Write-Output '${PS_DONE_MARKER}'\n`);
};

const runPersistentCommand = (cmd) => {
  return new Promise((resolve) => {
    if (!psProcess || !psReady) {
      // Fallback: if PS not ready, resolve immediately (command skipped)
      resolve();
      return;
    }
    psCommandQueue.push({ cmd, resolve });
    processNextCommand();
  });
};

// Fallback for one-off commands (e.g., during capture)
const runPowerShell = (script) => {
  return new Promise((resolve, reject) => {
    const escaped = String(script)
      .replace(/\r?\n/g, ' ')
      .replace(/"/g, '\\"');

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "${escaped}"`,
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || stdout || err.message || '').toString().trim()));
          return;
        }
        resolve((stdout || '').toString());
      }
    );
  });
};

// Use persistent PowerShell for mouse control (ultra-fast)
const mouseController = {
  moveMouse: (x, y) => {
    return runPersistentCommand(`MoveTo ${x} ${y}`);
  },
  
  click: (button = 'left', double = false) => {
    const buttonDown = button === 'left' ? 0x0002 : button === 'right' ? 0x0008 : 0x0020;
    const buttonUp = button === 'left' ? 0x0004 : button === 'right' ? 0x0010 : 0x0040;
    const doubleFlag = double ? '$true' : '$false';
    return runPersistentCommand(`DoClick ${buttonDown} ${buttonUp} ${doubleFlag}`);
  }
};
// Handle creating/removing shortcuts on Windows when installing/uninstalling
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch (e) {
  // electron-squirrel-startup not available
}

let mainWindow;
let mouseCaptureInterval = null;
let startStopHotkey = 'F6';
let emergencyStopHotkey = 'F7';

// ------------------------
// Clicker engine (main process)
// ------------------------
const clickerState = {
  running: false,
  timer: null,
  config: null,
  posIndex: 0,
  totalClicks: 0,
  sessionClicks: 0,
  clicksAtCurrentPosition: 0,
  clickInProgress: false, // Prevent overlapping clicks
};

const sendToRenderer = (channel, payload) => {
  try {
    mainWindow?.webContents?.send(channel, payload);
  } catch (e) {
    // ignore
  }
};

const toFiniteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const MIN_INTERVAL_MS = 80;

const clampIntervalMs = (ms) => {
  // PowerShell-based clicks are heavy; enforce a floor so the app stays responsive.
  // NOTE: This is a floor (minimum). Actual speed can still be slower due to PowerShell execution time.
  const safe = Number.isFinite(ms) ? ms : 100;
  return Math.max(MIN_INTERVAL_MS, Math.floor(safe));
};

// Avoid spamming interval-debug toasts: emit only when user-facing interval inputs change.
let lastIntervalDebugKey = null;

const computeNextIntervalMs = (cfg) => {
  const interval = cfg?.interval || {};
  const random = cfg?.random || {};
  const hours = toFiniteNumber(interval.hours, 0);
  const minutes = toFiniteNumber(interval.minutes, 0);
  const seconds = toFiniteNumber(interval.seconds, 0);
  const milliseconds = toFiniteNumber(interval.milliseconds, 0);

  if (random.enabled) {
    const minS = toFiniteNumber(random.minSeconds, 0.1);
    const maxS = toFiniteNumber(random.maxSeconds, 0.2);
    const low = Math.min(minS, maxS);
    const high = Math.max(minS, maxS);
    const ms = (Math.random() * (high - low) + low) * 1000;
    const debugKey = `random|${Boolean(random.enabled)}|${low}|${high}`;
    if (debugKey !== lastIntervalDebugKey) {
      lastIntervalDebugKey = debugKey;
      sendToRenderer('interval-debug', {
        randomEnabled: true,
        minSeconds: low,
        maxSeconds: high,
        sampledMs: ms,
        clampedMs: clampIntervalMs(ms),
        minFloorMs: MIN_INTERVAL_MS,
      });
    }
    return clampIntervalMs(ms);
  }

  const ms = hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;

  const debugKey = `fixed|${hours}|${minutes}|${seconds}|${milliseconds}`;
  if (debugKey !== lastIntervalDebugKey) {
    lastIntervalDebugKey = debugKey;
    // Debug: send interval info to renderer (throttled by config changes)
    sendToRenderer('interval-debug', {
      randomEnabled: false,
      hours,
      minutes,
      seconds,
      milliseconds,
      calculatedMs: ms,
      clampedMs: clampIntervalMs(ms),
      minFloorMs: MIN_INTERVAL_MS,
    });
  }

  return clampIntervalMs(ms);
};

const getEnabledPositions = (cfg) => {
  const categories = cfg?.location?.categories || [];
  const positions = cfg?.location?.positions || [];
  
  // If categories are available, get all enabled positions from enabled categories
  if (categories.length > 0) {
    const allPositions = [];
    for (const cat of categories) {
      if (cat && cat.enabled) {
        for (const pos of (cat.positions || [])) {
          if (pos && pos.enabled !== false) {
            allPositions.push({
              ...pos,
              categoryId: cat.id,
              hasCustomRepeat: cat.hasCustomRepeat,
            });
          }
        }
      }
    }
    return allPositions;
  }
  
  // Fallback to flat positions array
  return positions.filter((p) => p && p.enabled !== false);
};

const getTargetForNextClick = (cfg) => {
  const mode = cfg?.location?.mode || 'current';
  if (mode === 'current') {
    return { x: -1, y: -1, posIndex: 0, customRepeatCount: null };
  }

  const enabled = getEnabledPositions(cfg);
  if (enabled.length === 0) {
    throw new Error('No enabled positions. Add/enable at least one position.');
  }

  if (mode === 'fixed') {
    return { x: enabled[0].x, y: enabled[0].y, posIndex: 0, customRepeatCount: null };
  }

  // multi
  const idx = clickerState.posIndex % enabled.length;
  const pos = enabled[idx];
  return { 
    x: pos.x, 
    y: pos.y, 
    posIndex: idx, 
    customRepeatCount: pos.hasCustomRepeat ? (pos.customRepeatCount || 1) : null 
  };
};

const clickOnce = async (cfg, target) => {
  const mouse = cfg?.mouse || {};
  const button = mouse.button || 'left';
  const clickType = mouse.clickType || 'single';

  if (target.x !== -1 && target.y !== -1) {
    await mouseController.moveMouse(target.x, target.y);
    // Small delay for cursor to settle before clicking
    await new Promise((r) => setTimeout(r, 20));
  }

  await mouseController.click(button, clickType === 'double');
  return clickType === 'double' ? 2 : 1;
};

const stopClicker = (reason = 'stopped') => {
  if (!clickerState.running) return;
  clickerState.running = false;
  if (clickerState.timer) {
    clearTimeout(clickerState.timer);
    clickerState.timer = null;
  }
  sendToRenderer('clicker-status', {
    running: false,
    reason,
    totalClicks: clickerState.totalClicks,
    sessionClicks: clickerState.sessionClicks,
    positionIndex: clickerState.posIndex,
  });
};

const startClicker = async (source = 'ui') => {
  if (clickerState.running) return;
  const cfg = clickerState.config;
  if (!cfg) {
    sendToRenderer('clicker-error', { message: 'Missing clicker config (app not ready yet).' });
    return;
  }

  // Validate config early
  try {
    getTargetForNextClick(cfg);
  } catch (e) {
    sendToRenderer('clicker-error', { message: e?.message || 'Invalid clicker config.' });
    return;
  }

  clickerState.running = true;
  clickerState.sessionClicks = 0;
  clickerState.posIndex = 0;
  clickerState.clicksAtCurrentPosition = 0;

  sendToRenderer('clicker-status', {
    running: true,
    source,
    totalClicks: clickerState.totalClicks,
    sessionClicks: clickerState.sessionClicks,
    positionIndex: clickerState.posIndex,
  });

  // Emit interval debug once on start so the UI can immediately show what values the engine sees.
  // (Without this, users might wait for the first click to finish before seeing interval info.)
  computeNextIntervalMs(cfg);

  const tick = async () => {
    if (!clickerState.running) return;
    
    // Skip if a click is already in progress
    if (clickerState.clickInProgress) {
      // Retry after a short delay
      clickerState.timer = setTimeout(tick, 10);
      return;
    }
    
    const cfgNow = clickerState.config;
    
    const repeat = cfgNow?.repeat || {};
    const repeatMode = repeat.mode || 'until_stopped';
    const repeatCount = Number(repeat.count || 1);
    const locationMode = cfgNow?.location?.mode || 'current';

    // For multi-position mode, don't use global sessionClicks limit
    if (repeatMode === 'times' && locationMode !== 'multi') {
      if (clickerState.sessionClicks >= repeatCount) {
        stopClicker('repeat_completed');
        return;
      }
    }

    // Get current target position
    let target;
    try {
      target = getTargetForNextClick(cfgNow);
    } catch (e) {
      stopClicker('error');
      sendToRenderer('clicker-error', { message: e?.message || 'Click failed' });
      return;
    }

    // Mark click in progress
    clickerState.clickInProgress = true;

    // Execute click and wait for it to complete
    try {
      await clickOnce(cfgNow, target);
    } catch (e) {
      sendToRenderer('clicker-error', { message: e?.message || 'Click execution failed' });
    }
    
    // Click done
    clickerState.clickInProgress = false;

    // Update counters AFTER click completes
    const clickTypeNow = cfgNow?.mouse?.clickType || 'single';
    const increment = clickTypeNow === 'double' ? 2 : 1;
    clickerState.totalClicks += increment;
    clickerState.sessionClicks += 1;

    // Handle multi-position mode with category support
    let shouldStop = false;
    if (locationMode === 'multi') {
      const enabled = getEnabledPositions(cfgNow);
      const clicksPerPosition = Number(cfgNow?.location?.clicksPerPosition || 1);
      
      if (enabled.length > 0) {
        clickerState.clicksAtCurrentPosition += 1;
        
        // Determine clicks needed for current position
        const currentPos = enabled[clickerState.posIndex % enabled.length];
        let clicksNeeded;
        
        if (currentPos?.hasCustomRepeat) {
          // Category 4: use custom repeat count per position
          clicksNeeded = currentPos.customRepeatCount || 1;
        } else if (repeatMode === 'times') {
          // In "Repeat X times" mode: do repeatCount clicks at each position
          clicksNeeded = repeatCount;
        } else {
          // In "Until stopped" mode: use clicksPerPosition setting
          clicksNeeded = clicksPerPosition;
        }
        
        if (clickerState.clicksAtCurrentPosition >= clicksNeeded) {
          const nextPosIndex = clickerState.posIndex + 1;
          
          // Check if we've completed a full cycle of all positions
          if (nextPosIndex >= enabled.length) {
            if (repeatMode === 'times') {
              // In "Repeat X times" mode, stop after completing one full cycle
              shouldStop = true;
            } else {
              // In "Until stopped" mode, restart from position 0
              clickerState.posIndex = 0;
              clickerState.clicksAtCurrentPosition = 0;
            }
          } else {
            // Move to next position
            clickerState.posIndex = nextPosIndex;
            clickerState.clicksAtCurrentPosition = 0;
          }
        }
      }
    }

    // Send stats update
    sendToRenderer('clicker-stats', {
      totalClicks: clickerState.totalClicks,
      sessionClicks: clickerState.sessionClicks,
      positionIndex: clickerState.posIndex,
    });

    // Stop if all positions completed
    if (shouldStop) {
      stopClicker('repeat_completed');
      return;
    }

    // Schedule next tick AFTER click completes
    if (clickerState.running) {
      const next = computeNextIntervalMs(cfgNow);
      clickerState.timer = setTimeout(tick, next);
    }
  };

  // Wait for interval BEFORE first click (not immediate)
  const firstInterval = computeNextIntervalMs(cfg);
  clickerState.timer = setTimeout(tick, firstInterval);
};

const registerGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();

    // Start/Stop (configurable)
    const okStartStop = globalShortcut.register(startStopHotkey, () => {
      if (clickerState.running) {
        stopClicker('hotkey');
      } else {
        startClicker('hotkey');
      }
    });
    if (!okStartStop) {
      mainWindow?.webContents?.send('hotkey-error', {
        key: startStopHotkey,
        message: 'Could not register Start/Stop hotkey',
      });
    }

    // Emergency Stop (configurable)
    const okEmergency = globalShortcut.register(emergencyStopHotkey, () => {
      stopClicker('emergency');
    });
    if (!okEmergency) {
      mainWindow?.webContents?.send('hotkey-error', {
        key: emergencyStopHotkey,
        message: 'Could not register Emergency Stop hotkey',
      });
    }
  } catch (e) {
    mainWindow?.webContents?.send('hotkey-error', {
      key: startStopHotkey,
      message: e?.message || 'Failed to register hotkeys',
    });
  }
};

const createWindow = () => {
  // Create the browser window with Windows 11 styling
  mainWindow = new BrowserWindow({
    width: 850,
    height: 750,
    minWidth: 700,
    minHeight: 650,
    frame: false, // Frameless for custom title bar
    transparent: false,
    backgroundColor: '#0d0f14',
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '../public/favicon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
  });

  // In development, load from Vite dev server
  // In production, load the built files
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    // Wait for Vite dev server to be ready before loading
    const tryLoadURL = (retries = 20, delay = 500) => {
      const http = require('http');
      http.get('http://localhost:8080', () => {
        mainWindow.loadURL('http://localhost:8080');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }).on('error', () => {
        if (retries > 0) {
          setTimeout(() => tryLoadURL(retries - 1, delay), delay);
        } else {
          mainWindow.loadURL('http://localhost:8080');
        }
      });
    };
    tryLoadURL();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

// Always on top
ipcMain.on('set-always-on-top', (event, value) => {
  const isOnTop = Boolean(value);
  // Use 'screen-saver' level on Windows for highest priority
  mainWindow?.setAlwaysOnTop(isOnTop, 'screen-saver');
  // Force focus after enabling to ensure it comes to front
  if (isOnTop) {
    mainWindow?.focus();
  }
});

ipcMain.handle('get-always-on-top', () => {
  return mainWindow?.isAlwaysOnTop() ?? false;
});

ipcMain.on('set-start-stop-hotkey', (event, key) => {
  if (typeof key !== 'string' || key.trim().length === 0) return;
  startStopHotkey = key.trim();
  registerGlobalShortcuts();
});

ipcMain.on('set-emergency-stop-hotkey', (event, key) => {
  if (typeof key !== 'string' || key.trim().length === 0) return;
  emergencyStopHotkey = key.trim();
  registerGlobalShortcuts();
});

// Clicker IPC
ipcMain.handle('clicker-set-config', (event, cfg) => {
  clickerState.config = cfg;
  return { success: true };
});

ipcMain.handle('clicker-start', async () => {
  await startClicker('ui');
  return { success: clickerState.running };
});

ipcMain.handle('clicker-stop', async () => {
  stopClicker('ui');
  return { success: true };
});

ipcMain.handle('clicker-get-status', () => {
  return {
    running: clickerState.running,
    totalClicks: clickerState.totalClicks,
    sessionClicks: clickerState.sessionClicks,
    positionIndex: clickerState.posIndex,
  };
});

// Mouse position handlers
ipcMain.handle('get-mouse-position', () => {
  const point = screen.getCursorScreenPoint();
  return { x: point.x, y: point.y };
});

ipcMain.on('start-mouse-capture', (event) => {
  if (mouseCaptureInterval) {
    clearInterval(mouseCaptureInterval);
  }
  mouseCaptureInterval = setInterval(() => {
    const point = screen.getCursorScreenPoint();
    event.sender.send('mouse-position-update', { x: point.x, y: point.y });
  }, 50);
});

ipcMain.on('stop-mouse-capture', () => {
  if (mouseCaptureInterval) {
    clearInterval(mouseCaptureInterval);
    mouseCaptureInterval = null;
  }
});

// Capture click position - simple countdown approach
ipcMain.handle('capture-click-position', async (event, countdownSeconds = 3) => {
  return new Promise((resolve) => {
    // Minimize window so user can position mouse
    mainWindow?.minimize();
    
    let secondsLeft = countdownSeconds;
    
    const countdownInterval = setInterval(() => {
      secondsLeft--;
      event.sender.send('capture-countdown', secondsLeft);
      
      if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
        
        // Capture position
        const point = screen.getCursorScreenPoint();
        
        // Restore window
        mainWindow?.restore();
        mainWindow?.focus();
        
        resolve({ x: point.x, y: point.y });
      }
    }, 1000);
  });
});

// Mouse click handlers - using PowerShell (works without native modules)
ipcMain.handle('perform-click', async (event, { x, y, button = 'left', clickType = 'single' }) => {
  try {
    // If x and y are not -1, move mouse to position
    if (x !== -1 && y !== -1) {
      await mouseController.moveMouse(x, y);
      // Small delay for mouse to settle
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Perform click
    await mouseController.click(button, clickType === 'double');
    
    return { success: true };
  } catch (error) {
    console.error('Click error:', error);
    return { success: false, error: error.message };
  }
});

// ─── Local File Storage IPC ─────────────────────────────────────────────────
const getStorageDir = () => app.getPath('userData');

const readJsonFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
};

const writeJsonFile = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// Device ID
ipcMain.handle('storage:get-device-id', () => {
  const filePath = path.join(getStorageDir(), 'device_id.txt');
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
    const id = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 15);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, id, 'utf-8');
    return id;
  } catch (e) { return null; }
});

// Profiles
ipcMain.handle('storage:get-profiles', () => {
  const filePath = path.join(getStorageDir(), 'profiles.json');
  return readJsonFile(filePath) || [];
});

ipcMain.handle('storage:save-profile', (event, profileData) => {
  const filePath = path.join(getStorageDir(), 'profiles.json');
  const profiles = readJsonFile(filePath) || [];
  const now = new Date().toISOString();
  const newProfile = {
    id: 'prof_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9),
    name: profileData.name,
    positions: profileData.positions || [],
    categories: profileData.categories || [],
    created_at: now,
    updated_at: now,
  };
  profiles.unshift(newProfile);
  writeJsonFile(filePath, profiles);
  return newProfile;
});

ipcMain.handle('storage:delete-profile', (event, id) => {
  const filePath = path.join(getStorageDir(), 'profiles.json');
  const profiles = readJsonFile(filePath) || [];
  const updated = profiles.filter(p => p.id !== id);
  writeJsonFile(filePath, updated);
  return true;
});

ipcMain.handle('check-robotjs', () => {
  // Always available now since we use PowerShell
  return { available: true };
});

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Initialize persistent PowerShell for ultra-fast clicks
  initPersistentPowerShell();
  
  createWindow();
  registerGlobalShortcuts();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {
    // ignore
  }
  
  // Clean up persistent PowerShell process
  if (psProcess) {
    try {
      psProcess.stdin.end();
      psProcess.kill();
    } catch (e) {
      // ignore
    }
    psProcess = null;
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
