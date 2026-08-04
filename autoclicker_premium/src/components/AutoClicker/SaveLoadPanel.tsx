import { useState } from 'react';
import { Save, FolderOpen, Trash2, Plus, Check, X, HardDrive, HardDriveDownload, AlertTriangle } from 'lucide-react';
import { useSavedLocations, SavedProfile } from '@/hooks/useSavedLocations';
import type { ClickPosition, PositionCategory } from './types';
import { toast } from '@/components/ui/sonner';

interface SaveLoadPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentPositions: ClickPosition[];
  currentCategories?: PositionCategory[];
  onLoadPositions: (positions: ClickPosition[]) => void;
  onLoadCategories?: (categories: PositionCategory[]) => void;
}

const SaveLoadPanel = ({
  isOpen,
  onClose,
  currentPositions,
  currentCategories,
  onLoadPositions,
  onLoadCategories,
}: SaveLoadPanelProps) => {
  const { profiles, loading, error, saveProfile, deleteProfile } = useSavedLocations();
  const [isCreating, setIsCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Count total positions from categories
  const getTotalPositions = () => {
    if (currentCategories && currentCategories.length > 0) {
      return currentCategories.reduce((sum, cat) => sum + cat.positions.length, 0);
    }
    return currentPositions.length;
  };

  const handleSaveNew = async () => {
    if (!newProfileName.trim()) {
      toast.error('Please enter a profile name');
      return;
    }

    const totalPositions = getTotalPositions();
    if (totalPositions === 0) {
      toast.error('No positions to save');
      return;
    }

    setSavingId('new');
    const result = await saveProfile(newProfileName.trim(), currentPositions, currentCategories);
    setSavingId(null);
    
    if (result) {
      toast.success('Profile saved!');
      setNewProfileName('');
      setIsCreating(false);
    } else {
      toast.error('Failed to save profile');
    }
  };

  const handleLoad = (profile: SavedProfile) => {
    // Load categories if available (new format)
    if (profile.categories && profile.categories.length > 0) {
      onLoadCategories?.(profile.categories);
      // Also update flat positions for compatibility
      const allPositions = profile.categories
        .filter(cat => cat.enabled)
        .flatMap(cat => cat.positions.filter(p => p.enabled));
      onLoadPositions(allPositions);
    } else {
      // Legacy format: just positions
      onLoadPositions(profile.positions);
    }
    toast.success(`Loaded "${profile.name}"`);
    onClose();
  };

  const handleDeleteClick = (profile: SavedProfile) => {
    setDeleteConfirmId(profile.id);
  };

  const handleDeleteConfirm = async (profile: SavedProfile) => {
    const success = await deleteProfile(profile.id);
    if (success) {
      toast.success('Profile deleted');
    } else {
      toast.error('Failed to delete profile');
    }
    setDeleteConfirmId(null);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  // Get position count for a profile
  const getProfilePositionCount = (profile: SavedProfile) => {
    if (profile.categories && profile.categories.length > 0) {
      const totalCats = profile.categories.length;
      const enabledCats = profile.categories.filter(c => c.enabled).length;
      const totalPos = profile.categories.reduce((sum, cat) => sum + cat.positions.length, 0);
      return `${totalPos} pos • ${enabledCats}/${totalCats} cats`;
    }
    return `${profile.positions.length} position(s)`;
  };

  if (!isOpen) return null;

  const totalPositions = getTotalPositions();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 glass-panel p-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Saved Profiles</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* Current Positions Info */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div>
              <p className="text-sm font-medium text-foreground">Current Configuration</p>
              <p className="text-xs text-muted-foreground">
                {totalPositions} position(s)
                {currentCategories && ` • ${currentCategories.filter(c => c.enabled).length}/${currentCategories.length} categories`}
              </p>
            </div>
            {isCreating ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile name..."
                  className="w-32 px-2 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
                  autoFocus
                />
                <button
                  onClick={handleSaveNew}
                  disabled={savingId === 'new'}
                  className="w-8 h-8 rounded-lg bg-success/20 text-success hover:bg-success/30 flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setIsCreating(false); setNewProfileName(''); }}
                  className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                disabled={totalPositions === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm font-medium hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            )}
          </div>

          {/* Profiles List */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Local Profiles</span>
              {profiles.length > 0 && (
                <span className="text-xs text-muted-foreground">({profiles.length})</span>
              )}
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">Loading profiles...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <HardDriveDownload className="w-8 h-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-8">
                <HardDrive className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No saved profiles yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Add positions and save them locally
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`rounded-lg transition-colors overflow-hidden ${
                      deleteConfirmId === profile.id 
                        ? 'bg-destructive/10 border border-destructive/30' 
                        : 'bg-muted/30 hover:bg-muted/50'
                    }`}
                  >
                    {deleteConfirmId === profile.id ? (
                      // Delete confirmation UI
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                          <span className="text-sm font-medium text-foreground">
                            Delete "{profile.name}"?
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          This action cannot be undone. The profile will be permanently deleted.
                        </p>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={handleDeleteCancel}
                            className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDeleteConfirm(profile)}
                            className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Normal profile display
                      <div className="flex items-center justify-between p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{profile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {getProfilePositionCount(profile)} • {new Date(profile.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2">
                          <button
                            onClick={() => handleLoad(profile)}
                            className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition-colors"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => handleDeleteClick(profile)}
                            className="w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 bg-muted/20">
          <p className="text-xs text-muted-foreground text-center">
            Profiles saved locally in AppData\Roaming\ThomasThanos\AutoClicker
          </p>
        </div>
      </div>
    </div>
  );
};

export default SaveLoadPanel;
