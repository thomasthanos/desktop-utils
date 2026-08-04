import React from 'react';
import {
  FaSync, FaSpinner, FaRocket, FaTag, FaTrash,
  FaRegCalendarAlt, FaRegClock, FaCodeBranch, FaExternalLinkAlt,
  FaCheckSquare, FaMinusSquare, FaRegSquare, FaMagic, FaTimes
} from 'react-icons/fa';
import '../styles/ReleaseHistory.css';

function ReleaseHistory({
  releases,
  isLoading,
  activeHistorySubTab,
  setActiveHistorySubTab,
  fetchReleases,
  projectPath,
  setPendingDelete,
  isDeleting,
  selectedReleaseTags = [],
  onToggleRelease,
  onSelectAllReleases,
  onClearSelection,
  onBulkDelete,
  onAggregateReleases,
  isBulkDeleting = false,
  isAggregating = false
}) {
  // Φίλτρα για releases και tags
  const releasesOnly = releases.filter(r => r.type === 'release');
  const tagsOnly = releases.filter(r => r.type === 'tag-only');
  const selectedSet = selectedReleaseTags instanceof Set
    ? selectedReleaseTags
    : new Set(Array.isArray(selectedReleaseTags) ? selectedReleaseTags : []);
  const selectedTags = releasesOnly
    .map(release => release.tagName)
    .filter(tagName => selectedSet.has(tagName));
  const selectedReleases = releasesOnly.filter(release => selectedSet.has(release.tagName));
  const selectionCount = selectedTags.length;
  const visibleSelectedReleases = selectedReleases.slice(0, 2);
  const hiddenSelectionCount = Math.max(0, selectionCount - visibleSelectedReleases.length);
  const allSelected = releasesOnly.length > 0 && selectionCount === releasesOnly.length;
  const partiallySelected = selectionCount > 0 && !allSelected;
  const selectionBusy = isBulkDeleting || isAggregating;

  return (
    <div className="tab-content release-history-view fade-in">
      <div className="tab-header">
        <div className="tab-header-content">
          <h1>Release History</h1>
          <p className="tab-description">
            Manage GitHub releases and Git tags
          </p>
        </div>
        <button 
          className="refresh-btn-primary glass-panel" 
          onClick={() => fetchReleases(projectPath)}
          disabled={isLoading || selectionBusy}
        >
          <FaSync className={isLoading ? 'spin' : ''} size={14} /> 
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      
      {/* SUBTABS */}
      <div className="subtab-nav">
        <button 
          className={`subtab-btn ${activeHistorySubTab === 'releases' ? 'active releases' : ''}`}
          onClick={() => setActiveHistorySubTab('releases')}
        >
          <FaRocket size={12} />
          Releases
          <span className="subtab-count">{releasesOnly.length}</span>
        </button>
        
        <button 
          className={`subtab-btn ${activeHistorySubTab === 'tags' ? 'active tags' : ''}`}
          onClick={() => setActiveHistorySubTab('tags')}
        >
          <FaTag size={12} />
          Tags Only
          <span className="subtab-count">{tagsOnly.length}</span>
        </button>
      </div>

      {activeHistorySubTab === 'releases' && releasesOnly.length > 0 && (
        <div
          className={`selection-toolbar glass-panel ${selectionCount ? 'has-selection' : ''}`}
          aria-label="Bulk release selection"
        >
          <div className="selection-toolbar-main">
            <button
              type="button"
              className={`selection-toggle-btn ${partiallySelected ? 'is-partial' : ''}`}
              onClick={() => {
                if (allSelected) onClearSelection?.();
                else onSelectAllReleases?.(releasesOnly.map(release => release.tagName));
              }}
              disabled={selectionBusy || (!onSelectAllReleases && !onClearSelection)}
              aria-pressed={allSelected}
            >
              {allSelected ? (
                <FaCheckSquare size={13} />
              ) : partiallySelected ? (
                <FaMinusSquare size={13} />
              ) : (
                <FaRegSquare size={13} />
              )}
              <span>{allSelected ? 'Clear all' : 'Select all'}</span>
            </button>

            <div className="selection-context">
              <div className="selection-summary" aria-live="polite">
                <strong>{selectionCount}</strong>
                <span>{selectionCount === 1 ? 'release selected' : 'releases selected'}</span>
              </div>

              {selectionCount > 0 && (
                <div
                  className="selected-release-list hidden-scrollbar"
                  aria-label={`${selectionCount} selected ${selectionCount === 1 ? 'release' : 'releases'}`}
                >
                  {visibleSelectedReleases.map(release => (
                    <button
                      key={release.tagName}
                      type="button"
                      className="selected-release-chip"
                      onClick={() => onToggleRelease?.(release.tagName, false)}
                      disabled={selectionBusy || !onToggleRelease}
                      title={`Remove ${release.tagName} from selection`}
                    >
                      <FaCheckSquare size={10} aria-hidden="true" />
                      <span>{release.tagName}</span>
                      <FaTimes className="selected-release-chip-remove" size={8} aria-hidden="true" />
                    </button>
                  ))}
                  {hiddenSelectionCount > 0 && (
                    <span
                      className="selected-release-overflow"
                      title={selectedReleases.slice(visibleSelectedReleases.length).map(release => release.tagName).join(', ')}
                      aria-label={`${hiddenSelectionCount} more selected releases`}
                    >
                      +{hiddenSelectionCount}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="selection-actions">
              {selectionCount > 0 && (
                <button
                  type="button"
                  className="selection-clear-btn"
                  onClick={() => onClearSelection?.()}
                  disabled={selectionBusy || !onClearSelection}
                  title="Clear release selection"
                  aria-label="Clear release selection"
                >
                  <FaTimes size={10} aria-hidden="true" />
                  <span>Clear</span>
                </button>
              )}
              <button
                type="button"
                className="aggregate-releases-btn"
                onClick={() => onAggregateReleases?.(selectedReleases)}
                disabled={selectionCount < 2 || selectionBusy || !onAggregateReleases}
                title={selectionCount < 2 ? 'Select at least two releases' : 'Combine selected releases with AI'}
                aria-label={isAggregating ? 'Combining selected releases' : 'Combine selected releases with AI'}
              >
                {isAggregating ? <FaSpinner className="spin" size={12} /> : <FaMagic size={12} />}
                <span>{isAggregating ? 'Combining...' : 'Combine with AI'}</span>
              </button>
              <button
                type="button"
                className="bulk-delete-btn"
                onClick={() => onBulkDelete?.(selectedTags)}
                disabled={!selectionCount || selectionBusy || !onBulkDelete}
                title="Delete selected releases"
                aria-label={isBulkDeleting ? 'Deleting selected releases' : 'Delete selected releases'}
              >
                {isBulkDeleting ? <FaSpinner className="spin" size={12} /> : <FaTrash size={11} />}
                <span>{isBulkDeleting ? 'Deleting...' : 'Delete selected'}</span>
              </button>
            </div>
          </div>

        </div>
      )}
      
      {isLoading ? (
        <div className="loading-state glass-panel">
          <FaSpinner className="spinner" size={36} />
          <p>Fetching releases & tags from GitHub...</p>
        </div>
      ) : (
        <>
          {/* RELEASES SUBTAB */}
          {activeHistorySubTab === 'releases' && (
            releasesOnly.length === 0 ? (
              <div className="empty-state glass-panel" style={{ maxWidth: '500px', margin: '40px auto' }}>
                <FaRocket size={48} />
                <h3>No Releases Found</h3>
                <p>Create your first release using the "Create Release" tab</p>
              </div>
            ) : (
              <div className="release-grid hidden-scrollbar">
                {releasesOnly.map(rel => (
                  <ReleaseCard 
                    key={`release:${rel.tagName}`}
                    release={rel} 
                    type="release"
                    setPendingDelete={setPendingDelete}
                    isDeleting={isDeleting || selectionBusy}
                    selectable={Boolean(onToggleRelease)}
                    selected={selectedSet.has(rel.tagName)}
                    onToggleSelection={selected => onToggleRelease?.(rel.tagName, selected)}
                  />
                ))}
              </div>
            )
          )}
          
          {/* TAGS SUBTAB */}
          {activeHistorySubTab === 'tags' && (
            tagsOnly.length === 0 ? (
              <div className="empty-state glass-panel" style={{ maxWidth: '500px', margin: '40px auto' }}>
                <FaTag size={48} />
                <h3>No Tags Without Releases</h3>
                <p>All Git tags have associated GitHub releases</p>
              </div>
            ) : (
              <div className="release-grid hidden-scrollbar">
                {tagsOnly.map(tag => (
                  <ReleaseCard 
                    key={`tag:${tag.tagName}`}
                    release={tag} 
                    type="tag-only"
                    setPendingDelete={setPendingDelete}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

// Sub-component for release/tag cards
function ReleaseCard({
  release,
  type,
  setPendingDelete,
  isDeleting,
  selectable = false,
  selected = false,
  onToggleSelection
}) {
  const isTagOnly = type === 'tag-only';
  
  return (
    <div className={`release-card glass-panel ${isTagOnly ? 'tag-only-card' : ''} ${selectable && !isTagOnly ? 'selectable' : ''} ${selected ? 'selected' : ''}`}>
      {selectable && !isTagOnly && (
        <label className="release-select-control">
          <input
            type="checkbox"
            className="release-select-checkbox"
            checked={selected}
            onChange={event => onToggleSelection?.(event.target.checked)}
            disabled={isDeleting}
            aria-label={`Select release ${release.tagName}`}
          />
          <span aria-hidden="true"></span>
        </label>
      )}
      <div className="card-header">
        <div className="release-tag">
          <span className={`tag-badge ${isTagOnly ? 'tag-badge-gray' : ''}`}>
            {release.tagName}
          </span>
          {release.isDraft && (
            <span className="draft-badge">Draft</span>
          )}
          {isTagOnly && (
            <span className="tag-only-badge">
              <FaTag size={8} /> Tag Only
            </span>
          )}
        </div>
        
        <div className="release-time">
          {release.publishedAt ? (
            <>
              <span className="time-item">
                <FaRegCalendarAlt size={10} />
                {new Date(release.publishedAt).toLocaleDateString()}
              </span>
              <span className="time-item">
                <FaRegClock size={10} />
                {new Date(release.publishedAt).toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </span>
            </>
          ) : (
            <span className="time-item tag-only-time">
              <FaCodeBranch size={10} />
              No GitHub Release
            </span>
          )}
        </div>
      </div>
      
      <div className="card-body">
        <div className="release-content">
          <h3 className={`release-title ${isTagOnly ? 'tag-only-title' : ''}`}>
            {release.title || `${isTagOnly ? 'Git tag' : 'Release'} ${release.tagName}`}
          </h3>
          <div className="release-links">
            {isTagOnly ? (
              <span className="action-link disabled">
                <FaTag size={11} /> Git tag only (no release page)
              </span>
            ) : (
              <a 
                href={release.url} 
                target="_blank" 
                rel="noreferrer" 
                className="action-link"
              >
                <FaExternalLinkAlt size={11} /> View on GitHub
              </a>
            )}
          </div>
        </div>
        
        <div className="release-actions">
          <button 
            className="delete-btn"
            onClick={() => setPendingDelete({
              tagName: release.tagName,
              type: type
            })}
            title={`Delete ${isTagOnly ? 'tag' : 'release and tag'}`}
            disabled={isDeleting}
          >
            <FaTrash size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReleaseHistory;
