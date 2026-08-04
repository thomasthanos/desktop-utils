const { ipcRenderer } = require('electron');

// ─── Date helper ─────────────────────────────────────────────────────────────
const MONTHS_SHORT = ['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];
const formatDateShort = (timestamp) => {
    try {
        const d = new Date(timestamp);
        return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    } catch { return '—'; }
};

// ─── SVG Icons ───────────────────────────────────────────────────────────────
const Icons = {
    Bolt: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>),
    Minimize: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>),
    Maximize: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>),
    Restore: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="13" height="13" rx="2" /><path d="M6 9V6a2 2 0 0 1 2-2h3" /></svg>),
    Close: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
    Rocket: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></svg>),
    History: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>),
    Calendar: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>),
    HardDrive: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><line x1="6" y1="16" x2="6.01" y2="16" /><line x1="10" y1="16" x2="10.01" y2="16" /></svg>),
    Folder: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>),
    FolderOpen: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" /></svg>),
    Trash: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>),
    Info: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>),
    GitCompare: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></svg>),
    ArrowRight: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>),
    ChevronRight: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>),
    ChevronDown: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>),
    Search: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>),
    Clock: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>),
    Tag: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" /><path d="M7 7h.01" /></svg>),
    FileCode: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><path d="m10 13-2 2 2 2" /><path d="m14 17 2-2-2-2" /></svg>),
    Check: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>),
    AlertCircle: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>),
    Package: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>),
    Sparkles: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></svg>),
    AlertTriangle: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>),
    Plus: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>),
    Settings: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>),
    Edit: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>),
};

// ─── Apps Showcase ──────────────────────────────────────────────────────────
const SHOWCASE_APPS = [
    { name: 'Souvlatzidiko Unlocker', desc: 'Steam idle & achievement unlocker', tag: 'steam-idler', color1: '#1b9af7', color2: '#1565c0', repo: 'steam-idler', url: 'https://github.com/thomasthanos/steam-idler', screenshot: './assets/screenshots/steamidler.png' },
    { name: 'Make Your Life Easier', desc: 'All-in-one productivity desktop app', tag: 'MYLE', color1: '#10b981', color2: '#059669', repo: 'Make_Your_Life_Easier.A.E', url: 'https://github.com/thomasthanos/Make_Your_Life_Easier.A.E', screenshot: './assets/screenshots/makeyourlifeeasier.png' },
    { name: 'AutoClicker Premium', desc: 'Advanced auto clicker with profiles', tag: 'clicker', color1: '#f59e0b', color2: '#d97706', repo: 'autoclicker_premium', url: 'https://github.com/thomasthanos/autoclicker_premium', screenshot: './assets/screenshots/autoclicker_premium.png' },
    { name: 'GitHub Build & Release', desc: 'Auto build & publish GitHub releases', tag: 'CI/CD', color1: '#8b5cf6', color2: '#6d28d9', repo: 'Github-Build-Release', url: 'https://github.com/thomasthanos/Github-Build-Release', screenshot: './assets/screenshots/github release.png' },
    { name: 'Discord Package Viewer', desc: 'Explore your Discord data package', tag: 'discord', color1: '#5865f2', color2: '#4752c4', repo: 'discord_package_viewer', url: 'https://github.com/thomasthanos/discord_package_viewer', screenshot: './assets/screenshots/discord_package_viewer.png' },
];

function AppsShowcase() {
    const [active, setActive] = React.useState(0);
    const [animating, setAnimating] = React.useState(false);
    const [imgErrors, setImgErrors] = React.useState({});
    // dlState per repo: { pct, done, error, filePath }
    const [dlStates, setDlStates] = React.useState({});

    React.useEffect(() => {
        const t = setInterval(() => {
            setAnimating(true);
            setTimeout(() => {
                setActive(i => (i + 1) % SHOWCASE_APPS.length);
                setAnimating(false);
            }, 300);
        }, 7000);
        return () => clearInterval(t);
    }, []);

    // Listen for download progress from main
    React.useEffect(() => {
        const handler = (event, data) => {
            setDlStates(prev => ({
                ...prev,
                [data.repoSlug]: {
                    pct: data.pct,
                    done: !!data.done,
                    error: data.error || null,
                    filePath: data.filePath || null,
                }
            }));
            // Auto-clear done/error after 4s
            if (data.done || data.error) {
                setTimeout(() => setDlStates(prev => { const n = {...prev}; delete n[data.repoSlug]; return n; }), 4000);
            }
        };
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
    }, []);

    const go = (idx) => {
        if (idx === active) return;
        setAnimating(true);
        setTimeout(() => { setActive(idx); setAnimating(false); }, 300);
    };

    const handleDownload = async (app) => {
        if (!app.repo) return;
        const dl = dlStates[app.repo];
        if (dl && !dl.done && !dl.error && dl.pct >= 0) return; // already downloading
        setDlStates(prev => ({ ...prev, [app.repo]: { pct: 0, done: false, error: null } }));
        await ipcRenderer.invoke('download-release', app.repo);
    };

    const app = SHOWCASE_APPS[active];
    const hasImg = !imgErrors[active];
    const dl = dlStates[app.repo] || null;
    const isDownloading = dl && !dl.done && !dl.error && dl.pct >= 0;

    return (
        <div className="showcase-card">
            <div className="showcase-bg" style={{'--c1': app.color1, '--c2': app.color2}}></div>
            <div className="showcase-inner" style={{opacity: animating ? 0 : 1, transform: animating ? 'translateY(8px)' : 'translateY(0)', transition: 'opacity 0.3s ease, transform 0.3s ease'}}>
                {/* Top row: info + icon */}
                <div className="showcase-top">
                    <div className="showcase-text">
                        <div className="showcase-eyebrow">ThomasThanos · Open Source</div>
                        <div className="showcase-title">{app.name}</div>
                    </div>
                    <div className="showcase-icon" style={{background: `linear-gradient(135deg, ${app.color1}25, ${app.color2}25)`, border: `1px solid ${app.color1}35`}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke={app.color1} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
                    </div>
                </div>

                {/* Screenshot */}
                <div className="showcase-img-wrap">
                    {hasImg ? (
                        <img
                            src={app.screenshot}
                            alt={app.name}
                            className="showcase-img"
                            onError={() => setImgErrors(prev => ({...prev, [active]: true}))}
                        />
                    ) : (
                        <div className="showcase-img-placeholder" style={{borderColor: app.color1 + '30'}}>
                            <svg viewBox="0 0 24 24" fill="none" stroke={app.color1} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" width="32" height="32" style={{opacity:0.3}}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
                            <span style={{color: app.color1 + '55', fontSize: '11px', marginTop: '8px'}}>Δεν υπάρχει screenshot</span>
                            <span style={{color: 'rgba(255,255,255,0.2)', fontSize: '10px', marginTop: '3px', fontFamily: "'JetBrains Mono', monospace"}}>assets/screenshots/{app.screenshot.split('/').pop()}</span>
                        </div>
                    )}
                </div>

                {/* Bottom row: github link + dots + download */}
                <div className="showcase-bottom">
                    <button className="showcase-link" onClick={() => ipcRenderer.invoke('open-url', app.url)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
                        GitHub
                    </button>
                    <div className="showcase-dots">
                        {SHOWCASE_APPS.map((_, i) => (
                            <button key={i} className={`showcase-dot ${i === active ? 'active' : ''}`} style={i === active ? {background: app.color1} : {}} onClick={() => go(i)} />
                        ))}
                    </div>
                    <div className="showcase-dl-wrap" style={{'--ac': app.color1}}>
                        {isDownloading && (
                            <div className="showcase-dl-bar-track">
                                <div className="showcase-dl-bar-fill" style={{width: dl.pct >= 0 ? `${dl.pct}%` : '0%', background: app.color1}}></div>
                                <span className="showcase-dl-bar-pct">{dl.pct >= 0 ? `${dl.pct}%` : '...'}</span>
                            </div>
                        )}
                        {dl?.done && (
                            <div className="showcase-dl-done">
                                <svg viewBox="0 0 24 24" fill="none" stroke={app.color1} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>
                                <span style={{color: app.color1}}>Ολοκληρώθηκε!</span>
                            </div>
                        )}
                        {dl?.error && dl.error !== 'cancelled' && (
                            <div className="showcase-dl-done">
                                <svg viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                <span style={{color: '#f43f5e'}}>Σφάλμα</span>
                            </div>
                        )}
                        {!isDownloading && !dl?.done && !(dl?.error && dl.error !== 'cancelled') && (
                            <button
                                className="showcase-download-btn"
                                onClick={() => handleDownload(app)}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Download
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Empty state for new project form ────────────────────────────────────────
const emptyProject = { name: '', sourcePath: '', appExe: '', appName: '' };

// ─── Home View (macOS Launchpad) ─────────────────────────────────────────────
const ICON_GRADIENTS = [
    ['#4f87ff','#7c6cf0'],['#10b981','#06b6d4'],['#f59e0b','#ef4444'],
    ['#ec4899','#8b5cf6'],['#06b6d4','#4f87ff'],['#f97316','#f59e0b'],
    ['#84cc16','#10b981'],['#e879f9','#ec4899'],
];

function HomeView({ projects, activeProjectId, onSwitchProject, onAddProject, onRequestDeleteProject, isLoading, backupStatus }) {
    const totalBackups = projects.reduce((s, p) => s + (p.backupCount || 0), 0);
    const activeProj = projects.find(p => p.id === activeProjectId);

    const MAX_PROJECTS = 9; // slot 10 is always the Add button
    const sorted = [...projects]
        .map((p, i) => ({ ...p, _origIdx: i }))
        .sort((a, b) => {
            if (a.id === activeProjectId) return -1;
            if (b.id === activeProjectId) return 1;
            return (b.backupCount || 0) - (a.backupCount || 0);
        });
    const visibleIds = new Set(sorted.slice(0, MAX_PROJECTS).map(p => p.id));

    return (
        <div className="lp-root">
            <div className="lp-orb lp-orb1"></div>
            <div className="lp-orb lp-orb2"></div>
            <div className="lp-orb lp-orb3"></div>
            <div className="lp-topbar">
                <div className="lp-topbar-left">
                    <div className="lp-brand-icon"><Icons.Bolt /></div>
                    <div>
                        <div className="lp-brand-name">Backup Studio</div>
                        <div className="lp-brand-sub">Project Manager</div>
                    </div>
                </div>
                <div className="lp-topbar-stats">
                    <div className="lp-stat-pill">
                        <span className="lp-stat-dot" style={{background:'#60a5fa'}}></span>
                        <span><strong>{projects.length}</strong> projects</span>
                    </div>
                    <div className="lp-topbar-stats-divider"></div>
                    <div className="lp-stat-pill">
                        <span className="lp-stat-dot" style={{background:'#34d399'}}></span>
                        <span><strong>{totalBackups}</strong> backups</span>
                    </div>
                    <div className="lp-topbar-stats-divider"></div>
                    <div className="lp-stat-pill">
                        <span className="lp-stat-dot" style={{background:'#a78bfa'}}></span>
                        <span>Ενεργό: <strong>{activeProj?.name || '—'}</strong></span>
                    </div>
                </div>
                <div className="lp-topbar-right">
                    <button className="lp-add-btn" onClick={onAddProject}>
                        <Icons.Plus /> Νέο Project
                    </button>
                </div>
            </div>
            <div className="lp-grid">
                {projects.map((proj, idx) => {
                    const [c1, c2] = ICON_GRADIENTS[idx % ICON_GRADIENTS.length];
                    const isActive = proj.id === activeProjectId;
                    const isVisible = visibleIds.has(proj.id);
                    const initials = proj.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
                    const canDelete = projects.length > 1;
                    if (!isVisible) return null;
                    return (
                        <div
                            key={proj.id}
                            className={`lp-icon-wrap ${isActive ? 'lp-active' : ''}`}
                            title={canDelete ? 'Left click: open project • Right click: delete project' : 'Left click: open project'}
                            onContextMenu={e => {
                                e.preventDefault();
                                if (canDelete) onRequestDeleteProject(proj);
                            }}
                        >
                            {isActive && <div className="lp-pulse-ring" style={{'--c1': c1, '--c2': c2}}></div>}
                            <div className="lp-icon" style={{'--c1': c1, '--c2': c2}} onClick={() => onSwitchProject(proj.id)}>
                                <span className="lp-icon-letter">{initials}</span>
                            </div>
                            {(proj.backupCount || 0) > 0 && (
                                <div className="lp-badge">{proj.backupCount > 99 ? '99+' : proj.backupCount}</div>
                            )}
                            <div className="lp-label">
                                <div className="lp-label-name">{proj.name}</div>
                                {proj.totalSize && proj.totalSize !== '—' && <div className="lp-label-size">{proj.totalSize}</div>}
                                {proj.lastBackup && <div className="lp-label-date">{proj.lastBackup.split(',')[0]}</div>}
                            </div>
                        </div>
                    );
                })}
                <div className="lp-icon-wrap" onClick={onAddProject}>
                    <div className="lp-icon lp-icon-add" style={{'--c1':'#4f87ff','--c2':'#7c6cf0'}}>
                        <Icons.Plus />
                    </div>
                    <div className="lp-label"><div className="lp-label-name">Νέο Project</div></div>
                </div>
            </div>
            {isLoading && (
                <div className="lp-status-bar">
                    <div className="lp-status-dot"></div>
                    <span>{backupStatus || 'Backup σε εξέλιξη...'}</span>
                </div>
            )}
        </div>
    );
}

function App() {
    // ── Dropbox state ──
    const [dropboxStatus, setDropboxStatus] = React.useState(
        window.__initialData?.dropboxStatus || { found: null, running: null, path: null }
    );

    // ── Projects state ──
    const [projects, setProjects]               = React.useState(window.__initialData?.projects || []);
    const [activeProjectId, setActiveProjectId] = React.useState(window.__initialData?.activeProjectId || null);
    const [showProjectsDropdown, setShowProjectsDropdown] = React.useState(false);
    const [showProjectModal, setShowProjectModal]         = React.useState(false);
    const [editingProject, setEditingProject]             = React.useState(null); // null = add new
    const [projectForm, setProjectForm]                   = React.useState(emptyProject);
    const [deleteProjectModal, setDeleteProjectModal]     = React.useState(null);
    const [isDeletingProject, setIsDeletingProject]       = React.useState(false);

    // ── View state ──
    const [currentView, setCurrentView] = React.useState('home');

    const switchView = (view) => {
        if (view === currentView) return;
        const root = document.getElementById('root');
        const goingBig = view !== 'home';
        // animateResize in main takes 220ms (16 steps × ~14ms)
        const RESIZE_DURATION = 220;

        // Phase 1: fade + slight scale out immediately
        root.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
        root.style.opacity    = '0';
        root.style.transform  = goingBig ? 'scale(0.96)' : 'scale(1.03)';

        // Kick off window resize at the same time
        ipcRenderer.invoke('set-view-mode', view);

        // Phase 2: swap view content after fade-out (120ms)
        setTimeout(() => {
            setCurrentView(view);

            // Phase 3: wait for resize to finish, then fade in
            setTimeout(() => {
                root.style.transition = 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.22,1,0.36,1)';
                root.style.opacity    = '1';
                root.style.transform  = 'scale(1)';
                setTimeout(() => { root.style.transition = ''; }, 200);
            }, RESIZE_DURATION - 120 + 20); // wait remaining resize time + 20ms buffer
        }, 120);
    };
    const [projectsStats, setProjectsStats] = React.useState(window.__initialData?.projectsStats || []);

    // ── Backups state ──
    const [backups, setBackups]           = React.useState([]);
    const [selectedBackup, setSelectedBackup] = React.useState(null);
    const [activeTab, setActiveTab]       = React.useState('info');
    const [isLoading, setIsLoading]       = React.useState(false);
    const [backupStatus, setBackupStatus] = React.useState('');
    const [toast, setToast]               = React.useState(null);
    const [isMaximized, setIsMaximized]   = React.useState(false);
    const [paths, setPaths]               = React.useState({ source: '', dest: '' });
    const [deleteModal, setDeleteModal]   = React.useState(null);

    const [collapsedMonths, setCollapsedMonths] = React.useState(new Set());

    const [diffBackup1, setDiffBackup1]         = React.useState('');
    const [diffBackup2, setDiffBackup2]         = React.useState('');
    const [diffResults, setDiffResults]         = React.useState(null);
    const [selectedFileDiff, setSelectedFileDiff] = React.useState(null);

    // ── Init ──
    React.useEffect(() => {
        loadProjects();
        checkDropbox();
        ipcRenderer.on('backup-status', (event, status) => setBackupStatus(status));
        ipcRenderer.invoke('window-is-maximized').then(setIsMaximized);

        // Αν τα stats δεν έχουν κατεβεί ακόμα (βγαίνουν background), θέτε callback να ενημερώσει το state
        if (!window.__initialData?.projectsStats) {
            window.__statsReady = (stats) => {
                if (Array.isArray(stats)) setProjectsStats(stats);
                window.__statsReady = null;
            };
        }

        return () => {
            ipcRenderer.removeAllListeners('backup-status');
            window.__statsReady = null;
        };
    }, []);

    const checkDropbox = async () => {
        const status = await ipcRenderer.invoke('get-dropbox-status');
        setDropboxStatus(status);
    };

    const launchDropbox = async () => {
        await ipcRenderer.invoke('launch-dropbox');
        showToast('Εκκίνηση Dropbox… αναμένε 3 δευτερόλεπτα');
        // Re-check after a delay to update the pill
        setTimeout(checkDropbox, 3500);
    };

    // Close dropdown on outside click
    React.useEffect(() => {
        if (!showProjectsDropdown) return;
        const handler = () => setShowProjectsDropdown(false);
        setTimeout(() => document.addEventListener('click', handler), 0);
        return () => document.removeEventListener('click', handler);
    }, [showProjectsDropdown]);

    // ── Project loaders ──
    const refreshProjectsStats = async () => {
        const stats = await ipcRenderer.invoke('get-all-projects-stats');
        if (Array.isArray(stats)) {
            setProjectsStats(stats);
            return stats;
        }
        return [];
    };

    const displayProjects = React.useMemo(() => {
        const statsById = new Map((projectsStats || []).map(project => [project.id, project]));
        return (projects || []).map(project => ({
            ...project,
            ...(statsById.get(project.id) || {})
        }));
    }, [projects, projectsStats]);

    const loadProjects = async () => {
        const config = await ipcRenderer.invoke('get-projects');
        setProjects(config.projects);
        setActiveProjectId(config.activeProjectId);
        await refreshBackups();
        await refreshPaths();
        refreshProjectsStats(); // async, δεν περιμένουμε — γεμίζει τα icons αφού φορτώσουν
    };

    const refreshBackups = async () => {
        const result = await ipcRenderer.invoke('get-backups');
        setBackups(result);
        setSelectedBackup(prev => {
            if (!prev && result.length > 0) return result[0];
            // Keep selected if still exists
            const still = result.find(b => b.name === prev?.name);
            return still || (result.length > 0 ? result[0] : null);
        });
        if (result.length >= 2) {
            setDiffBackup1(result[1].path);
            setDiffBackup2(result[0].path);
        } else {
            setDiffBackup1('');
            setDiffBackup2('');
        }
        setDiffResults(null);
    };

    const refreshPaths = async () => {
        const result = await ipcRenderer.invoke('get-paths');
        setPaths(result);
    };

    const switchProject = async (projectId) => {
        await ipcRenderer.invoke('set-active-project', projectId);
        setActiveProjectId(projectId);
        setSelectedBackup(null);
        setShowProjectsDropdown(false);
        await refreshBackups();
        await refreshPaths();
        refreshProjectsStats();
        switchView('backups');
    };

    // ── Project CRUD ──
    const openAddProjectModal = () => {
        setEditingProject(null);
        setProjectForm(emptyProject);
        setShowProjectModal(true);
        checkDropbox();
    };

    const openEditProjectModal = (project) => {
        setEditingProject(project);
        setProjectForm({
            name: project.name,
            sourcePath: project.sourcePath,
            destPath: project.destPath,
            appExe: project.appExe || '',
            appName: project.appName
        });
        setShowProjectModal(true);
        setShowProjectsDropdown(false);
    };

    const handleBrowseFolder = async (field) => {
        const selected = await ipcRenderer.invoke('select-folder');
        if (selected) {
            setProjectForm(prev => ({ ...prev, [field]: selected }));
        }
    };

    const handleSaveProject = async () => {
        if (!projectForm.name.trim() || !projectForm.sourcePath.trim() || !projectForm.appName.trim()) {
            showToast('Συμπλήρωσε όλα τα υποχρεωτικά πεδία', true);
            return;
        }

        if (editingProject) {
            const updated = { ...editingProject, ...projectForm };
            await ipcRenderer.invoke('update-project', updated);
            showToast(`Το project "${projectForm.name}" ενημερώθηκε`);
            await loadProjects();
        } else {
            await ipcRenderer.invoke('add-project', projectForm);
            showToast(`Project "${projectForm.name}" προστέθηκε!`);
            await loadProjects();
        }
        setShowProjectModal(false);
    };

    const handleDeleteProject = async (project) => {
        setIsDeletingProject(true);
        const result = await ipcRenderer.invoke('remove-project', project.id);
        if (result.success) {
            showToast(`Project "${project.name}" διαγράφηκε`);
            setDeleteProjectModal(null);
            await loadProjects();
        } else {
            showToast(result.error, true);
            setDeleteProjectModal(null);
        }
        setIsDeletingProject(false);
    };

    // ── Backup ops ──
    const requestDeleteProject = (project) => {
        if (projects.length <= 1) {
            showToast('Πρέπει να υπάρχει τουλάχιστον ένα project.', true);
            return;
        }
        setDeleteProjectModal(project);
        setShowProjectsDropdown(false);
    };

    const showToast = (message, isError = false) => {
        setToast({ message, isError });
        setTimeout(() => setToast(null), 4000);
    };

    const handleBackup = async () => {
        setIsLoading(true);
        setBackupStatus('Εκκίνηση...');
        const result = await ipcRenderer.invoke('create-backup');
        setIsLoading(false);
        setBackupStatus('');
        if (result.success) {
            showToast(`Δημιουργήθηκε: ${result.backupName}`);
            refreshBackups();
        } else {
            showToast(`Σφάλμα: ${result.error}`, true);
        }
    };

    const handleDeleteClick = () => { if (selectedBackup) setDeleteModal(selectedBackup); };

    const handleDeleteConfirm = async () => {
        if (!deleteModal) return;
        const result = await ipcRenderer.invoke('delete-backup', deleteModal.path);
        if (result.success) {
            showToast('Το backup διαγράφηκε');
            setSelectedBackup(null);
            refreshBackups();
        } else {
            showToast(result.error?.includes('EBUSY')
                ? 'Σφάλμα: Το αρχείο είναι σε χρήση. Παύστε το sync του Dropbox και δοκιμάστε ξανά.'
                : `Σφάλμα: ${result.error}`, true);
        }
        setDeleteModal(null);
    };

    const handleOpenFolder = async () => {
        if (selectedBackup) await ipcRenderer.invoke('open-folder', selectedBackup.path);
    };

    const handleCompare = async () => {
        if (!diffBackup1 || !diffBackup2) return;
        setIsLoading(true);
        const result = await ipcRenderer.invoke('get-diff', diffBackup1, diffBackup2);
        setIsLoading(false);
        if (result.success) setDiffResults(result.diffs);
    };

    const handleFileClick = async (file) => {
        if (file.status !== 'modified') return;
        const result = await ipcRenderer.invoke('get-file-diff', diffBackup1, diffBackup2, file.file);
        if (result.success) setSelectedFileDiff({ file: file.file, changes: result.changes, status: file.status });
    };

    const getDiffStats = () => {
        if (!diffResults) return { added: 0, modified: 0, deleted: 0 };
        return {
            added:    diffResults.filter(d => d.status === 'added').length,
            modified: diffResults.filter(d => d.status === 'modified').length,
            deleted:  diffResults.filter(d => d.status === 'deleted').length
        };
    };

    const groupedBackups = React.useMemo(() => {
        const groups = {};
        backups.forEach(backup => {
            const month = backup.monthDisplay || backup.monthFolder || 'Άλλα';
            if (!groups[month]) groups[month] = [];
            groups[month].push(backup);
        });
        return groups;
    }, [backups]);

    // Auto-collapse all months except the first (current) when backups load
    React.useEffect(() => {
        const months = Object.keys(groupedBackups);
        if (months.length > 1) {
            setCollapsedMonths(new Set(months.slice(1)));
        }
    }, [Object.keys(groupedBackups).join(',')]);

    const toggleMonth = (month) => {
        setCollapsedMonths(prev => {
            const next = new Set(prev);
            next.has(month) ? next.delete(month) : next.add(month);
            return next;
        });
    };

    const stats = getDiffStats();
    const activeProject = projects.find(p => p.id === activeProjectId);

    const handleWindowControl = async (action) => {
        await ipcRenderer.invoke(`window-${action}`);
        if (action === 'maximize') setIsMaximized(prev => !prev);
    };

    // ─── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            {/* Titlebar */}
            <div className="titlebar">
                <div className="titlebar-left">
                    <div className="titlebar-icon"><Icons.Bolt /></div>
                    <span className="titlebar-title">Backup Studio</span>
                </div>
                <div className="titlebar-nav">
                    <button
                        className={`titlebar-nav-btn ${currentView === 'home' ? 'active' : ''}`}
                        onClick={() => switchView('home')}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'13px',height:'13px'}}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                        Home
                    </button>
                    <button
                        className={`titlebar-nav-btn ${currentView === 'backups' ? 'active' : ''}`}
                        onClick={() => switchView('backups')}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'13px',height:'13px'}}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
                        Backups
                    </button>
                </div>
                <div className="titlebar-controls">
                    <button className="titlebar-btn" onClick={() => handleWindowControl('minimize')}><Icons.Minimize /></button>
                    <button className="titlebar-btn" onClick={() => handleWindowControl('maximize')}>{isMaximized ? <Icons.Restore /> : <Icons.Maximize />}</button>
                    <button className="titlebar-btn close" onClick={() => handleWindowControl('close')}><Icons.Close /></button>
                </div>
            </div>

            {currentView === 'home' ? (
                <div className="home-wrapper">
                    <div className="home-scroll">
                        <HomeView
                            projects={displayProjects}
                            activeProjectId={activeProjectId}
                            onSwitchProject={switchProject}
                            onAddProject={openAddProjectModal}
                            onRequestDeleteProject={requestDeleteProject}
                            isLoading={isLoading}
                            backupStatus={backupStatus}
                        />
                    </div>
                </div>
            ) : (
            <div className="app-wrapper">
                {/* ── Sidebar ── */}
                <div className="sidebar">
                    <div className="sidebar-header">
                        <div className="brand">
                            <div className="brand-icon"><Icons.Bolt /></div>
                            <div className="brand-text">
                                <h1>Backup Studio</h1>
                                <span>MakeYourLifeEasier</span>
                            </div>
                        </div>

                        {/* Dropbox Status Pill */}
                        {dropboxStatus.found !== null && (
                            <div className={`dropbox-pill ${dropboxStatus.found && dropboxStatus.running ? 'ok' : dropboxStatus.found ? 'warn' : 'err'}`}>
                                <span className="dropbox-pill-dot"></span>
                                <span className="dropbox-pill-label">
                                    {!dropboxStatus.found && 'Dropbox: Δεν βρέθηκε'}
                                    {dropboxStatus.found && !dropboxStatus.running && 'Dropbox: Σταματημένο'}
                                    {dropboxStatus.found && dropboxStatus.running && 'Dropbox: Online'}
                                </span>
                                {dropboxStatus.found && !dropboxStatus.running ? (
                                    <button className="dropbox-pill-launch" onClick={launchDropbox} title="Εκκίνηση Dropbox">
                                        <Icons.Rocket />
                                    </button>
                                ) : (
                                    <button className="dropbox-pill-refresh" onClick={checkDropbox} title="Refresh">
                                        <Icons.ArrowRight />
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Project Switcher */}
                        <div className="project-switcher-wrapper" onClick={e => e.stopPropagation()}>
                            <div className="project-switcher-row">
                                <button
                                    className="project-switcher-btn"
                                    onClick={() => setShowProjectsDropdown(prev => !prev)}
                                >
                                    <div className="project-switcher-dot"></div>
                                    <span className="project-switcher-name">{activeProject?.name || 'Επιλογή project'}</span>
                                    <span className="project-switcher-chevron"><Icons.ChevronDown /></span>
                                </button>
                                <button className="project-add-btn" title="Νέο project" onClick={openAddProjectModal}>
                                    <Icons.Plus />
                                </button>
                            </div>

                            {showProjectsDropdown && (
                                <div className="project-dropdown">
                                    {projects.map(p => (
                                        <div
                                            key={p.id}
                                            className={`project-dropdown-item ${p.id === activeProjectId ? 'active' : ''}`}
                                        >
                                            <span
                                                className="project-dropdown-name"
                                                onClick={() => switchProject(p.id)}
                                            >
                                                {p.id === activeProjectId && <span className="project-active-dot">●</span>}
                                                {p.name}
                                            </span>
                                            <div className="project-dropdown-actions">
                                                <button
                                                    className="project-icon-btn"
                                                    title="Επεξεργασία"
                                                    onClick={() => openEditProjectModal(p)}
                                                ><Icons.Edit /></button>
                                                {projects.length > 1 && (
                                                    <button
                                                        className="project-icon-btn danger"
                                                        title="Διαγραφή"
                                                        onClick={() => requestDeleteProject(p)}
                                                    ><Icons.Trash /></button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <div className="project-dropdown-divider"></div>
                                    <button className="project-dropdown-add" onClick={() => { openAddProjectModal(); setShowProjectsDropdown(false); }}>
                                        <Icons.Plus /> Νέο project
                                    </button>
                                </div>
                            )}
                        </div>

                        <button className={`backup-btn ${isLoading ? 'loading' : ''}`} onClick={handleBackup} disabled={isLoading}>
                            {isLoading
                                ? (<><div className="spinner"></div><span>{backupStatus}</span></>)
                                : (<><Icons.Rocket /><span>Δημιουργία Backup</span></>)}
                        </button>
                    </div>

                    <div className="stats-row">
                        <div className="stat-box">
                            <div className="stat-value blue">{backups.length}</div>
                            <div className="stat-label">Σύνολο</div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-value emerald">V{backups[0]?.version || 0}</div>
                            <div className="stat-label">Τελευταίο</div>
                        </div>
                    </div>

                    <div className="backup-list-section" style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0}}>
                        <div className="list-header"><Icons.History /><span>Ιστορικό</span></div>
                        <div className="backup-list">
                            {Object.entries(groupedBackups).map(([month, monthBackups], monthIdx) => {
                                const isCollapsed = collapsedMonths.has(month);
                                return (
                                <div key={month} className="month-group">
                                    <div className={`month-label ${monthIdx > 0 ? 'month-label-clickable' : ''}`} onClick={() => monthIdx > 0 && toggleMonth(month)}>
                                        <Icons.Calendar />
                                        <span>{month}</span>
                                        {monthIdx > 0 && (
                                            <span className={`month-chevron ${isCollapsed ? '' : 'open'}`}>
                                                <Icons.ChevronRight />
                                            </span>
                                        )}
                                    </div>
                                    {!isCollapsed && monthBackups.map(backup => (
                                        <div
                                            key={backup.name}
                                            className={`backup-item ${selectedBackup?.name === backup.name ? 'selected' : ''}`}
                                            onClick={() => setSelectedBackup(backup)}
                                        >
                                            <div className="backup-item-icon">
                                                <Icons.Package />
                                            </div>
                                            <div className="backup-item-info">
                                                <div className="backup-item-name">{backup.name}</div>
                                                <div className="backup-item-date">
                                                    <Icons.Calendar />
                                                    {formatDateShort(backup.timestamp)}
                                                </div>
                                            </div>
                                            {backup.name === backups[0]?.name && (
                                                <span className="backup-item-size-badge">{backup.size}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                );
                            })}
                        </div>
                    </div>


                </div>

                {/* ── Main content ── */}
                <div className="main-content">
                    <div className="content-header">
                        <div className="header-info">
                            <h2>{selectedBackup ? selectedBackup.name : 'Επιλέξτε backup'}</h2>
                            <p>{selectedBackup ? `Δημιουργήθηκε: ${selectedBackup.date}` : 'Επιλέξτε από το ιστορικό ή δημιουργήστε νέο'}</p>
                        </div>
                        <div className="tabs-container">
                            <button className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}><Icons.Info />Πληροφορίες</button>
                            <button className={`tab-btn ${activeTab === 'diff' ? 'active' : ''}`} onClick={() => setActiveTab('diff')}><Icons.GitCompare />Σύγκριση</button>
                        </div>
                        {selectedBackup && (
                            <div className="actions">
                                <button className="action-btn" onClick={handleOpenFolder} title="Άνοιγμα φακέλου"><Icons.FolderOpen /></button>
                                <button className="action-btn danger" onClick={handleDeleteClick} title="Διαγραφή"><Icons.Trash /></button>
                            </div>
                        )}
                    </div>

                    <div className="content-body">
                        {activeTab === 'info' && selectedBackup && (() => {
                            const backupIndex = backups.findIndex(b => b.name === selectedBackup.name);
                            const prevBackup = backups[backupIndex + 1] || null;
                            const nextBackup = backupIndex > 0 ? backups[backupIndex - 1] : null;
                            const isLatest = backupIndex === 0;
                            const positionLabel = `#${backups.length - backupIndex} από ${backups.length}`;
                            return (
                            <div className="info-layout">
                                {/* ── Hero Banner ── */}
                                <div className="info-hero">
                                    <div className="info-hero-left">
                                        <div className="info-hero-icon">
                                            <Icons.Package />
                                        </div>
                                        <div>
                                            <div className="info-hero-name">{selectedBackup.name}</div>
                                            <div className="info-hero-meta">
                                                <span className="info-hero-pill blue">Version {selectedBackup.version}</span>
                                                <span className="info-hero-pill emerald">Day {selectedBackup.day}</span>
                                                {isLatest && <span className="info-hero-pill gold">★ Τελευταίο</span>}
                                                {selectedBackup.isMigrated && <span className="info-hero-pill amber">⚠ Legacy</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="info-hero-right">
                                        <div className="info-hero-stat">
                                            <span className="info-hero-stat-value">{selectedBackup.size}</span>
                                            <span className="info-hero-stat-label">Μέγεθος</span>
                                        </div>
                                        <div className="info-hero-divider"></div>
                                        <div className="info-hero-stat">
                                            <span className="info-hero-stat-value">{positionLabel}</span>
                                            <span className="info-hero-stat-label">Θέση</span>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Metrics Row ── */}
                                <div className="info-metrics">
                                    <div className="info-metric">
                                        <div className="info-metric-icon emerald"><Icons.Calendar /></div>
                                        <div className="info-metric-body">
                                            <div className="info-metric-label">Ημερομηνία</div>
                                            <div className="info-metric-value">{selectedBackup.date}</div>
                                        </div>
                                    </div>
                                    <div className="info-metric">
                                        <div className="info-metric-icon blue"><Icons.Tag /></div>
                                        <div className="info-metric-body">
                                            <div className="info-metric-label">Έκδοση</div>
                                            <div className="info-metric-value">V{selectedBackup.version}</div>
                                        </div>
                                    </div>
                                    <div className="info-metric">
                                        <div className="info-metric-icon amber"><Icons.HardDrive /></div>
                                        <div className="info-metric-body">
                                            <div className="info-metric-label">Μέγεθος</div>
                                            <div className="info-metric-value">{selectedBackup.size}</div>
                                        </div>
                                    </div>
                                    <div className="info-metric">
                                        <div className="info-metric-icon violet"><Icons.Clock /></div>
                                        <div className="info-metric-body">
                                            <div className="info-metric-label">Ημέρα Μήνα</div>
                                            <div className="info-metric-value">Day {selectedBackup.day}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Apps Showcase ── */}
                                <AppsShowcase />

                                {selectedBackup.isMigrated && (
                                    <div className="info-warning-banner">
                                        <Icons.AlertTriangle />
                                        <span>Αυτό το backup δημιουργήθηκε πριν την ενημέρωση metadata. Η ημερομηνία βασίζεται στα στοιχεία αρχείου.</span>
                                    </div>
                                )}
                            </div>
                            );
                        })()}

                        {activeTab === 'diff' && (
                            <div className="diff-wrapper">
                                <div className="diff-selector-card">
                                    <div className="select-group">
                                        <div className="select-label"><Icons.Clock />Παλιά Έκδοση</div>
                                        <select className="select-input" value={diffBackup1} onChange={e => setDiffBackup1(e.target.value)}>
                                            <option value="">Επιλογή...</option>
                                            {backups.map(b => (<option key={b.path} value={b.path}>{b.name}</option>))}
                                        </select>
                                    </div>
                                    <div className="diff-arrow"><Icons.ArrowRight /></div>
                                    <div className="select-group">
                                        <div className="select-label"><Icons.Sparkles />Νέα Έκδοση</div>
                                        <select className="select-input" value={diffBackup2} onChange={e => setDiffBackup2(e.target.value)}>
                                            <option value="">Επιλογή...</option>
                                            {backups.map(b => (<option key={b.path} value={b.path}>{b.name}</option>))}
                                        </select>
                                    </div>
                                    <button className="compare-btn" onClick={handleCompare}><Icons.Search />Σύγκριση</button>
                                </div>
                                {diffResults && (
                                    <>
                                        <div className="diff-stats">
                                            <div className="diff-stat-card added"><div className="diff-stat-value">{stats.added}</div><div className="diff-stat-label">Νέα Αρχεία</div></div>
                                            <div className="diff-stat-card modified"><div className="diff-stat-value">{stats.modified}</div><div className="diff-stat-label">Τροποποιημένα</div></div>
                                            <div className="diff-stat-card deleted"><div className="diff-stat-value">{stats.deleted}</div><div className="diff-stat-label">Διαγραμμένα</div></div>
                                        </div>
                                        <div className="file-list-card">
                                            <div className="file-list-header">
                                                <div className="file-list-title"><Icons.FileCode />Αρχεία με Αλλαγές</div>
                                                <div className="file-count-badge">{diffResults.length} αρχεία</div>
                                            </div>
                                            <div className="file-list">
                                                {diffResults.length === 0
                                                    ? (<div className="empty-state"><div className="empty-state-icon"><Icons.Check /></div><div className="empty-state-title">Καμία Αλλαγή</div><div className="empty-state-text">Τα backups είναι πανομοιότυπα</div></div>)
                                                    : diffResults.map((file, idx) => (
                                                        <div key={idx} className={`file-item ${file.status === 'modified' ? 'clickable' : ''}`} onClick={() => handleFileClick(file)}>
                                                            <div className={`file-status-indicator ${file.status}`}></div>
                                                            <div className="file-path">{file.file}</div>
                                                            <span className={`file-status-badge ${file.status}`}>
                                                                {file.status === 'added' && 'ΝΕΟ'}
                                                                {file.status === 'modified' && 'ΤΡΟΠΟΠΟΙΗΜΕΝΟ'}
                                                                {file.status === 'deleted' && 'ΔΙΑΓΡΑΜΜΕΝΟ'}
                                                            </span>
                                                            {file.status === 'modified' && (<div className="file-arrow"><Icons.ChevronRight /></div>)}
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {!selectedBackup && activeTab === 'info' && (
                            <div className="empty-state">
                                <div className="empty-state-icon"><Icons.Package /></div>
                                <div className="empty-state-title">Κανένα Backup Επιλεγμένο</div>
                                <div className="empty-state-text">Επιλέξτε ένα backup από την λίστα ή δημιουργήστε νέο</div>
                            </div>
                        )}
                    </div>

                    <div className="footer-bar">
                        <div className="path-info"><span className="path-label">SOURCE:</span><span>{paths.source}</span></div>
                        <div className="path-info"><span className="path-label">DEST:</span><span>{paths.dest}</span></div>
                    </div>
                </div>
            </div>
            )} {/* end currentView ternary */}

            {/* ── File diff modal ── */}
            {selectedFileDiff && (
                <div className="modal-overlay" onClick={() => setSelectedFileDiff(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-row">
                                <div className="modal-title">{selectedFileDiff.file}</div>
                                <span className={`file-status-badge ${selectedFileDiff.status}`}>{selectedFileDiff.status.toUpperCase()}</span>
                            </div>
                            <button className="modal-close" onClick={() => setSelectedFileDiff(null)}><Icons.Close /></button>
                        </div>
                        <div className="modal-body">
                            {selectedFileDiff.changes.map((change, idx) => (
                                <div key={idx} className={`diff-line ${change.added ? 'added' : ''} ${change.removed ? 'removed' : ''} ${change.omitted ? 'context-gap' : ''}`}>
                                    <div className="diff-line-num">{idx + 1}</div>
                                    <div className="diff-line-content">{change.value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete backup modal ── */}
            {deleteModal && (
                <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
                    <div className="modal delete-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-body">
                            <div className="delete-icon-wrapper"><Icons.AlertTriangle /></div>
                            <div className="delete-title">Διαγραφή Backup</div>
                            <div className="delete-message">Είστε σίγουροι; Η ενέργεια δεν μπορεί να αναιρεθεί.</div>
                            <div className="delete-backup-name">{deleteModal.name}</div>
                            <div className="delete-actions">
                                <button className="btn btn-cancel" onClick={() => setDeleteModal(null)}><Icons.Close />Ακύρωση</button>
                                <button className="btn btn-danger" onClick={handleDeleteConfirm}><Icons.Trash />Διαγραφή</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete PROJECT modal ── */}
            {deleteProjectModal && (
                <div className="modal-overlay" onClick={() => setDeleteProjectModal(null)}>
                    <div className="modal delete-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-body">
                            <div className="delete-icon-wrapper"><Icons.AlertTriangle /></div>
                            <div className="delete-title">Διαγραφή Project</div>
                            <div className="delete-message">Θα διαγραφεί μόνο η ρύθμιση. Τα backup αρχεία σου παραμένουν στο δίσκο.</div>
                            <div className="delete-message"><strong>Θα διαγραφεί και ο φάκελος backup του project από το Dropbox.</strong></div>
                            <div className="delete-backup-name">{deleteProjectModal.name}</div>
                            <div className="delete-actions">
                                <button className="btn btn-cancel" onClick={() => setDeleteProjectModal(null)}><Icons.Close />Ακύρωση</button>
                                <button className="btn btn-danger" onClick={() => handleDeleteProject(deleteProjectModal)}><Icons.Trash />Διαγραφή</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add / Edit Project Modal ── */}
            {showProjectModal && (
                <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
                    <div className="modal project-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-row">
                                <div className="modal-title">{editingProject ? 'Επεξεργασία Project' : 'Νέο Project'}</div>
                            </div>
                            <button className="modal-close" onClick={() => setShowProjectModal(false)}><Icons.Close /></button>
                        </div>
                        <div className="modal-body project-form">

                            {/* Dropbox status inside modal */}
                            <div className={`modal-dropbox-banner ${
                                dropboxStatus.found && dropboxStatus.running ? 'ok'
                                : dropboxStatus.found ? 'warn' : 'err'
                            }`}>
                                <span className="modal-dropbox-dot"></span>
                                <div className="modal-dropbox-text">
                                    {!dropboxStatus.found && (
                                        <><strong>Dropbox δεν βρέθηκε</strong><span>Η εφαρμογή χρησιμοποιεί το Dropbox για τα backups. Εγκατάστησέ το πρώτα.</span></>
                                    )}
                                    {dropboxStatus.found && !dropboxStatus.running && (
                                        <><strong>Dropbox σταματημένο</strong><span>Τα backups θα γίνουν στο: <code>{dropboxStatus.path}\Projects Backup\{projectForm.appName || '{AppName}'}</code></span></>
                                    )}
                                    {dropboxStatus.found && dropboxStatus.running && (
                                        <><strong>Dropbox Online ✓</strong><span>Backups → <code>{dropboxStatus.path}\Projects Backup\{projectForm.appName || '{AppName}'}</code></span></>
                                    )}
                                </div>
                            </div>

                            {/* Name */}
                            <div className="form-group">
                                <label className="form-label">Όνομα <span className="required">*</span></label>
                                <input
                                    className="form-input"
                                    type="text"
                                    placeholder="π.χ. My Awesome App"
                                    value={projectForm.name}
                                    onChange={e => {
                                        const name = e.target.value;
                                        // Auto-generate appName: remove spaces & special chars
                                        const autoAppName = name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_\-\.]/g, '');
                                        setProjectForm(p => ({
                                            ...p,
                                            name,
                                            // Only auto-fill if user hasn't manually edited appName
                                            appName: p._appNameManuallyEdited ? p.appName : autoAppName
                                        }));
                                    }}
                                />
                            </div>

                            {/* App Name (prefix) - auto + info tooltip */}
                            <div className="form-group">
                                <label className="form-label">
                                    App Name
                                    <span className="info-tooltip-wrapper">
                                        <span className="info-icon">?</span>
                                        <span className="info-popout">
                                            <strong>Τι είναι το App Name;</strong>
                                            Είναι το prefix που χρησιμοποιείται για να ονομαστούν οι φάκελοι των backups σου.
                                            <br/><br/>
                                            <span className="info-example">MyApp → MyApp_D5_V3</span>
                                            <br/>
                                            <span className="info-sub">D5 = 5η του μήνα &nbsp;·&nbsp; V3 = Version 3</span>
                                        </span>
                                    </span>
                                </label>
                                <input
                                    className="form-input"
                                    type="text"
                                    placeholder="Συμπληρώνεται αυτόματα από το Όνομα"
                                    value={projectForm.appName}
                                    onChange={e => setProjectForm(p => ({ ...p, appName: e.target.value, _appNameManuallyEdited: true }))}
                                />
                            </div>

                            {/* Source path */}
                            <div className="form-group">
                                <label className="form-label">Source Path (φάκελος project) <span className="required">*</span></label>
                                <div className="path-input-row">
                                    <input
                                        className="form-input"
                                        type="text"
                                        placeholder="D:\Projects\MyApp"
                                        value={projectForm.sourcePath}
                                        onChange={e => setProjectForm(p => ({ ...p, sourcePath: e.target.value }))}
                                    />
                                    <button className="browse-btn" onClick={() => handleBrowseFolder('sourcePath')}>
                                        <Icons.Folder /> Browse
                                    </button>
                                </div>
                            </div>

                            {/* App Exe */}
                            <div className="form-group">
                                <label className="form-label">App Executable <span className="optional">(προαιρετικό — κλείνει την εφαρμογή πριν το backup)</span></label>
                                <input
                                    className="form-input"
                                    type="text"
                                    placeholder="π.χ. MyApp.exe"
                                    value={projectForm.appExe}
                                    onChange={e => setProjectForm(p => ({ ...p, appExe: e.target.value }))}
                                />
                            </div>

                            <div className="form-actions">
                                <button className="btn btn-cancel" onClick={() => setShowProjectModal(false)}><Icons.Close />Ακύρωση</button>
                                <button className="btn btn-primary" onClick={handleSaveProject}>
                                    <Icons.Check />{editingProject ? 'Αποθήκευση' : 'Προσθήκη'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className={`toast ${toast.isError ? 'error' : ''}`}>
                    <div className="toast-icon-wrap">
                        {toast.isError ? <Icons.AlertCircle /> : <Icons.Check />}
                    </div>
                    <div className="toast-body">
                        <div className="toast-label">{toast.isError ? 'Σφάλμα' : 'Επιτυχία'}</div>
                        <div className="toast-message">{toast.message}</div>
                    </div>
                    <div className="toast-progress">
                        <div className="toast-progress-fill"></div>
                    </div>
                </div>
            )}
        </>
    );
}

// Cache root to avoid createRoot() duplicate warning
if (!window.__reactRoot) {
    window.__reactRoot = ReactDOM.createRoot(document.getElementById('root'));
}

window.__reactRoot.render(<App />);
