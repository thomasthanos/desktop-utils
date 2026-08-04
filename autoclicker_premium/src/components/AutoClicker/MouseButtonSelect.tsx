import { MousePointer2, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export type MouseButton = 'left' | 'right' | 'middle';

interface MouseButtonSelectProps {
  value: MouseButton;
  onChange: (value: MouseButton) => void;
}

const options: { value: MouseButton; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'middle', label: 'Middle' },
];

const MouseButtonSelect = ({ value, onChange }: MouseButtonSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find(o => o.value === value)?.label || 'Left';

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <MousePointer2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-foreground">Mouse Button</span>
      </div>
      
      <div ref={ref} className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border hover:bg-muted transition-colors min-w-[90px]"
        >
          <span className="text-sm text-foreground">{selectedLabel}</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg z-10 overflow-hidden">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors ${
                  value === option.value ? 'bg-primary/10 text-primary' : 'text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MouseButtonSelect;
