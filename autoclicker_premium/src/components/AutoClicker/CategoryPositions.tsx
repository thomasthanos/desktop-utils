import { useState, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight, Crosshair, Trash2, Power, Target, Plus, Pencil, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type { PositionCategory, ClickPosition } from "./types";
import type {} from "@/types/electron";

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface CategoryPositionsProps {
  category: PositionCategory;
  onCategoryChange: (category: PositionCategory) => void;
  categoryIndex: number;
}

const CategoryPositions = ({ category, onCategoryChange, categoryIndex }: CategoryPositionsProps) => {
  const [isExpanded, setIsExpanded] = useState(category.enabled);
  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(category.name);

  // Listen for countdown updates from Electron
  useEffect(() => {
    if (!isElectron) return;

    const cleanup = window.electronAPI?.onCaptureCountdown((secondsLeft) => {
      setCountdown(secondsLeft);
    });

    return () => cleanup?.();
  }, []);

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
          label: `Pos ${category.positions.length + 1}`,
          enabled: true,
          customRepeatCount: category.hasCustomRepeat ? 1 : undefined,
        };

        onCategoryChange({
          ...category,
          positions: [...category.positions, newPosition],
        });
      }
    } catch (error) {
      console.error('Failed to capture position:', error);
    } finally {
      setIsCapturing(false);
      setCountdown(0);
    }
  }, [category, onCategoryChange]);

  const toggleCategoryEnabled = (enabled: boolean) => {
    onCategoryChange({ ...category, enabled });
    if (enabled) setIsExpanded(true);
  };

  const handleSaveName = () => {
    if (editedName.trim()) {
      onCategoryChange({ ...category, name: editedName.trim() });
    } else {
      setEditedName(category.name);
    }
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setEditedName(category.name);
    setIsEditingName(false);
  };

  const removePosition = (id: string) => {
    onCategoryChange({
      ...category,
      positions: category.positions.filter(p => p.id !== id),
    });
  };

  const togglePosition = (id: string) => {
    onCategoryChange({
      ...category,
      positions: category.positions.map(p =>
        p.id === id ? { ...p, enabled: !p.enabled } : p
      ),
    });
  };

  const updatePosition = (id: string, field: 'x' | 'y' | 'customRepeatCount', value: number) => {
    onCategoryChange({
      ...category,
      positions: category.positions.map(p =>
        p.id === id ? { ...p, [field]: value } : p
      ),
    });
  };

  const enabledCount = category.positions.filter(p => p.enabled).length;

  return (
    <div className={`rounded-lg border transition-all ${
      category.enabled 
        ? 'border-primary/30 bg-primary/5' 
        : 'border-border/30 bg-muted/20'
    }`}>
      {/* Category Header */}
      <div className="flex items-center gap-2 p-3">
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
        
        <div className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center ${
          category.enabled ? 'bg-primary/20 text-primary' : 'bg-muted/50 text-muted-foreground'
        }`}>
          {categoryIndex + 1}
        </div>

        {isEditingName ? (
          <div className="flex items-center gap-1 flex-1">
            <Input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              className="h-7 text-sm flex-1"
              autoFocus
            />
            <button
              onClick={handleSaveName}
              className="w-6 h-6 rounded flex items-center justify-center text-success hover:bg-success/20 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCancelEdit}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <span 
              className={`flex-1 text-sm font-medium cursor-pointer hover:text-primary transition-colors ${
                category.enabled ? 'text-foreground' : 'text-muted-foreground'
              }`}
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
            >
              {category.name}
              {category.hasCustomRepeat && (
                <span className="ml-2 text-xs text-warning">(Custom Repeats)</span>
              )}
            </span>
            <button
              onClick={() => setIsEditingName(true)}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Rename category"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </>
        )}

        {category.positions.length > 0 && !isEditingName && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {enabledCount}/{category.positions.length}
          </span>
        )}

        <Switch
          checked={category.enabled}
          onCheckedChange={toggleCategoryEnabled}
          onClick={(e) => e.stopPropagation()}
          className="data-[state=checked]:bg-primary"
        />
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Capture Overlay */}
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

          {/* Add Position Button */}
          <button
            onClick={startCapture}
            disabled={isCapturing || !category.enabled}
            className="w-full py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            {isCapturing ? `Capturing ${countdown}...` : 'Add Position'}
          </button>

          {!isElectron && category.enabled && (
            <p className="text-xs text-warning text-center">
              ⚠️ Requires desktop app
            </p>
          )}

          {/* Position List */}
          {category.positions.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {category.positions.map((pos, index) => (
                <div 
                  key={pos.id} 
                  className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                    pos.enabled 
                      ? 'bg-card/60 border-border/50' 
                      : 'bg-muted/20 border-transparent opacity-50'
                  }`}
                >
                  {/* Enable/Disable */}
                  <button
                    onClick={() => togglePosition(pos.id)}
                    disabled={!category.enabled}
                    className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                      pos.enabled 
                        ? 'bg-success/20 text-success hover:bg-success/30' 
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Power className="w-3 h-3" />
                  </button>

                  {/* Position Number */}
                  <span className="text-xs font-medium text-muted-foreground w-4">
                    #{index + 1}
                  </span>
                  
                  {/* X */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">X</span>
                    <Input
                      type="number"
                      value={pos.x}
                      onChange={(e) => updatePosition(pos.id, 'x', parseInt(e.target.value) || 0)}
                      className="w-16 h-7 text-xs text-center font-mono px-1"
                      disabled={!pos.enabled || !category.enabled}
                    />
                  </div>

                  {/* Y */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Y</span>
                    <Input
                      type="number"
                      value={pos.y}
                      onChange={(e) => updatePosition(pos.id, 'y', parseInt(e.target.value) || 0)}
                      className="w-16 h-7 text-xs text-center font-mono px-1"
                      disabled={!pos.enabled || !category.enabled}
                    />
                  </div>

                  {/* Custom Repeat (Category 4 only) */}
                  {category.hasCustomRepeat && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-warning">×</span>
                      <Input
                        type="number"
                        value={pos.customRepeatCount || 1}
                        onChange={(e) => updatePosition(pos.id, 'customRepeatCount', Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-12 h-7 text-xs text-center font-mono px-1 border-warning/30"
                        disabled={!pos.enabled || !category.enabled}
                        min={1}
                      />
                    </div>
                  )}

                  {/* Delete */}
                  <button
                    onClick={() => removePosition(pos.id)}
                    disabled={!category.enabled}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {category.positions.length === 0 && category.enabled && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No positions yet. Click "Add Position" to add.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CategoryPositions;
