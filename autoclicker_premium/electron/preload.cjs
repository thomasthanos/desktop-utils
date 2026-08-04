const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  
  // Mouse position capture
  getMousePosition: () => ipcRenderer.invoke('get-mouse-position'),
  startMouseCapture: (callback) => {
    const handler = (event, position) => callback(position);
    ipcRenderer.on('mouse-position-update', handler);
    ipcRenderer.send('start-mouse-capture');
    return () => {
      ipcRenderer.removeListener('mouse-position-update', handler);
      ipcRenderer.send('stop-mouse-capture');
    };
  },
  captureClickPosition: (countdownSeconds) => ipcRenderer.invoke('capture-click-position', countdownSeconds),
  onCaptureCountdown: (callback) => {
    const handler = (event, secondsLeft) => callback(secondsLeft);
    ipcRenderer.on('capture-countdown', handler);
    return () => ipcRenderer.removeListener('capture-countdown', handler);
  },
  
  // Mouse clicking
  performClick: (options) => ipcRenderer.invoke('perform-click', options),
  checkRobotjs: () => ipcRenderer.invoke('check-robotjs'),

  // Global hotkeys (main process)
  setStartStopHotkey: (key) => ipcRenderer.send('set-start-stop-hotkey', key),
  setEmergencyStopHotkey: (key) => ipcRenderer.send('set-emergency-stop-hotkey', key),
  onGlobalStartStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('global-start-stop', handler);
    return () => ipcRenderer.removeListener('global-start-stop', handler);
  },
  onGlobalEmergencyStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('global-emergency-stop', handler);
    return () => ipcRenderer.removeListener('global-emergency-stop', handler);
  },
  onHotkeyError: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('hotkey-error', handler);
    return () => ipcRenderer.removeListener('hotkey-error', handler);
  },

  // Clicker engine (main process)
  clickerSetConfig: (cfg) => ipcRenderer.invoke('clicker-set-config', cfg),
  clickerStart: () => ipcRenderer.invoke('clicker-start'),
  clickerStop: () => ipcRenderer.invoke('clicker-stop'),
  clickerGetStatus: () => ipcRenderer.invoke('clicker-get-status'),
  onClickerStatus: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('clicker-status', handler);
    return () => ipcRenderer.removeListener('clicker-status', handler);
  },
  onClickerStats: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('clicker-stats', handler);
    return () => ipcRenderer.removeListener('clicker-stats', handler);
  },
  onClickerError: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('clicker-error', handler);
    return () => ipcRenderer.removeListener('clicker-error', handler);
  },
  onClickerDebug: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('clicker-debug', handler);
    return () => ipcRenderer.removeListener('clicker-debug', handler);
  },
  onIntervalDebug: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('interval-debug', handler);
    return () => ipcRenderer.removeListener('interval-debug', handler);
  },
  
  // Local file storage (AppData\Roaming\ThomasThanos\AutoClicker)
  storage: {
    getDeviceId: () => ipcRenderer.invoke('storage:get-device-id'),
    getProfiles: () => ipcRenderer.invoke('storage:get-profiles'),
    saveProfile: (data) => ipcRenderer.invoke('storage:save-profile', data),
    deleteProfile: (id) => ipcRenderer.invoke('storage:delete-profile', id),
  },

  // Check if running in Electron
  isElectron: true,
  
  // Platform info
  platform: process.platform,
});
