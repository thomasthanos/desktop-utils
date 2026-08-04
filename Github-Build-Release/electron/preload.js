const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getProjectInfo: (path) => ipcRenderer.invoke('get-project-info', path),
    checkGhStatus: () => ipcRenderer.invoke('check-gh-status'),
    ensureGhReady: () => ipcRenderer.invoke('ensure-gh-ready'),
    getReleases: (path) => ipcRenderer.invoke('get-releases', path),
    createRelease: (data) => ipcRenderer.invoke('create-release', data),
    deleteRelease: (data) => ipcRenderer.invoke('delete-release', data),
    bulkDeleteReleases: (data) => ipcRenderer.invoke('bulk-delete-releases', data),
    aggregateReleaseNotes: (data) => ipcRenderer.invoke('aggregate-release-notes', data),

    triggerBuild: (data) => ipcRenderer.invoke('trigger-build', data),
    onBuildLog: (callback) => ipcRenderer.on('build-log', (_event, value) => callback(value)),
    removeBuildLogListener: () => ipcRenderer.removeAllListeners('build-log'),

    // Build completion event
    onBuildComplete: (callback) => ipcRenderer.on('build-complete', () => callback()),
    removeBuildCompleteListener: () => ipcRenderer.removeAllListeners('build-complete'),

    // AI formatting
    getApiKey: () => ipcRenderer.invoke('get-api-key'),
    saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
    formatWithAI: (data) => ipcRenderer.invoke('format-with-ai', data),
    generateReleaseFromDiff: (data) => ipcRenderer.invoke('generate-release-from-diff', data),

    // Commit history
    getCommits: (path) => ipcRenderer.invoke('get-commits', path)
});
