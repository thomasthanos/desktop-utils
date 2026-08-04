import { Keyboard, Settings } from "lucide-react";
import { useState } from "react";

interface HotkeySettingsProps {
  startStopKey: string;
  onStartStopKeyChange: (key: string) => void;
}

const HotkeySettings = ({ startStopKey, onStartStopKeyChange }: HotkeySettingsProps) => {
  const [isRecording, setIsRecording] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording) return;
    e.preventDefault();
    
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    
    onStartStopKeyChange(key);
    setIsRecording(false);
  };

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
          <Keyboard className="w-4 h-4 text-accent-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Hotkey Settings</p>
          <p className="text-xs text-muted-foreground">Keyboard shortcuts</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Start/Stop</span>
        </div>
        
        <button
          onClick={() => setIsRecording(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsRecording(false)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isRecording 
              ? 'bg-primary text-primary-foreground animate-pulse' 
              : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
        >
          {isRecording ? 'Press a key...' : startStopKey}
        </button>
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">Emergency Stop</span>
        </div>
        <span className="px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium">
          ESC
        </span>
      </div>
    </div>
  );
};

export default HotkeySettings;
