import {
  FaBoxOpen,
  FaCheckCircle,
  FaCodeBranch,
  FaExclamationCircle,
  FaFolderOpen,
  FaGithub,
  FaInfoCircle,
  FaRocket,
  FaTag,
} from 'react-icons/fa';
import '../styles/EmptyState.css';

function EmptyState({ handleSelectFolder, ghStatus = {}, handleSetupGh }) {
  const isReady = Boolean(ghStatus.installed && ghStatus.loggedIn);
  const needsInstall = ghStatus.installed === false;
  const needsAuth = ghStatus.installed === true && ghStatus.loggedIn === false;

  const statusMessage = isReady
    ? 'GitHub CLI is connected and ready to publish.'
    : needsInstall
      ? 'Install GitHub CLI to connect your account.'
      : needsAuth
        ? 'Authenticate GitHub CLI to continue.'
        : 'Checking the local GitHub CLI connection.';

  return (
    <div className="empty-state-wrapper">
      <section className="empty-state-modern glass-panel" aria-labelledby="releaseflow-welcome-title">
        <div className="onboarding-ambient" aria-hidden="true" />

        <header className="empty-hero">
          <div className="hero-icon" aria-hidden="true">
            <FaRocket />
          </div>
          <div className="hero-copy">
            <span className="hero-kicker">ReleaseFlow Desktop</span>
            <h1 id="releaseflow-welcome-title">Ship your next release with confidence.</h1>
            <p className="hero-subtitle">
              Turn commits into release notes, installers, and GitHub Releases from one workspace.
            </p>
          </div>
        </header>

        <div className={`status-check ${isReady ? 'ready' : 'needs-setup'}`} role="status">
          <span className="status-check-icon" aria-hidden="true">
            {isReady ? <FaCheckCircle /> : <FaExclamationCircle />}
          </span>
          <div className="status-check-copy">
            <strong>{isReady ? 'GitHub connected' : 'Connection required'}</strong>
            <span>{statusMessage}</span>
          </div>
          <span className="status-check-badge">{isReady ? 'Ready' : 'Action needed'}</span>
        </div>

        {!isReady && (
          <div className="quick-setup">
            <div className="quick-setup-heading">
              <div>
                <span className="section-kicker">One-time setup</span>
                <h2>Connect GitHub CLI</h2>
              </div>
              <FaGithub aria-hidden="true" />
            </div>

            <div className="setup-steps-compact">
              {needsInstall && (
                <div className="compact-step">
                  <span className="step-num">01</span>
                  <div className="step-info">
                    <strong>Install GitHub CLI</strong>
                    <span>ReleaseFlow can install it automatically with winget.</span>
                    <a href="https://cli.github.com" target="_blank" rel="noreferrer" className="learn-more">
                      View GitHub CLI <FaGithub aria-hidden="true" />
                    </a>
                  </div>
                </div>
              )}

              {needsAuth && (
                <div className="compact-step">
                  <span className="step-num">02</span>
                  <div className="step-info">
                    <strong>Sign in to GitHub</strong>
                    <code>gh auth login</code>
                    <span>
                      {ghStatus.authOpened
                        ? 'The authentication command is open. Complete it, then return here.'
                        : 'ReleaseFlow will open the authentication command for you.'}
                    </span>
                  </div>
                </div>
              )}

              {ghStatus.installError && (
                <div className="compact-step compact-step-error">
                  <span className="step-num">!</span>
                  <div className="step-info">
                    <strong>Setup could not finish</strong>
                    <code>{ghStatus.installError}</code>
                  </div>
                </div>
              )}

              {!needsInstall && !needsAuth && !ghStatus.installError && (
                <div className="compact-step compact-step-checking">
                  <span className="step-num">…</span>
                  <div className="step-info">
                    <strong>Checking your environment</strong>
                    <span>This should only take a moment.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="onboarding-actions">
          {!isReady && (
            <button type="button" className="cta-button cta-button-setup" onClick={handleSetupGh}>
              <FaGithub aria-hidden="true" />
              {needsInstall ? 'Install GitHub CLI' : needsAuth ? 'Open GitHub login' : 'Run setup'}
            </button>
          )}

          <button
            type="button"
            className={`cta-button cta-button-project ${isReady ? 'ready' : 'disabled'}`}
            onClick={handleSelectFolder}
            disabled={!isReady}
          >
            <FaFolderOpen aria-hidden="true" />
            {isReady ? 'Open project folder' : 'Project folder unlocks after setup'}
          </button>
        </div>

        {isReady ? (
          <div className="requirements-info" aria-label="Project requirements">
            <span><FaCodeBranch aria-hidden="true" /> Git repository</span>
            <span><FaTag aria-hidden="true" /> Remote origin</span>
            <span><FaBoxOpen aria-hidden="true" /> package.json</span>
          </div>
        ) : (
          <div className="onboarding-tip">
            <FaInfoCircle aria-hidden="true" />
            <span>Your project files stay local until you choose to publish a release.</span>
          </div>
        )}
      </section>
    </div>
  );
}

export default EmptyState;
