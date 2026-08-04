const { ipcRenderer } = require('electron');

window.__initialData = {
    projects: null,
    projectsStats: null,
    activeProjectId: null,
    dropboxStatus: null,
    loaded: false
};

(async function loadInitialData() {
    try {
        // Φορτώνουμε πρώτα projects + dropbox (γρήγορα) και σημαίνουμε loaded=true αμέσως
        // ώστε ο splash να μην περιμένει το βαρύ ανάγνωσμα stats
        const [config, dropbox] = await Promise.all([
            ipcRenderer.invoke('get-projects'),
            ipcRenderer.invoke('get-dropbox-status'),
        ]);

        window.__initialData.projects        = config.projects;
        window.__initialData.activeProjectId = config.activeProjectId;
        window.__initialData.dropboxStatus   = dropbox;
        window.__initialData.loaded          = true; // εδώ! ο splash μπορεί να συνεχίσει

        // Stats (βαρύ ανάγνωσμα filesystem) φορτώνονται στο background μετά την εκκίνηση
        ipcRenderer.invoke('get-all-projects-stats').then(stats => {
            window.__initialData.projectsStats = stats;
            // Ενημέρωσε το React αν έχει ήδη φορτωθεί
            if (window.__statsReady) window.__statsReady(stats);
        }).catch(err => {
            console.error('Stats load failed:', err);
            window.__initialData.projectsStats = [];
            if (window.__statsReady) window.__statsReady([]);
        });

    } catch (err) {
        console.error('Preload failed:', err);
        window.__initialData.loaded = true;
    }
})();
