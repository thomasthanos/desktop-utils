import React, { useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkAlerts from 'remark-github-alerts';
import rehypeRaw from 'rehype-raw';
import {
  FaRocket,
  FaExclamationTriangle,
  FaTag,
  FaFileAlt,
  FaFolder,
  FaSpinner,
  FaTrashAlt,
  FaMagic,
  FaSyncAlt,
} from 'react-icons/fa';
import '../styles/Modal.css';

/* ─────────────────────────────────────────────
   BASE MODAL
   ───────────────────────────────────────────── */
function Modal({
  isOpen,
  onClose,
  onConfirm,
  title,
  icon,
  iconClass = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmClass = 'primary',
  isLoading = false,
  extraClass = '',
  children,
}) {
  const [isVisible, setIsVisible]     = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        setIsVisible(true);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setIsAnimating(true))
        );
      });
    } else {
      requestAnimationFrame(() => setIsAnimating(false));
      const t = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isLoading) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, isOpen, onClose]);

  if (!isVisible) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isLoading) onClose();
  };

  return (
    <div
      className={`modal-backdrop${isAnimating ? ' modal-visible' : ''}`}
      onClick={handleBackdropClick}
    >
      <div
        className={`modal-card glass-panel${isAnimating ? ' modal-card-visible' : ''}${extraClass ? ` ${extraClass}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isLoading}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className={`modal-icon${iconClass ? ` ${iconClass}` : ''}`}>
            {icon}
          </div>

          <div className="modal-header-text">
            <h3 className="modal-title" id={titleId}>{title}</h3>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close modal"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        {children && (
          <div className="modal-body">
            {children}
          </div>
        )}

        {/* ── Actions ── */}
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn modal-btn-cancel"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </button>

          <button
            type="button"
            className={`modal-btn modal-btn-${confirmClass}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <FaSpinner className="btn-spinner" size={12} />
                <span>Working…</span>
              </>
            ) : (
              <span>{confirmText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   DELETE MODAL
   ───────────────────────────────────────────── */
export function DeleteModal({ isOpen, pendingDelete, onClose, onConfirm, isDeleting }) {
  if (!pendingDelete) return null;

  const isTagOnly = pendingDelete.type === 'tag-only';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Delete ${isTagOnly ? 'Tag' : 'Release'}`}
      icon={<FaExclamationTriangle size={15} />}
      iconClass="danger"
      confirmText={isDeleting ? 'Deleting…' : `Delete ${pendingDelete.tagName}`}
      confirmClass="danger"
      isLoading={isDeleting}
    >
      <div className="delete-modal-content">
        {/* Target tag */}
        <div className="delete-target">
          <FaTag className="delete-target-icon" size={14} />
          <span className="delete-target-name">{pendingDelete.tagName}</span>
        </div>

        {/* Warning text */}
        <div className="delete-warning">
          {isTagOnly ? (
            <p>
              This will <strong>permanently delete</strong> the Git tag from
              both remote and local repositories.
            </p>
          ) : (
            <p>
              This will <strong>permanently delete</strong> the GitHub release
              and the Git tag from both remote and local repositories.
            </p>
          )}
        </div>

        {/* Undo notice */}
        <div className="delete-note">
          <FaExclamationTriangle size={11} />
          <span>This action cannot be undone!</span>
        </div>
      </div>
    </Modal>
  );
}

export function BulkDeleteModal({ isOpen, tagNames = [], onClose, onConfirm, isDeleting }) {
  if (!tagNames.length) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Delete ${tagNames.length} Releases`}
      icon={<FaTrashAlt size={15} />}
      iconClass="danger"
      confirmText={`Delete ${tagNames.length} releases`}
      confirmClass="danger"
      isLoading={isDeleting}
      extraClass="bulk-delete-modal"
    >
      <div className="delete-modal-content">
        <div className="bulk-delete-list hidden-scrollbar">
          {tagNames.map(tagName => (
            <div className="bulk-delete-item" key={tagName}>
              <FaTag size={11} />
              <span>{tagName}</span>
            </div>
          ))}
        </div>
        <div className="delete-warning">
          <p>
            This permanently deletes every selected GitHub release and its exact Git tag.
            The operation reports partial failures and never deletes unrelated tags.
          </p>
        </div>
        <div className="delete-note">
          <FaExclamationTriangle size={11} />
          <span>Generate the aggregate notes before deleting source releases.</span>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   RELEASE MODAL
   ───────────────────────────────────────────── */
export function ReleaseModal({
  isOpen,
  onClose,
  onConfirm,
  version,
  currentPackageVersion,
  pendingPackageVersion,
  title,
  notes,
  projectName,
  isReleasing,
  versionMode = 'auto',
  aggregateSources = [],
}) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Confirm Release"
      icon={<FaRocket size={15} />}
      iconClass="release"
      confirmText={isReleasing ? 'Releasing…' : 'Confirm & Release'}
      confirmClass="primary"
      isLoading={isReleasing}
    >
      <div className="release-modal-content">

        {/* Version badge */}
        <div className="release-version-badge">
          <FaTag size={10} />
          <span>{version || 'No version'}</span>
          <small>{versionMode === 'manual' ? 'manual' : 'auto patch'}</small>
        </div>

        {currentPackageVersion && pendingPackageVersion && (
          <div className="package-version-transition" role="status">
            <FaSyncAlt size={11} />
            <span>package.json</span>
            <code>v{currentPackageVersion}</code>
            <span className="package-version-arrow">→</span>
            <code>v{pendingPackageVersion}</code>
            <small>written before build</small>
          </div>
        )}

        {aggregateSources.length > 0 && (
          <div className="aggregate-source-summary">
            <FaMagic size={12} />
            <span>AI aggregate from {aggregateSources.length} releases</span>
            <small>Sources delete after successful publish</small>
          </div>
        )}

        {/* Title / Project grid */}
        <div className="release-info-grid">
          <div className="release-info-item">
            <div className="release-info-label">
              <FaFileAlt size={9} />
              <span>Title</span>
            </div>
            <div className="release-info-value">{title || 'Untitled'}</div>
          </div>

          <div className="release-info-item">
            <div className="release-info-label">
              <FaFolder size={9} />
              <span>Project</span>
            </div>
            <div className="release-info-value">{projectName || 'Unknown'}</div>
          </div>
        </div>

        {/* Notes section */}
        <div className="release-notes-section">
          {/* Tabs */}
          <div className="release-notes-tabs">
            <button
              className={`release-notes-tab${activeTab === 'overview' ? ' active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`release-notes-tab${activeTab === 'preview' ? ' active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
          </div>

          {/* Content */}
          <div className="release-notes-content custom-scrollbar">
            {activeTab === 'overview' ? (
              <pre className="release-notes-raw">
                {notes?.trim()
                  ? notes.split('\n').slice(0, 10).join('\n')
                  : 'No release notes'}
                {notes && notes.split('\n').length > 10
                  ? '\n\n…(truncated)'
                  : ''}
              </pre>
            ) : (
              <div className="release-notes-preview">
                {notes ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkAlerts]}
                    rehypePlugins={[rehypeRaw]}
                  >
                    {notes.split('\n').slice(0, 10).join('\n')}
                  </ReactMarkdown>
                ) : (
                  <p className="no-notes">No release notes provided</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="release-steps">
          {['Version', 'Build', 'Create', 'Upload'].map((step, i) => (
            <React.Fragment key={step}>
              {i > 0 && <div className="release-step-divider" />}
              <div className="release-step">
                <div className="release-step-number">{i + 1}</div>
                <div className="release-step-text">{step}</div>
              </div>
            </React.Fragment>
          ))}
        </div>

      </div>
    </Modal>
  );
}

export default Modal;
