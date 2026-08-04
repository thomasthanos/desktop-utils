import { useState, useEffect, useCallback } from "react";
import { Crosshair, MapPin, MousePointer, Target, Cloud } from "lucide-react";
import CategoryPositions from "./CategoryPositions";
import { createDefaultCategories, type LocationMode, type PositionCategory, type ClickPosition } from "./types";
import type {} from "@/types/electron";

// Re-export types for backwards compatibility
export type { LocationMode, ClickPosition };

interface LocationSettingsProps {
  mode: LocationMode;
  positions: ClickPosition[];
  categories?: PositionCategory[];
  onModeChange: (mode: LocationMode) => void;
  onPositionsChange: (positions: ClickPosition[]) => void;
  onCategoriesChange?: (categories: PositionCategory[]) => void;
  onOpenSaveLoad?: () => void;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const LocationSettings = ({
  mode,
  positions,
  categories: externalCategories,
  onModeChange,
  onPositionsChange,
  onCategoriesChange,
  onOpenSaveLoad,
}: LocationSettingsProps) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  // Use external categories if provided, otherwise use default
  const [localCategories, setLocalCategories] = useState<PositionCategory[]>(
    externalCategories || createDefaultCategories()
  );
  
  const categories = externalCategories || localCategories;

  // Sync external categories
  useEffect(() => {
    if (externalCategories) {
      setLocalCategories(externalCategories);
    }
  }, [externalCategories]);

  // Update parent when categories change
  const handleCategoriesChange = useCallback((newCategories: PositionCategory[]) => {
    setLocalCategories(newCategories);
    onCategoriesChange?.(newCategories);
    
    // Also update flat positions for backwards compatibility
    const allPositions = newCategories
      .filter(cat => cat.enabled)
      .flatMap(cat => cat.positions.filter(p => p.enabled));
    onPositionsChange(allPositions);
  }, [onCategoriesChange, onPositionsChange]);

  const handleCategoryChange = useCallback((updatedCategory: PositionCategory) => {
    const newCategories = categories.map(cat => 
      cat.id === updatedCategory.id ? updatedCategory : cat
    );
    handleCategoriesChange(newCategories);
  }, [categories, handleCategoriesChange]);

  // Listen for countdown updates from Electron (for fixed position mode)
  useEffect(() => {
    if (!isElectron) return;

    const cleanup = window.electronAPI?.onCaptureCountdown((secondsLeft) => {
      setCountdown(secondsLeft);
    });

    return () => cleanup?.();
  }, []);

  // Handle capture for fixed position mode
  const startCapture = useCallback(async () => {
    if (!isElectron) {
      alert('Position capture only works in the desktop app.');
      return;
    }

    setIsCapturing(true);
    setCountdown(3);

    try {
      const position = await window.electronAPI?.captureClickPosition(3);
      
      if (position) {
        const newPosition: ClickPosition = {
          id: Date.now().toString(),
          x: position.x,
          y: position.y,
          label: `Position 1`,
          enabled: true,
        };
        onPositionsChange([newPosition]);
      }
    } catch (error) {
      console.error('Failed to capture position:', error);
    } finally {
      setIsCapturing(false);
      setCountdown(0);
    }
  }, [onPositionsChange]);

  // Get total enabled positions across all categories
  const getTotalStats = () => {
    const enabledCategories = categories.filter(cat => cat.enabled);
    const totalPositions = enabledCategories.reduce((sum, cat) => sum + cat.positions.length, 0);
    const enabledPositions = enabledCategories.reduce(
      (sum, cat) => sum + cat.positions.filter(p => p.enabled).length, 
      0
    );
    return { enabledCategories: enabledCategories.length, totalPositions, enabledPositions };
  };

  const stats = mode === 'multi' ? getTotalStats() : null;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
          <Crosshair className="w-4 h-4 text-destructive" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Click Location</p>
          <p className="text-xs text-muted-foreground">Where to click</p>
        </div>
        {mode === 'multi' && stats && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {stats.enabledPositions} active
          </span>
        )}
        {/* Cloud Save/Load Button */}
        <button
          onClick={onOpenSaveLoad}
          className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
          title="Save/Load Profiles"
        >
          <Cloud className="w-4 h-4" />
        </button>
      </div>

      {/* Capture Overlay for Fixed Mode */}
      {isCapturing && (
        <div className="fixed inset-0 z-50 bg-primary/20 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-4 p-8 bg-background/95 rounded-2xl shadow-2xl border border-primary/50">
            <Target className="w-16 h-16 text-primary mx-auto animate-pulse" />
            <div className="space-y-2">
              <p className="text-4xl font-bold text-primary">
                {countdown > 0 ? countdown : '📍'}
              </p>
              <p className="text-lg text-foreground">
                {countdown > 0 ? 'Move mouse to position...' : 'Captured!'}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Window will minimize - position your mouse!
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {/* Current Location Option */}
        <label 
          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
            mode === 'current' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'
          }`}
          onClick={() => onModeChange('current')}
        >
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            mode === 'current' ? 'border-primary' : 'border-muted-foreground'
          }`}>
            {mode === 'current' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
          </div>
          <MousePointer className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Follow Mouse Cursor</span>
        </label>

        {/* Single Fixed Position */}
        <label 
          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
            mode === 'fixed' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'
          }`}
          onClick={() => onModeChange('fixed')}
        >
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            mode === 'fixed' ? 'border-primary' : 'border-muted-foreground'
          }`}>
            {mode === 'fixed' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
          </div>
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Fixed Position</span>
        </label>

        {/* Multiple Positions with Categories */}
        <label 
          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
            mode === 'multi' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'
          }`}
          onClick={() => onModeChange('multi')}
        >
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            mode === 'multi' ? 'border-primary' : 'border-muted-foreground'
          }`}>
            {mode === 'multi' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
          </div>
          <Target className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Multiple Positions</span>
        </label>
      </div>

      {/* Fixed Position Controls */}
      {mode === 'fixed' && (
        <div className="space-y-2 pt-2 border-t border-border/30">
          <button
            onClick={startCapture}
            disabled={isCapturing}
            className="w-full py-2.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Crosshair className="w-4 h-4" />
            {isCapturing ? `Capturing in ${countdown}...` : 'Pick Position'}
          </button>

          {!isElectron && (
            <p className="text-xs text-warning text-center">
              ⚠️ Requires desktop app
            </p>
          )}

          {positions.length > 0 && (
            <div className="p-2 rounded-lg bg-card/60 border border-border/50">
              <div className="flex items-center gap-4 justify-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">X:</span>
                  <span className="text-sm font-mono text-foreground">{positions[0].x}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Y:</span>
                  <span className="text-sm font-mono text-foreground">{positions[0].y}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multiple Positions with Categories */}
      {mode === 'multi' && (
        <div className="space-y-2 pt-2 border-t border-border/30 max-h-80 overflow-y-auto custom-scrollbar pr-1">
          {categories.map((category, index) => (
            <CategoryPositions
              key={category.id}
              category={category}
              categoryIndex={index}
              onCategoryChange={handleCategoryChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationSettings;
