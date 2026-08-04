import React, { useCallback, useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkAlerts from 'remark-github-alerts';
import rehypeRaw from 'rehype-raw';
import {
  FaRocket, FaPen, FaTag, FaFileAlt, FaEye, FaEdit, FaTrash,
  FaMagic, FaRobot, FaKey, FaSave, FaShieldAlt, FaHistory,
  FaSyncAlt, FaExclamationTriangle, FaInbox
} from 'react-icons/fa';
import CommitRangePicker from './CommitRangePicker';
import '../styles/CreateRelease.css';

function CreateRelease({
  version,
  setVersion,
  title,
  setTitle,
  notes,
  setNotes,
  isPreview,
  setIsPreview,
  isReleasing,
  handleCreateRelease,
  suggestedVersion,
  currentPackageVersion,
  pendingPackageVersion,
  projectPath,
  onVersionChange,
  onResetForm,
  aggregateSources = []
}) {
  // AI state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiSourceMode, setAiSourceMode] = useState('latest');
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [savedApiKey, setSavedApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [lastAiUsage, setLastAiUsage] = useState(null);

  // Commit range state
  const [commits, setCommits] = useState([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [fromHash, setFromHash] = useState('');
  const [toHash, setToHash] = useState('');
  const [commitStatus, setCommitStatus] = useState('idle');
  const [commitError, setCommitError] = useState('');
  const lastAiGeneratedRef = useRef(null);
  const formValuesRef = useRef({ notes, title });
  const previousProjectRef = useRef(projectPath);
  const commitRequestIdRef = useRef(0);

  // Load saved API key on mount
  useEffect(() => {
    window.api.getApiKey().then(key => {
      if (key) setSavedApiKey(key);
    });
  }, []);

  useEffect(() => {
    if (!showAiModal || aiLoading) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowAiModal(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [aiLoading, showAiModal]);

  useEffect(() => {
    formValuesRef.current = { notes, title };
  }, [notes, title]);

  const clearLastAiGeneratedContent = useCallback(() => {
    const lastGenerated = lastAiGeneratedRef.current;
    if (!lastGenerated) return;

    const currentValues = formValuesRef.current;
    if (lastGenerated.notes === currentValues.notes) setNotes('');
    if (lastGenerated.title && lastGenerated.title === currentValues.title) setTitle('');
    lastAiGeneratedRef.current = null;
    setLastAiUsage(null);
  }, [setNotes, setTitle]);

  const loadCommits = useCallback(async ({ resetSelection = true } = {}) => {
    const requestId = ++commitRequestIdRef.current;

    if (!projectPath) {
      setCommits([]);
      setFromHash('');
      setToHash('');
      setCommitStatus('error');
      setCommitError('Select a project before loading commits.');
      return;
    }

    setCommitsLoading(true);
    setCommitStatus('loading');
    setCommitError('');
    if (resetSelection) {
      setFromHash('');
      setToHash('');
    }

    try {
      const result = await window.api.getCommits(projectPath);
      if (requestId !== commitRequestIdRef.current) return;

      if (!result?.success) {
        setCommits([]);
        setFromHash('');
        setToHash('');
        setCommitStatus('error');
        setCommitError(result?.error || 'Could not read commit history.');
        return;
      }

      const nextCommits = Array.isArray(result.commits) ? result.commits : [];
      setCommits(nextCommits);

      if (!nextCommits.length) {
        setFromHash('');
        setToHash('');
        setCommitStatus('empty');
        setCommitError('No commits were found in this repository.');
        return;
      }

      setCommitStatus('ready');
      setCommitError('');

      const defaultFrom = nextCommits.length > 1
        ? nextCommits[nextCommits.length - 1].hash
        : '';
      const defaultTo = nextCommits[0].hash;

      if (resetSelection) {
        setFromHash(defaultFrom);
        setToHash(defaultTo);
      } else {
        setFromHash(current => nextCommits.some(commit => commit.hash === current) ? current : defaultFrom);
        setToHash(current => nextCommits.some(commit => commit.hash === current) ? current : defaultTo);
      }
    } catch (error) {
      if (requestId !== commitRequestIdRef.current) return;
      setCommits([]);
      setFromHash('');
      setToHash('');
      setCommitStatus('error');
      setCommitError(error?.message || 'Could not read commit history.');
    } finally {
      if (requestId === commitRequestIdRef.current) setCommitsLoading(false);
    }
  }, [projectPath]);

  const handleOpenAiModal = () => {
    setShowAiModal(true);
    setAiError('');
    if (aiSourceMode === 'range') loadCommits({ resetSelection: true });
  };

  const handleAiSourceModeChange = mode => {
    setAiSourceMode(mode);
    setAiError('');
    if (mode === 'range' && commitStatus === 'idle') {
      loadCommits({ resetSelection: true });
    }
  };

  const handleSaveApiKey = async () => {
    const result = await window.api.saveApiKey(apiKey);
    if (result.success) {
      setSavedApiKey(apiKey);
      setApiKey('');
      setShowKeyInput(false);
    }
  };

  const applyAiResult = result => {
    const generatedNotes = result.result || '';
    const generatedTitle = result.title || null;

    setNotes(generatedNotes);
    if (generatedTitle) setTitle(generatedTitle);

    lastAiGeneratedRef.current = {
      notes: generatedNotes,
      title: generatedTitle
    };
    formValuesRef.current = {
      notes: generatedNotes,
      title: generatedTitle || formValuesRef.current.title
    };
    setLastAiUsage(result.usage?.totalTokens ? result.usage : null);
  };

  const handleAiFailure = (failure, fallbackMessage) => {
    const rawMessage = failure?.error || failure?.message || fallbackMessage;
    const isCommitNotFound = failure?.code === 'COMMIT_NOT_FOUND'
      || /(?:commit.*not found|invalid commit|bad object|unknown revision)/i.test(rawMessage);

    if (isCommitNotFound) {
      const message = 'Commit not found. Refresh commits and select a valid range.';
      clearLastAiGeneratedContent();
      setCommits([]);
      setFromHash('');
      setToHash('');
      setCommitStatus('error');
      setCommitError(message);
      setAiError(message);
      return;
    }

    setAiError(rawMessage);
  };

  const handleGenerateFromDiff = async ({ closeModalOnSuccess = true } = {}) => {
    const key = savedApiKey || apiKey;
    if (!projectPath) {
      setAiError('Select a project first.');
      setShowAiModal(true);
      return;
    }
    if (!key) {
      setAiError('Save your DeepSeek API key first to enable auto-generate from git changes.');
      setShowKeyInput(true);
      setShowAiModal(true);
      return;
    }

    setAiLoading(true);
    setAiError('');
    const requestedProject = projectPath;

    try {
      const result = await window.api.generateReleaseFromDiff({
        path: requestedProject,
        apiKey: key,
        mode: 'head-or-working-tree'
      });

      if (previousProjectRef.current !== requestedProject) return;

      if (result?.success) {
        applyAiResult(result);
        if (closeModalOnSuccess) setShowAiModal(false);
        setAiText('');
      } else {
        handleAiFailure(result, 'Could not generate notes from git changes.');
        setShowAiModal(true);
      }
    } catch (error) {
      if (previousProjectRef.current === requestedProject) {
        handleAiFailure(error, 'Could not generate notes from git changes.');
        setShowAiModal(true);
      }
    } finally {
      if (previousProjectRef.current === requestedProject) setAiLoading(false);
    }
  };

  const handleGenerateFromRange = async () => {
    const key = savedApiKey || apiKey;
    if (!projectPath) {
      setAiError('Select a project first.');
      return;
    }
    if (!key) {
      setAiError('Save your DeepSeek API key first.');
      setShowKeyInput(true);
      return;
    }
    if (!fromHash || !toHash) {
      setAiError('Select both "From" and "To" commits.');
      return;
    }
    if (fromHash === toHash) {
      setAiError('From and To commits must be different.');
      return;
    }

    setAiLoading(true);
    setAiError('');
    const requestedProject = projectPath;

    try {
      const result = await window.api.generateReleaseFromDiff({
        path: requestedProject,
        apiKey: key,
        fromHash,
        toHash,
        mode: 'range'
      });

      if (previousProjectRef.current !== requestedProject) return;

      if (result?.success) {
        applyAiResult(result);
        setShowAiModal(false);
        setAiText('');
      } else {
        handleAiFailure(result, 'Could not generate notes from commit range.');
      }
    } catch (error) {
      if (previousProjectRef.current === requestedProject) {
        handleAiFailure(error, 'Could not generate notes from commit range.');
      }
    } finally {
      if (previousProjectRef.current === requestedProject) setAiLoading(false);
    }
  };

  const handleFormatWithAI = async () => {
    const key = savedApiKey;
    if (!key) { setShowKeyInput(true); return; }
    if (!aiText.trim()) { setAiError('Γράψε κάτι πρώτα!'); return; }

    setAiLoading(true);
    setAiError('');

    try {
      const result = await window.api.formatWithAI({ text: aiText, apiKey: key });
      if (result?.success) {
        applyAiResult(result);
        setShowAiModal(false);
        setAiText('');
      } else {
        handleAiFailure(result, 'Something went wrong');
      }
    } catch (error) {
      handleAiFailure(error, 'Something went wrong');
    } finally {
      setAiLoading(false);
    }
  };

  const handleVersionInputChange = event => {
    const nextVersion = event.target.value;
    if (onVersionChange) onVersionChange(nextVersion);
    else setVersion(nextVersion);
  };

  const handleManualTitleChange = event => {
    lastAiGeneratedRef.current = null;
    setLastAiUsage(null);
    setTitle(event.target.value);
  };

  const handleManualNotesChange = event => {
    lastAiGeneratedRef.current = null;
    setLastAiUsage(null);
    setNotes(event.target.value);
  };

  const updateCommitSelection = (setter, value) => {
    setter(value);
    setAiError('');

    if (commitStatus === 'error') {
      setCommitError('');
      setCommitStatus(commits.length ? 'ready' : 'idle');
    }
  };

  const commitPlaceholder = commitsLoading
    ? 'Loading commits...'
    : 'Paste a hash or choose a commit';

  const handleAiPrimaryAction = () => {
    if (aiSourceMode === 'range') return handleGenerateFromRange();
    if (aiSourceMode === 'manual') return handleFormatWithAI();
    return handleGenerateFromDiff();
  };

  const isAiPrimaryDisabled = aiLoading
    || (aiSourceMode === 'range' && (!fromHash || !toHash || fromHash === toHash))
    || (aiSourceMode === 'manual' && !aiText.trim());

  return (
    <div className="tab-content create-release-tab fade-in">
      <div className="release-form-container glass-panel">
        {/* Version & Title Row */}
        <div className="form-row">
          <div className="form-card glass-panel-light">
            <div className="form-card-header">
              <FaTag className="form-card-icon" />
              <span>Next Release Tag</span>
            </div>
            <div className="form-card-body">
              <input
                className="modern-input"
                value={version}
                onChange={handleVersionInputChange}
                placeholder={suggestedVersion || "v1.0.0"}
              />
              {currentPackageVersion && pendingPackageVersion && (
                <div className="version-sync-hint" role="status">
                  <FaSyncAlt size={10} />
                  <span>
                    package.json <strong>v{currentPackageVersion}</strong>
                    <span className="version-sync-arrow">→</span>
                    <strong>v{pendingPackageVersion}</strong> on Confirm &amp; Release
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="form-card glass-panel-light flex-2">
            <div className="form-card-header">
              <FaPen className="form-card-icon" />
              <span>Release Title</span>
            </div>
            <div className="form-card-body">
              <input
                className="modern-input"
                value={title}
                onChange={handleManualTitleChange}
                placeholder="e.g. Major Update: New Features & Improvements"
              />
            </div>
          </div>
        </div>

        {aggregateSources.length > 0 && (
          <div className="aggregate-draft-banner" role="status">
            <span className="aggregate-draft-icon"><FaMagic size={11} /></span>
            <span>
              AI draft combined from <strong>{aggregateSources.length}</strong>{' '}
              {aggregateSources.length === 1 ? 'release' : 'releases'}
            </span>
          </div>
        )}

        {/* Notes Editor */}
        <div className="form-card notes-card glass-panel-light">
          <div className="form-card-header">
            <div className="header-left">
              <FaFileAlt className="form-card-icon" />
              <span>Release Notes</span>
            </div>
            <div className="editor-mode-toggle">
              <button
                className={`mode-btn ${!isPreview ? 'active' : ''}`}
                onClick={() => setIsPreview(false)}
                title="Edit Mode"
              >
                <FaEdit size={12} />
                <span>Edit</span>
              </button>
              <button
                className={`mode-btn ${isPreview ? 'active' : ''}`}
                onClick={() => setIsPreview(true)}
                title="Preview Mode"
              >
                <FaEye size={12} />
                <span>Preview</span>
              </button>
            </div>
          </div>

          <div className="notes-editor-container">
            {isPreview ? (
              <div className="markdown-preview custom-scrollbar">
                {notes ? (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkAlerts]}
                    rehypePlugins={[rehypeRaw]}
                  >
                    {notes}
                  </ReactMarkdown>
                ) : (
                  <div className="empty-preview" id="notes-empty-state">
                    <FaFileAlt size={18} />
                    <p>No content to preview</p>
                  </div>
                )}
              </div>
            ) : (
              <textarea
                className="notes-textarea custom-scrollbar"
                value={notes}
                onChange={handleManualNotesChange}
                placeholder="Write your release notes in Markdown..."
              />
            )}
          </div>

          <div className="notes-footer">
            <div className="quick-actions">
              <button
                className="quick-btn ai-btn"
                onClick={handleOpenAiModal}
                title="Open AI release notes generator"
              >
                <FaMagic size={11} />
                <span>AI Notes</span>
              </button>
              <button
                className="quick-btn danger"
                onClick={() => {
                  lastAiGeneratedRef.current = null;
                  setLastAiUsage(null);
                  setNotes('');
                }}
                title="Clear notes"
              >
                <FaTrash size={11} />
                <span>Clear</span>
              </button>
            </div>
            <div className="notes-metrics">
              {lastAiUsage && (
                <span
                  className="ai-usage-pill"
                  title={`${lastAiUsage.promptTokens} input + ${lastAiUsage.completionTokens} output tokens`}
                >
                  <FaRobot size={10} /> {lastAiUsage.totalTokens.toLocaleString()} tokens
                </span>
              )}
              <span className="char-count">{notes.length} characters</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="release-form-actions">
          <button
            className="reset-btn glass-panel"
            onClick={() => {
              lastAiGeneratedRef.current = null;
              setLastAiUsage(null);
              if (onResetForm) {
                onResetForm();
              } else {
                if (onVersionChange) onVersionChange(suggestedVersion || '');
                else setVersion(suggestedVersion || '');
                setTitle('');
                setNotes('### What\'s New\n\n- Bug fixes\n- Performance improvements\n- New features');
              }
            }}
          >
            Reset Form
          </button>
          <button
            className="publish-btn"
            onClick={handleCreateRelease}
            disabled={!version || !title || isReleasing}
          >
            <FaRocket size={14} />
            <span>{isReleasing ? 'Publishing...' : 'Publish Release'}</span>
            {isReleasing && <div className="btn-loader"></div>}
          </button>
        </div>
      </div>
      {/* AI Modal */}
      {showAiModal && (
        <div
          className="modal-backdrop modal-visible"
          onClick={event => event.target === event.currentTarget && !aiLoading && setShowAiModal(false)}
        >
          <div
            className="modal-card modal-card-visible ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-release-notes-title"
          >

            <div className="modal-header">
              <div className="modal-icon ai"><FaRobot size={16} /></div>
              <div className="modal-header-text">
                <h3 className="modal-title" id="ai-release-notes-title">AI Release Notes</h3>
                <p className="ai-modal-subtitle">Choose a source, review the scope, then generate your draft.</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAiModal(false)}
                aria-label="Close AI release notes"
                disabled={aiLoading}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="modal-body ai-modal-body">

              <div className="ai-source-tabs" role="tablist" aria-label="Release notes source">
                <button
                  type="button"
                  role="tab"
                  aria-selected={aiSourceMode === 'latest'}
                  className={`ai-source-tab ${aiSourceMode === 'latest' ? 'active' : ''}`}
                  onClick={() => handleAiSourceModeChange('latest')}
                >
                  <FaMagic size={11} />
                  <span>Latest changes</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={aiSourceMode === 'range'}
                  className={`ai-source-tab ${aiSourceMode === 'range' ? 'active' : ''}`}
                  onClick={() => handleAiSourceModeChange('range')}
                >
                  <FaHistory size={11} />
                  <span>Commit range</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={aiSourceMode === 'manual'}
                  className={`ai-source-tab ${aiSourceMode === 'manual' ? 'active' : ''}`}
                  onClick={() => handleAiSourceModeChange('manual')}
                >
                  <FaPen size={11} />
                  <span>Manual brief</span>
                </button>
              </div>

              {/* API Key section */}
              <div className="ai-key-section">
                <div className="ai-key-section-inner">
                  <div className="ai-key-label">
                    <span className="ai-key-provider"><FaShieldAlt /> DeepSeek connection</span>
                    <span className="ai-model-badge">V4 Flash · low cost</span>
                  </div>
                  {savedApiKey && !showKeyInput ? (
                    <div className="ai-key-saved">
                      <div className="ai-key-saved-icon">
                        <FaKey size={11} />
                      </div>
                      <div className="ai-key-saved-text">
                        <span className="ai-key-saved-title">Key secured</span>
                        <span className="ai-key-saved-hint">DeepSeek API key is saved locally</span>
                      </div>
                      <button className="ai-key-change-btn" onClick={() => setShowKeyInput(true)}>Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="ai-key-row">
                        <div className="ai-key-icon">
                          <FaKey size={11} />
                        </div>
                        <div className="ai-key-input-wrapper">
                          <input
                            type="password"
                            className="ai-key-input"
                            placeholder="DeepSeek API Key (sk-...)"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && apiKey && handleSaveApiKey()}
                          />
                        </div>
                      </div>
                      <button className="ai-key-save-btn" onClick={handleSaveApiKey} disabled={!apiKey}>
                        <FaSave size={11} />
                        <span>Save Key</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {aiSourceMode === 'latest' && (
                <div className="ai-source-panel ai-latest-panel" role="tabpanel">
                  <div className="ai-source-panel-heading">
                    <span className="ai-source-panel-icon"><FaMagic size={13} /></span>
                    <div>
                      <h4>Generate from the newest work</h4>
                      <p>ReleaseFlow reads uncommitted changes first. If the tree is clean, it analyzes the latest commit.</p>
                    </div>
                  </div>
                  <div className="ai-scope-note">
                    <span>Automatic scope</span>
                    <strong>Working tree → latest HEAD commit</strong>
                  </div>
                </div>
              )}

              {aiSourceMode === 'range' && (
                <div className="commit-range-section ai-source-panel" role="tabpanel">
                  <div className="commit-range-header">
                    <div className="commit-range-intro">
                      <div className="commit-range-label">
                        <FaHistory size={12} />
                        <span>Choose a commit range</span>
                      </div>
                      <p>The older commit is the starting point; the newer commit is included in the generated notes.</p>
                    </div>
                    <button
                      type="button"
                      className="commit-refresh-btn"
                      onClick={() => loadCommits({ resetSelection: true })}
                      disabled={commitsLoading}
                      title="Refresh commits"
                      aria-label="Refresh commits"
                    >
                      <FaSyncAlt size={12} className={commitsLoading ? 'spinning' : ''} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="commit-range-selects">
                    <CommitRangePicker
                      id="commit-from"
                      label="From (older)"
                      value={fromHash}
                      onChange={value => updateCommitSelection(setFromHash, value)}
                      commits={commits}
                      disabled={commitsLoading}
                      placeholder={commitPlaceholder}
                    />

                    <div className="commit-range-arrow" aria-hidden="true">→</div>

                    <CommitRangePicker
                      id="commit-to"
                      label="To (newer)"
                      value={toHash}
                      onChange={value => updateCommitSelection(setToHash, value)}
                      commits={commits}
                      disabled={commitsLoading}
                      placeholder={commitPlaceholder}
                    />
                  </div>

                  {commitStatus === 'loading' && (
                    <div className="commit-feedback" role="status">
                      <FaSyncAlt className="spinning" size={11} aria-hidden="true" />
                      <span>Refreshing commit history from HEAD...</span>
                    </div>
                  )}

                  {commitStatus === 'empty' && (
                    <div className="commit-feedback commit-feedback-empty" role="status">
                      <FaInbox size={12} aria-hidden="true" />
                      <span>{commitError}</span>
                    </div>
                  )}

                  {commitStatus === 'error' && (
                    <div className="commit-feedback commit-feedback-error" role="alert">
                      <FaExclamationTriangle size={12} aria-hidden="true" />
                      <span>{commitError || 'Commit not found.'}</span>
                    </div>
                  )}
                </div>
              )}

              {aiSourceMode === 'manual' && (
                <div className="ai-text-section ai-source-panel" role="tabpanel">
                  <div className="ai-source-panel-heading compact">
                    <span className="ai-source-panel-icon"><FaPen size={12} /></span>
                    <div>
                      <h4>Describe the release in plain language</h4>
                      <p>List the important fixes, features, or breaking changes. AI will structure them as release notes.</p>
                    </div>
                  </div>
                  <label className="ai-label" htmlFor="ai-release-brief">Release brief</label>
                  <textarea
                    id="ai-release-brief"
                    className="ai-textarea custom-scrollbar"
                    placeholder="Example: Fixed login retries, added dark mode, and improved search performance..."
                    value={aiText}
                    onChange={e => {
                      setAiText(e.target.value);
                      setAiError('');
                    }}
                  />
                </div>
              )}

              {aiError && <div className="error-message">{aiError}</div>}

            </div>

            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => setShowAiModal(false)} disabled={aiLoading}>
                Cancel
              </button>
              <button className="modal-btn ai-format-btn ai-primary-action" onClick={handleAiPrimaryAction} disabled={isAiPrimaryDisabled}>
                {aiLoading ? (
                  <><div className="btn-spinner"></div><span>Generating draft...</span></>
                ) : aiSourceMode === 'range' ? (
                  <><FaHistory size={13} /><span>Generate from range</span></>
                ) : aiSourceMode === 'manual' ? (
                  <><FaRobot size={13} /><span>Format my brief</span></>
                ) : (
                  <><FaMagic size={13} /><span>Generate latest notes</span></>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default CreateRelease;
