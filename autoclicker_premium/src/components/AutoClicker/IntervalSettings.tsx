import { Clock } from "lucide-react";

interface IntervalSettingsProps {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  onChange: (field: 'hours' | 'minutes' | 'seconds' | 'milliseconds', value: number) => void;
  disabled?: boolean;
}

const IntervalSettings = ({ 
  hours, 
  minutes, 
  seconds, 
  milliseconds, 
  onChange,
  disabled = false 
}: IntervalSettingsProps) => {
  const handleChange = (field: 'hours' | 'minutes' | 'seconds' | 'milliseconds', value: string) => {
    const numValue = parseInt(value) || 0;
    const maxValues = {
      hours: 23,
      minutes: 59,
      seconds: 59,
      milliseconds: 999
    };
    onChange(field, Math.min(Math.max(numValue, 0), maxValues[field]));
  };

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Clock className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Click Interval</p>
          <p className="text-xs text-muted-foreground">Time between clicks</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="flex flex-col items-center gap-1">
          <input
            type="number"
            value={hours}
            onChange={(e) => handleChange('hours', e.target.value)}
            disabled={disabled}
            className="number-input w-full text-sm disabled:opacity-50"
            min={0}
            max={23}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Hours</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <input
            type="number"
            value={minutes}
            onChange={(e) => handleChange('minutes', e.target.value)}
            disabled={disabled}
            className="number-input w-full text-sm disabled:opacity-50"
            min={0}
            max={59}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Mins</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <input
            type="number"
            value={seconds}
            onChange={(e) => handleChange('seconds', e.target.value)}
            disabled={disabled}
            className="number-input w-full text-sm disabled:opacity-50"
            min={0}
            max={59}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Secs</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <input
            type="number"
            value={milliseconds}
            onChange={(e) => handleChange('milliseconds', e.target.value)}
            disabled={disabled}
            className="number-input w-full text-sm disabled:opacity-50"
            min={0}
            max={999}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Millis</span>
        </div>
      </div>
    </div>
  );
};

export default IntervalSettings;
