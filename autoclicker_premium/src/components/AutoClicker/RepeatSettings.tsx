import { Repeat, RotateCcw } from "lucide-react";

export type RepeatMode = 'times' | 'until_stopped';

interface RepeatSettingsProps {
  mode: RepeatMode;
  repeatCount: number;
  onModeChange: (mode: RepeatMode) => void;
  onRepeatCountChange: (count: number) => void;
}

const RepeatSettings = ({
  mode,
  repeatCount,
  onModeChange,
  onRepeatCountChange,
}: RepeatSettingsProps) => {
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
          <Repeat className="w-4 h-4 text-success" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Repeat Mode</p>
          <p className="text-xs text-muted-foreground">How many times to click</p>
        </div>
      </div>

      <div className="space-y-2">
        {/* Repeat Times Option */}
        <label className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
          <div 
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              mode === 'times' ? 'border-primary' : 'border-muted-foreground'
            }`}
          >
            {mode === 'times' && (
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            )}
          </div>
          <span className="text-sm text-foreground flex-1">Repeat</span>
          <input
            type="number"
            value={repeatCount}
            onChange={(e) => onRepeatCountChange(Math.max(1, parseInt(e.target.value) || 1))}
            onClick={() => onModeChange('times')}
            className="number-input w-20 text-sm"
            min={1}
          />
          <span className="text-sm text-muted-foreground">times</span>
        </label>

        {/* Repeat Until Stopped Option */}
        <label 
          className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onModeChange('until_stopped')}
        >
          <div 
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              mode === 'until_stopped' ? 'border-primary' : 'border-muted-foreground'
            }`}
          >
            {mode === 'until_stopped' && (
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            )}
          </div>
          <RotateCcw className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Repeat Until Stopped</span>
        </label>
      </div>
    </div>
  );
};

export default RepeatSettings;
