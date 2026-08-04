import { Hash, Minus, Plus } from "lucide-react";

interface ClicksPerPositionProps {
  value: number;
  onChange: (value: number) => void;
}

const ClicksPerPosition = ({ value, onChange }: ClicksPerPositionProps) => {
  const increment = () => onChange(Math.min(value + 10, 9999));
  const decrement = () => onChange(Math.max(value - 10, 1));

  return (
    <div className="glass-panel p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Hash className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Clicks Per Position</p>
          <p className="text-xs text-muted-foreground">Before moving to next</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={decrement}
          className="w-10 h-10 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-foreground transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 1;
            onChange(Math.min(Math.max(val, 1), 9999));
          }}
          className="number-input w-24 text-lg"
        />
        
        <button
          onClick={increment}
          className="w-10 h-10 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default ClicksPerPosition;
