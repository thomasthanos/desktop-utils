import { useCallback, useEffect, useRef, useState } from 'react';
import { FaCheck, FaCopy, FaRocket, FaTerminal, FaTrash } from 'react-icons/fa';
import '../styles/BuildLogs.css';

const stripAnsi = (value) => {
  if (!value) return '';

  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
};

function BuildLogs({ logs, setLogs, isBuilding, handleBuild }) {
  const terminalBodyRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const [copyFeedback, setCopyFeedback] = useState('idle');
  const cleanLogs = stripAnsi(logs);

  useEffect(() => {
    const terminalBody = terminalBodyRef.current;
    if (!terminalBody) return undefined;

    const frame = window.requestAnimationFrame(() => {
      terminalBody.scrollTop = terminalBody.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [logs]);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  const showCopyFeedback = useCallback((feedback) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    setCopyFeedback(feedback);
    feedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback('idle');
      feedbackTimerRef.current = null;
    }, 1800);
  }, []);

  const handleClearLogs = useCallback(() => {
    if (!logs || isBuilding) return;
    setLogs('');
  }, [isBuilding, logs, setLogs]);

  const handleCopyLogs = useCallback(async () => {
    if (!cleanLogs) return;

    try {
      await navigator.clipboard.writeText(cleanLogs);
      showCopyFeedback('copied');
    } catch (error) {
      console.error('Failed to copy build logs:', error);
      showCopyFeedback('error');
    }
  }, [cleanLogs, showCopyFeedback]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (event.ctrlKey && event.key === 'Enter' && !isBuilding) {
        event.preventDefault();
        handleBuild();
      }

      if (event.key === 'Escape' && logs && !isBuilding) {
        event.preventDefault();
        handleClearLogs();
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'c' && logs) {
        const selection = window.getSelection()?.toString();
        if (!selection) {
          event.preventDefault();
          handleCopyLogs();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBuild, handleClearLogs, handleCopyLogs, isBuilding, logs]);

  const lineCount = cleanLogs
    ? cleanLogs.split('\n').filter((line) => line.trim()).length
    : 0;
  const charCount = cleanLogs.length;
  const statusLabel = isBuilding ? 'Running' : cleanLogs ? 'Output ready' : 'Ready';

  return (
    <div className="tab-content fade-in build-logs-view">
      <header className="tab-header build-console-header">
        <div className="tab-header-content">
          <div className="build-console-eyebrow">
            <FaTerminal aria-hidden="true" />
            Live build output
          </div>
          <h1>Build Console</h1>
          <p className="tab-description">
            Follow each build step without leaving ReleaseFlow.
          </p>
        </div>

        <div className="log-actions" role="toolbar" aria-label="Build log actions">
          <button
            type="button"
            className={`console-control ${copyFeedback !== 'idle' ? `is-${copyFeedback}` : ''}`}
            onClick={handleCopyLogs}
            disabled={!cleanLogs}
            title="Copy all build output"
          >
            {copyFeedback === 'copied' ? <FaCheck aria-hidden="true" /> : <FaCopy aria-hidden="true" />}
            {copyFeedback === 'copied' ? 'Copied' : copyFeedback === 'error' ? 'Copy failed' : 'Copy'}
          </button>

          <button
            type="button"
            className="console-control"
            onClick={handleClearLogs}
            disabled={!cleanLogs || isBuilding}
            title="Clear build output"
          >
            <FaTrash aria-hidden="true" />
            Clear
          </button>

          <button
            type="button"
            className="console-control console-control-primary"
            onClick={handleBuild}
            disabled={isBuilding}
          >
            <FaRocket className={isBuilding ? 'is-spinning' : ''} aria-hidden="true" />
            {isBuilding ? 'Building' : 'Run build'}
          </button>
        </div>
      </header>

      <section className="terminal-container" aria-label="Build terminal">
        <header className="terminal-header">
          <div className="terminal-title">
            <span className="terminal-window-controls" aria-hidden="true">
              <span className="terminal-dot terminal-dot-red" />
              <span className="terminal-dot terminal-dot-yellow" />
              <span className="terminal-dot terminal-dot-green" />
            </span>
            <FaTerminal aria-hidden="true" />
            <span>releaseflow / build</span>
          </div>

          <div className="terminal-stats">
            <span className={`terminal-status ${isBuilding ? 'is-running' : ''}`}>
              <span className="terminal-status-dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <span className="log-count" title={`${charCount} characters`}>
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </div>
        </header>

        <div
          ref={terminalBodyRef}
          className="terminal-body"
          role="log"
          aria-label="Build output"
          aria-live="polite"
        >
          {cleanLogs ? (
            <pre className="terminal-output">{cleanLogs}</pre>
          ) : (
            <div className="terminal-empty-state">
              <span className="terminal-prompt" aria-hidden="true">$</span>
              <div>
                <strong>Console ready</strong>
                <span>Run a build to stream output here.</span>
              </div>
            </div>
          )}
        </div>

        <footer className="terminal-footer">
          <div className="terminal-shortcuts" aria-label="Keyboard shortcuts">
            <span><kbd>Ctrl</kbd><kbd>Enter</kbd> Run</span>
            <span><kbd>Esc</kbd> Clear</span>
            <span><kbd>Ctrl</kbd><kbd>C</kbd> Copy</span>
          </div>
          <span className="terminal-meta">{cleanLogs ? `${charCount.toLocaleString()} chars` : 'Awaiting output'}</span>
        </footer>
      </section>
    </div>
  );
}

export default BuildLogs;
