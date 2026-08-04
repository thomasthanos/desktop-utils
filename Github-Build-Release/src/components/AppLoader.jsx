import React from 'react';
import { FaGithub, FaRocket, FaShieldAlt } from 'react-icons/fa';
import '../styles/AppLoader.css';

function AppLoader({ ghStatus }) {
  const statusText = ghStatus?.installError
    ? 'Starting with local tools'
    : ghStatus?.installed === null
    ? 'Checking GitHub tooling'
    : ghStatus?.installed === false
      ? 'Preparing GitHub CLI'
      : ghStatus?.loggedIn === false
        ? 'Checking authentication'
        : 'Opening your release workspace';

  return (
    <div className="app-loader" role="status" aria-live="polite" aria-label={statusText}>
      <div className="app-loader-grid" aria-hidden="true" />
      <div className="app-loader-glow app-loader-glow-primary" aria-hidden="true" />
      <div className="app-loader-glow app-loader-glow-secondary" aria-hidden="true" />

      <main className="app-loader-panel">
        <div className="app-loader-mark" aria-hidden="true">
          <span className="app-loader-mark-ring" />
          <FaRocket />
        </div>

        <div className="app-loader-eyebrow">GitHub release workspace</div>
        <h1>Release<span>Flow</span></h1>
        <p>Build, package and publish from one focused desktop workflow.</p>

        <div className="app-loader-progress" aria-hidden="true">
          <span />
        </div>

        <div className="app-loader-status">
          <span className="app-loader-status-dot" aria-hidden="true" />
          <span>{statusText}</span>
        </div>

        <div className="app-loader-capabilities" aria-hidden="true">
          <span><FaGithub /> Repository</span>
          <span><FaShieldAlt /> Local credentials</span>
          <span><FaRocket /> Release pipeline</span>
        </div>
      </main>

      <div className="app-loader-footnote">Secure local workflow · No repository selected yet</div>
    </div>
  );
}

export default AppLoader;
