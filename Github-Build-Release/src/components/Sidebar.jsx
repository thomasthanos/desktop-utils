import React from 'react';
import {
  FaCodeBranch,
  FaCopy,
  FaFolder,
  FaFolderOpen,
  FaPen,
  FaTerminal
} from 'react-icons/fa';
import '../styles/Sidebar.css';

const NAV_ITEMS = [
  { id: 'create', label: 'Create Release', icon: FaPen },
  { id: 'history', label: 'Release History', icon: FaCodeBranch },
  { id: 'logs', label: 'Build Logs', icon: FaTerminal }
];

function Sidebar({
  activeTab,
  setActiveTab,
  projectPath,
  projectVersion,
  pendingPackageVersion,
  buildCommand,
  setBuildCommand,
  handleSelectFolder,
  isBuilding,
  releasesCount,
  tagsCount,
  handleCopyToClipboard
}) {
  const projectName = projectPath
    ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath
    : '';

  return (
    <aside className="sidebar glass-panel" aria-label="Release workspace navigation">
      <div className="sidebar-content hidden-scrollbar">
        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const disabled = !projectPath;
            const active = activeTab === id;

            return (
              <button
                key={id}
                type="button"
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => !disabled && setActiveTab(id)}
                disabled={disabled}
                aria-current={active ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{React.createElement(Icon)}</span>
                <span>{label}</span>
                {id === 'history' && releasesCount > 0 && (
                  <span className="nav-badge">{releasesCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <section className="project-card" aria-labelledby="workspace-card-title">
          <div className="project-header">
            <span className="project-icon" aria-hidden="true"><FaFolder /></span>
            <div className="project-heading-copy">
              <span className="project-subtitle">Current project</span>
              <strong className="project-title" id="workspace-card-title">
                {projectName || 'No workspace'}
              </strong>
            </div>
            <span className={`project-state-dot ${projectPath ? 'connected' : ''}`} aria-hidden="true" />
          </div>

          {projectPath ? (
            <>
              <div className="project-path">
                <code title={projectPath}>{projectPath}</code>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => handleCopyToClipboard(projectPath)}
                  title="Copy project path"
                  aria-label="Copy project path"
                >
                  <FaCopy />
                </button>
              </div>

              <label className="build-command-field">
                <span>Build command</span>
                <input
                  className="glass-input"
                  value={buildCommand}
                  onChange={(event) => setBuildCommand(event.target.value)}
                  placeholder="npm run build"
                  spellCheck="false"
                />
              </label>

              <button type="button" className="project-change-btn" onClick={handleSelectFolder}>
                <FaFolderOpen aria-hidden="true" />
                Change project
              </button>
            </>
          ) : (
            <div className="empty-project">
              <p>Select a repository to unlock the release workflow.</p>
              <button type="button" className="select-project-btn" onClick={handleSelectFolder}>
                <FaFolderOpen aria-hidden="true" />
                Select project folder
              </button>
            </div>
          )}
        </section>
      </div>

      <footer className="sidebar-footer">
        <div className="sidebar-status-row">
          <span className={`status-indicator ${isBuilding ? 'building' : 'idle'}`}>
            <i aria-hidden="true" />
            {isBuilding ? 'Building' : 'Ready'}
          </span>
          <span className="sidebar-package-version">
            {projectVersion ? `package v${projectVersion}` : 'No package loaded'}
          </span>
        </div>

        <div className="sidebar-metrics" aria-label="Repository summary">
          <span><strong>{releasesCount}</strong> Releases</span>
          <span><strong>{tagsCount}</strong> Tags</span>
        </div>

        {pendingPackageVersion && (
          <div className="sidebar-pending-version">
            <span>Next package version</span>
            <strong>v{pendingPackageVersion}</strong>
          </div>
        )}
      </footer>
    </aside>
  );
}

export default Sidebar;
