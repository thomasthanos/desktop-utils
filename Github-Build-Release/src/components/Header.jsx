import React from 'react';
import { FaGithub, FaTag } from 'react-icons/fa';
import '../styles/Header.css';

const TAB_META = {
  create: { eyebrow: 'Release workspace', title: 'Create release' },
  history: { eyebrow: 'Repository activity', title: 'Release history' },
  logs: { eyebrow: 'Pipeline output', title: 'Build console' }
};

function Header({ activeTab, projectVersion }) {
  const activeMeta = TAB_META[activeTab] || TAB_META.create;

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="brand-section">
          <span className="brand-symbol" aria-hidden="true"><FaGithub /></span>
          <span className="brand-text">Release<span>Flow</span></span>
        </div>

        <div className="header-context" aria-live="polite">
          <span>{activeMeta.eyebrow}</span>
          <strong>{activeMeta.title}</strong>
        </div>

        <div className="header-actions">
          {projectVersion && (
            <span className="header-version" title="Current package.json version">
              <FaTag /> v{projectVersion}
            </span>
          )}
          <span className="header-runtime"><i /> Local workspace</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
