import { Zap } from "lucide-react";

interface SpeedSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

const SpeedSlider = ({ value, onChange, min = 10, max = 1000 }: SpeedSliderProps) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="glass-panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Click Speed</p>
            <p className="text-xs text-muted-foreground">Interval between clicks</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xl font-bold text-foreground">{value}</span>
          <span className="text-xs text-muted-foreground ml-1">ms</span>
        </div>
      </div>

      <div className="relative pt-1">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:shadow-lg
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110
                     [&::-moz-range-thumb]:w-4
                     [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-white
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:shadow-lg
                     [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) ${percentage}%, hsl(var(--muted)) ${percentage}%)`
          }}
        />
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">Fast</span>
          <span className="text-[10px] text-muted-foreground">Slow</span>
        </div>
      </div>
    </div>
  );
};

export default SpeedSlider;
