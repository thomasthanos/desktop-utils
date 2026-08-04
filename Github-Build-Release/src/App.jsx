import React, { useCallback, useState, useEffect } from 'react';
import {
  Sidebar,
  Header,
  AppLoader,
  EmptyState,
  CreateRelease,
  ReleaseHistory,
  BuildLogs,
  DeleteModal,
  BulkDeleteModal,
  ReleaseModal,
  ToastContainer,
  useToast
} from './components';
import './styles/variables.css';
import './styles/global.css';

function App() {
  // Project State
  const [projectPath, setProjectPath] = useState('');
  const [projectVersion, setProjectVersion] = useState('');
  const [releases, setReleases] = useState([]);
  const [logs, setLogs] = useState('');

  // UI State
  const [activeTab, setActiveTab] = useState('create');
  const [activeHistorySubTab, setActiveHistorySubTab] = useState('releases');
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildCommand, setBuildCommand] = useState('npm run build-all');

  // Form State
  const [version, setVersion] = useState('');
  const [versionWasEdited, setVersionWasEdited] = useState(false);
  const [suggestedVersion, setSuggestedVersion] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('### What\'s New\n\n- Bug fixes\n- Performance improvements\n- New features');
  const [isPreview, setIsPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);

  // Modal State
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isAggregating, setIsAggregating] = useState(false);
  const [selectedReleaseTags, setSelectedReleaseTags] = useState(() => new Set());
  const [aggregateSources, setAggregateSources] = useState([]);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  // GitHub CLI Status
  const [ghStatus, setGhStatus] = useState({
    installed: null,
    loggedIn: null,
    installAttempted: false,
    installSuccess: false,
    installError: null,
    authOpened: false
  });

  // Toast notifications
  const toast = useToast();
  const {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: toastInfo
  } = toast;

  // Computed values
  const releasesOnly = releases.filter(r => r.type === 'release');
  const tagsOnly = releases.filter(r => r.type === 'tag-only');
  const normalizedFormVersion = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version.trim())
    ? version.trim().replace(/^v/, '')
    : '';
  const pendingPackageVersion = normalizedFormVersion && normalizedFormVersion !== projectVersion
    ? normalizedFormVersion
    : '';

  useEffect(() => {
    const availableTags = new Set(
      releases.filter(release => release.type === 'release').map(release => release.tagName)
    );
    setSelectedReleaseTags(prev => {
      const next = new Set([...prev].filter(tagName => availableTags.has(tagName)));
      if (next.size === prev.size && [...next].every(tagName => prev.has(tagName))) return prev;
      return next;
    });
  }, [releases]);

  // ============ EFFECTS ============

  const ensureGhReady = useCallback(async (notify = false) => {
    if (window.api?.ensureGhReady) {
      const status = await window.api.ensureGhReady();
      setGhStatus(status);

      if (notify) {
        if (status.installSuccess) {
          toastSuccess('GitHub CLI installed automatically.', 'GitHub CLI Ready');
        }
        if (status.installError) {
          toastError(status.installError, 'GitHub CLI Setup Failed');
        }
        if (status.authOpened) {
          toastInfo('Terminal opened with `gh auth login` command.', 'GitHub Auth');
        }
      }

      return status;
    }

    if (window.api?.checkGhStatus) {
      const status = await window.api.checkGhStatus();
      setGhStatus(status);
      return status;
    }

    return null;
  }, [toastError, toastInfo, toastSuccess]);

  // Check/setup GitHub CLI status on mount
  useEffect(() => {
    let isMounted = true;

    const bootstrapGh = async () => {
      try {
        await Promise.all([
          ensureGhReady(true),
          new Promise(resolve => setTimeout(resolve, 520))
        ]);
      } catch (error) {
        if (isMounted) {
          setGhStatus(current => ({
            ...current,
            installError: error?.message || 'GitHub tooling could not be checked.'
          }));
          toastWarning('ReleaseFlow started, but GitHub CLI status could not be verified.', 'Local Mode');
        }
      } finally {
        if (isMounted) setIsAppReady(true);
      }
    };

    bootstrapGh();

    return () => {
      isMounted = false;
    };
  }, [ensureGhReady, toastWarning]);

  // Build log listener
  useEffect(() => {
    if (window.api) {
      window.api.onBuildLog((data) => {
        setLogs((prev) => prev + data);
        // Detect build start
        if (data.includes('Building project') || data.includes('🔨 Step 1')) {
          setIsBuilding(true);
        }
        // Detect build completion (success or failure)
        if (data.includes('Build completed successfully') ||
          data.includes('Build failed') ||
          data.includes('❌ Build failed') ||
          data.includes('🎉 All artifacts uploaded') ||
          data.includes('Release Process Completed')) {
          setIsBuilding(false);
        }
      });

      // Listen for build complete event
      window.api.onBuildComplete?.(() => {
        setIsBuilding(false);
      });
    }
    return () => {
      if (window.api) {
        window.api.removeBuildLogListener();
        window.api.removeBuildCompleteListener?.();
      }
    };
  }, []);

  // ============ HANDLERS ============

  const handleSelectFolder = async () => {
    const path = await window.api.selectFolder();
    if (path) {
      setProjectPath(path);
      setVersionWasEdited(false);
      setVersion('');
      setTitle('');
      setNotes('### What\'s New\n\n- Bug fixes\n- Performance improvements\n- New features');
      setAggregateSources([]);
      setSelectedReleaseTags(new Set());
      setLogs(`📂 Project loaded: ${path}\n`);
      await Promise.all([
        fetchReleases(path),
        loadProjectInfo(path, { resetVersion: true })
      ]);
      toast.success(`Project loaded successfully!`, 'Project Ready');
    }
  };

  const loadProjectInfo = async (path, { resetVersion = false } = {}) => {
    if (!path) return;
    try {
      const info = await window.api.getProjectInfo(path);
      const currentVersion = info?.currentVersion || info?.version || '';
      const nextTag = info?.suggestedTag || '';

      setProjectVersion(currentVersion);
      setSuggestedVersion(nextTag);

      if (resetVersion) {
        setVersion(nextTag);
        setVersionWasEdited(false);
      }

      if (info?.suggestedBuildCommand) {
        setBuildCommand(info.suggestedBuildCommand);
      } else {
        setBuildCommand(prev => prev || 'npm run build');
      }

      return {
        currentVersion,
        suggestedTag: nextTag,
        suggestedBuildCommand: info?.suggestedBuildCommand || null
      };
    } catch (error) {
      setProjectVersion('');
      setSuggestedVersion('');
      if (resetVersion) setVersion('');
      toast.error(error?.message || 'Could not read package.json', 'Project Info');
      return null;
    }
  };

  const fetchReleases = async (path) => {
    setIsLoading(true);
    try {
      const data = await window.api.getReleases(path);
      setReleases(Array.isArray(data) ? data : []);
    } catch (error) {
      setReleases([]);
      toast.error(error?.message || 'Could not load releases', 'Release History');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuild = () => {
    if (!projectPath) return;
    if (!buildCommand?.trim()) {
      toast.warning('Please set a build command first', 'Missing Command');
      return;
    }
    setLogs('');
    setActiveTab('logs');
    setIsBuilding(true);
    toast.info('Build process started...', 'Building');
    window.api.triggerBuild({ path: projectPath, command: buildCommand });
  };

  const handleVersionChange = (nextVersion) => {
    setVersion(nextVersion);
    setVersionWasEdited(true);
  };

  const handleCreateRelease = () => {
    if (!version || !title || !projectPath) {
      toast.warning('Please fill in both version and title', 'Missing Fields');
      return;
    }
    if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version.trim())) {
      toast.warning('Use a semantic version such as v1.4.2', 'Invalid Version');
      return;
    }
    setShowReleaseConfirm(true);
  };

  const handleConfirmRelease = async () => {
    if (!version || !title || !projectPath) {
      setShowReleaseConfirm(false);
      toast.error('Please fill in version and title', 'Validation Error');
      return;
    }

    setShowReleaseConfirm(false);
    setIsReleasing(true);
    const aggregateSourceTags = [...new Set(
      aggregateSources
        .filter(tagName => typeof tagName === 'string')
        .map(tagName => tagName.trim())
        .filter(Boolean)
    )];
    setLogs(prev => prev + `\n🚀 Starting release process for ${version}...\n`);
    setActiveTab('logs');

    try {
      const result = await window.api.createRelease({
        path: projectPath,
        version,
        versionWasEdited,
        title,
        notes,
        buildCommand
      });

      if (result.success || result.partialSuccess) {
        const releasedTag = result.tagName || result.version || version;
        const aggregateTagsToDelete = aggregateSourceTags.filter(tagName => tagName !== releasedTag);
        if (result.packageVersionVerified && result.packageVersion) {
          setProjectVersion(result.packageVersion);
        }
        setLogs(prev => prev + `\n✅ Release process completed for ${releasedTag}.\n`);
        if (result.partialSuccess) {
          toast.warning(
            result.code?.startsWith('VERSION_')
              ? result.error
              : result.releaseCreated
              ? 'Release created, but the workflow did not finish completely. Check the logs.'
              : 'The workflow only partially completed. Repository state was refreshed; check the logs.',
            result.code?.startsWith('VERSION_') ? 'Version Sync Warning' : 'Partial Success'
          );
        } else {
          toast.release(`${releasedTag} - ${title}`, 'Release Published! 🎉');
        }

        if (result.success && result.releaseCreated === true && aggregateTagsToDelete.length > 0) {
          setIsBulkDeleting(true);
          setLogs(prev => prev + `\n🧹 Removing ${aggregateTagsToDelete.length} aggregate source releases...\n`);

          try {
            const cleanupResult = await window.api.bulkDeleteReleases({
              path: projectPath,
              tagNames: aggregateTagsToDelete
            });
            const cleanupResults = Array.isArray(cleanupResult?.results)
              ? cleanupResult.results
              : [];

            if (!cleanupResults.length) {
              throw new Error(cleanupResult?.error || 'Source release cleanup returned no result.');
            }

            const deletedTags = cleanupResults
              .filter(item => item.success)
              .map(item => item.tagName);
            const failedCleanup = cleanupResults.filter(item => !item.success);

            setLogs(prev => prev + cleanupResults.map(item =>
              `${item.success ? '✅' : '❌'} Source ${item.tagName}${item.error ? `: ${item.error}` : ''}`
            ).join('\n') + '\n');
            setSelectedReleaseTags(new Set(failedCleanup.map(item => item.tagName)));

            if (failedCleanup.length > 0) {
              toast.warning(
                `${deletedTags.length} source releases deleted, ${failedCleanup.length} failed and remain selected.`,
                'Aggregate Cleanup Incomplete'
              );
            } else {
              toast.success(
                `${deletedTags.length} source releases were deleted after publishing ${releasedTag}.`,
                'Aggregate Cleanup Complete'
              );
            }
          } catch (cleanupError) {
            setSelectedReleaseTags(new Set(aggregateTagsToDelete));
            setLogs(prev => prev + `❌ Aggregate source cleanup failed: ${cleanupError?.message || 'Unknown error'}\n`);
            toast.warning(
              'The new release was published, but its source releases could not be deleted. They remain selected for retry.',
              'Aggregate Cleanup Failed'
            );
          } finally {
            setIsBulkDeleting(false);
          }
        } else if (result.releaseCreated === true && aggregateTagsToDelete.length > 0) {
          setSelectedReleaseTags(new Set(aggregateTagsToDelete));
          toast.warning(
            'The aggregate source releases were kept because the publish or artifact upload was not fully successful.',
            'Sources Preserved'
          );
        }

        const [, refreshedInfo] = await Promise.all([
          fetchReleases(projectPath),
          loadProjectInfo(projectPath, { resetVersion: true })
        ]);
        resetForm(refreshedInfo?.suggestedTag || result.suggestedTag || result.nextVersionTag || '');

        if (
          result.packageVersionVerified &&
          result.persistedPackageVersion &&
          refreshedInfo?.currentVersion !== result.persistedPackageVersion
        ) {
          toast.error(
            `Release tag ${releasedTag} was created, but package.json read-back returned ${refreshedInfo?.currentVersion || 'no version'}.`,
            'Version Sync Error'
          );
        }
      } else {
        toast.error(result.error || 'Check logs for details', 'Release Failed');
        const refreshedInfo = await loadProjectInfo(projectPath, { resetVersion: false });
        if (!versionWasEdited && refreshedInfo?.suggestedTag) {
          setVersion(refreshedInfo.suggestedTag);
        }
        if (result.rolledBack && refreshedInfo?.currentVersion) {
          toast.info(
            `package.json was restored to v${refreshedInfo.currentVersion}; ${refreshedInfo.suggestedTag || version} remains the pending release tag.`,
            'Version Restored'
          );
        }
        if (result.code === 'VERSION_SUGGESTION_STALE') {
          await loadProjectInfo(projectPath, { resetVersion: true });
          setActiveTab('create');
        }
        setLogs(prev => prev + `\n❌ Error: ${result.error || 'Unknown release error'}\n`);
      }
    } catch (error) {
      await loadProjectInfo(projectPath, { resetVersion: false });
      toast.error(error?.message || 'Could not start the release process', 'Release Failed');
      setLogs(prev => prev + `\n❌ Error: ${error?.message || 'Unknown release error'}\n`);
    } finally {
      setIsReleasing(false);
    }
  };

  const handleDeleteRelease = async () => {
    if (!pendingDelete || !pendingDelete.tagName) return;

    const deletedItem = pendingDelete.tagName;
    setIsDeleting(true);
    setLogs(prev => prev + `\n🗑️ Deleting ${pendingDelete.type === 'tag-only' ? 'tag' : 'release'}: ${deletedItem}...\n`);

    try {
      const result = await window.api.deleteRelease({
        path: projectPath,
        tagName: deletedItem
      });

      if (result.success) {
        setLogs(prev => prev + `✅ Successfully deleted ${deletedItem}.\n`);
        toast.success(`${deletedItem} has been deleted`, 'Deleted');
        setSelectedReleaseTags(prev => {
          const next = new Set(prev);
          next.delete(deletedItem);
          return next;
        });
        await fetchReleases(projectPath);
      } else {
        toast.error(result.error || `Failed to delete ${deletedItem}`, 'Delete Error');
        setLogs(prev => prev + `❌ Delete Error: ${result.error || 'Unknown error'}\n`);
      }
    } catch (error) {
      toast.error(error?.message || `Failed to delete ${deletedItem}`, 'Delete Error');
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const handleToggleRelease = (tagName, selected) => {
    setSelectedReleaseTags(prev => {
      const next = new Set(prev);
      if (selected) next.add(tagName);
      else next.delete(tagName);
      return next;
    });
  };

  const handleSelectAllReleases = (tagNames) => {
    setSelectedReleaseTags(new Set(tagNames));
  };

  const handleRequestBulkDelete = (tagNames) => {
    if (!tagNames?.length) return;
    setPendingBulkDelete([...tagNames]);
  };

  const handleConfirmBulkDelete = async () => {
    if (!pendingBulkDelete.length || !projectPath) return;

    const tagNames = [...pendingBulkDelete];
    setIsBulkDeleting(true);
    setLogs(prev => prev + `\n🗑️ Deleting ${tagNames.length} selected releases...\n`);

    try {
      const result = await window.api.bulkDeleteReleases({
        path: projectPath,
        tagNames
      });
      const results = Array.isArray(result?.results) ? result.results : [];
      if (!results.length && !result?.success) {
        throw new Error(result?.error || 'Bulk delete did not return a result.');
      }
      const succeeded = results.filter(item => item.success).map(item => item.tagName);
      const failed = results.filter(item => !item.success);

      setLogs(prev => prev + results.map(item =>
        `${item.success ? '✅' : '❌'} ${item.tagName}${item.error ? `: ${item.error}` : ''}`
      ).join('\n') + '\n');

      setSelectedReleaseTags(new Set(failed.map(item => item.tagName)));
      setPendingBulkDelete([]);
      await fetchReleases(projectPath);

      if (failed.length) {
        toast.warning(`${succeeded.length} deleted, ${failed.length} failed. Failed items remain selected.`, 'Bulk Delete');
      } else {
        toast.success(`${succeeded.length || tagNames.length} releases deleted.`, 'Bulk Delete Complete');
      }
    } catch (error) {
      toast.error(error?.message || 'Bulk delete failed', 'Bulk Delete');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleAggregateReleases = async (selectedReleases) => {
    const tagNames = selectedReleases.map(release => release.tagName).filter(Boolean);
    if (tagNames.length < 2 || !projectPath) {
      toast.warning('Select at least two releases to combine.', 'AI Aggregate');
      return;
    }

    setIsAggregating(true);
    try {
      const [result, versionInfo] = await Promise.all([
        window.api.aggregateReleaseNotes({ path: projectPath, tagNames }),
        loadProjectInfo(projectPath)
      ]);
      if (!result?.success) {
        toast.error(result?.error || 'Could not aggregate the selected releases.', 'AI Aggregate');
        return;
      }

      const aggregateVersion = versionInfo?.suggestedTag || suggestedVersion;
      if (!versionWasEdited && !aggregateVersion) {
        toast.error('Could not resolve the next package version. Refresh the project and try again.', 'Version Sync');
        return;
      }

      setTitle(result.title || `Combined release (${tagNames.length} versions)`);
      setNotes(result.notes || result.result || '');
      setAggregateSources(result.sources?.length ? result.sources : tagNames);
      if (!versionWasEdited) setVersion(aggregateVersion);
      setActiveTab('create');
      const totalTokens = Number(result.usage?.totalTokens) || 0;
      if (totalTokens) {
        setLogs(prev => prev + `\n🤖 DeepSeek V4 Flash used ${totalTokens.toLocaleString()} tokens for the combined draft.\n`);
      }
      toast.success(
        `Combined ${tagNames.length} releases into a new draft${totalTokens ? ` · ${totalTokens.toLocaleString()} tokens` : ''}.`,
        'AI Notes Ready'
      );
    } catch (error) {
      toast.error(error?.message || 'Could not aggregate the selected releases.', 'AI Aggregate');
    } finally {
      setIsAggregating(false);
    }
  };

  const resetForm = (nextVersion = suggestedVersion) => {
    setVersion(nextVersion);
    setVersionWasEdited(false);
    setTitle('');
    setNotes('### What\'s New\n\n- Bug fixes\n- Performance improvements\n- New features');
    setAggregateSources([]);
  };

  const handleCopyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.info('Copied to clipboard!', 'Copied');
  };

  const formatProjectName = (path) => {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  };

  // ============ RENDER ============

  return (
    <div className="app-container">
      {!isAppReady && <AppLoader ghStatus={ghStatus} />}
      {/* TOAST NOTIFICATIONS */}
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* AMBIENT EFFECTS */}
      <div className="ambient-particles"></div>
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>
      <div className="glow-orb orb-3"></div>

      {/* HEADER */}
      <Header
        activeTab={activeTab}
        projectVersion={projectVersion}
      />

      {/* MAIN LAYOUT */}
      <div className="main-layout">
        {/* SIDEBAR */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          projectPath={projectPath}
          projectVersion={projectVersion}
          pendingPackageVersion={pendingPackageVersion}
          buildCommand={buildCommand}
          setBuildCommand={setBuildCommand}
          handleSelectFolder={handleSelectFolder}
          isBuilding={isBuilding}
          releasesCount={releasesOnly.length}
          tagsCount={tagsOnly.length}
          handleCopyToClipboard={handleCopyToClipboard}
        />

        {/* MAIN CONTENT */}
        <main className="main-content">
          <div className="content-area">
            {!projectPath ? (
              <EmptyState
                handleSelectFolder={handleSelectFolder}
                ghStatus={ghStatus}
                handleSetupGh={() => ensureGhReady(true)}
              />
            ) : (
              <>
                {activeTab === 'create' && (
                  <CreateRelease
                    key={projectPath}
                    version={version}
                    setVersion={setVersion}
                    onVersionChange={handleVersionChange}
                    onResetForm={() => resetForm(suggestedVersion)}
                    title={title}
                    setTitle={setTitle}
                    notes={notes}
                    setNotes={setNotes}
                    isPreview={isPreview}
                    setIsPreview={setIsPreview}
                    isReleasing={isReleasing}
                    handleCreateRelease={handleCreateRelease}
                    suggestedVersion={suggestedVersion}
                    currentPackageVersion={projectVersion}
                    pendingPackageVersion={pendingPackageVersion}
                    projectPath={projectPath}
                    aggregateSources={aggregateSources}
                  />
                )}

                {activeTab === 'history' && (
                  <ReleaseHistory
                    releases={releases}
                    isLoading={isLoading}
                    activeHistorySubTab={activeHistorySubTab}
                    setActiveHistorySubTab={setActiveHistorySubTab}
                    fetchReleases={fetchReleases}
                    projectPath={projectPath}
                    setPendingDelete={setPendingDelete}
                    isDeleting={isDeleting}
                    selectedReleaseTags={selectedReleaseTags}
                    onToggleRelease={handleToggleRelease}
                    onSelectAllReleases={handleSelectAllReleases}
                    onClearSelection={() => setSelectedReleaseTags(new Set())}
                    onBulkDelete={handleRequestBulkDelete}
                    onAggregateReleases={handleAggregateReleases}
                    isBulkDeleting={isBulkDeleting}
                    isAggregating={isAggregating}
                  />
                )}

                {activeTab === 'logs' && (
                  <BuildLogs
                    logs={logs}
                    setLogs={setLogs}
                    isBuilding={isBuilding}
                    handleBuild={handleBuild}
                  />
                )}
              </>
            )}
          </div>

        </main>
      </div>

      {/* MODALS */}
      <DeleteModal
        isOpen={!!pendingDelete}
        pendingDelete={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteRelease}
        isDeleting={isDeleting}
      />

      <BulkDeleteModal
        isOpen={pendingBulkDelete.length > 0}
        tagNames={pendingBulkDelete}
        onClose={() => setPendingBulkDelete([])}
        onConfirm={handleConfirmBulkDelete}
        isDeleting={isBulkDeleting}
      />

      <ReleaseModal
        isOpen={showReleaseConfirm}
        onClose={() => setShowReleaseConfirm(false)}
        onConfirm={handleConfirmRelease}
        version={version}
        currentPackageVersion={projectVersion}
        pendingPackageVersion={pendingPackageVersion}
        title={title}
        notes={notes}
        projectName={formatProjectName(projectPath)}
        isReleasing={isReleasing}
        versionMode={versionWasEdited ? 'manual' : 'auto'}
        aggregateSources={aggregateSources}
      />
    </div>
  );
}

export default App;
