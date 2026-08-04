import { Shuffle } from "lucide-react";

interface RandomIntervalSettingsProps {
  enabled: boolean;
  minSeconds: number;
  maxSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}

const RandomIntervalSettings = ({
  enabled,
  minSeconds,
  maxSeconds,
  onEnabledChange,
  onMinChange,
  onMaxChange,
}: RandomIntervalSettingsProps) => {
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
            <Shuffle className="w-4 h-4 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Random Interval</p>
            <p className="text-xs text-muted-foreground">Randomize click timing</p>
          </div>
        </div>
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-12 h-6 rounded-full transition-colors relative ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <div
            className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="flex items-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Between</span>
          <input
            type="number"
            value={minSeconds}
            onChange={(e) => onMinChange(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
            className="number-input w-16 text-sm"
            step={0.1}
            min={0.1}
          />
          <span className="text-xs text-muted-foreground">and</span>
          <input
            type="number"
            value={maxSeconds}
            onChange={(e) => onMaxChange(Math.max(minSeconds, parseFloat(e.target.value) || 0.2))}
            className="number-input w-16 text-sm"
            step={0.1}
            min={0.1}
          />
          <span className="text-xs text-muted-foreground">secs</span>
        </div>
      )}
    </div>
  );
};

export default RandomIntervalSettings;
