import { useState, useEffect, useCallback } from "react";
import { Settings, Keyboard, Pin, X } from "lucide-react";
import type {} from "@/types/electron";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  startStopKey: string;
  onStartStopKeyChange: (key: string) => void;
  emergencyStopKey: string;
  onEmergencyStopKeyChange: (key: string) => void;
}

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const SettingsPanel = ({
  isOpen,
  onClose,
  startStopKey,
  onStartStopKeyChange,
  emergencyStopKey,
  onEmergencyStopKeyChange,
}: SettingsPanelProps) => {
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isRecordingStart, setIsRecordingStart] = useState(false);
  const [isRecordingEmergency, setIsRecordingEmergency] = useState(false);
  const [recordedStartKey, setRecordedStartKey] = useState<string | null>(null);
  const [recordedEmergencyKey, setRecordedEmergencyKey] = useState<string | null>(null);

  // Load initial always-on-top state
  useEffect(() => {
    if (isElectron) {
      window.electronAPI?.getAlwaysOnTop().then(setAlwaysOnTop);
    }
  }, []);

  // Handle always on top toggle
  const handleAlwaysOnTopChange = (value: boolean) => {
    setAlwaysOnTop(value);
    if (isElectron) {
      window.electronAPI?.setAlwaysOnTop(value);
    }
  };

  // Hotkey recording - Start/Stop
  const startRecordingStart = useCallback(() => {
    setIsRecordingStart(true);
    setIsRecordingEmergency(false);
    setRecordedStartKey(null);
  }, []);

  // Hotkey recording - Emergency Stop
  const startRecordingEmergency = useCallback(() => {
    setIsRecordingEmergency(true);
    setIsRecordingStart(false);
    setRecordedEmergencyKey(null);
  }, []);

  useEffect(() => {
    if (!isRecordingStart && !isRecordingEmergency) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      let key = e.key;
      if (key === ' ') key = 'Space';
      if (key.length === 1) key = key.toUpperCase();
      
      // Skip modifier-only keys
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      
      if (isRecordingStart) {
        setRecordedStartKey(key);
        setIsRecordingStart(false);
        onStartStopKeyChange(key);
      } else if (isRecordingEmergency) {
        setRecordedEmergencyKey(key);
        setIsRecordingEmergency(false);
        onEmergencyStopKeyChange(key);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecordingStart, isRecordingEmergency, onStartStopKeyChange, onEmergencyStopKeyChange]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 glass-panel p-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Always on Top */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Pin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Always on Top</p>
                <p className="text-xs text-muted-foreground">Keep window above others</p>
              </div>
            </div>
            <button
              onClick={() => handleAlwaysOnTopChange(!alwaysOnTop)}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                alwaysOnTop ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  alwaysOnTop ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Hotkeys Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Keyboard className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Hotkeys</span>
            </div>

            {/* Start/Stop Hotkey */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium text-foreground">Start / Stop</p>
                <p className="text-xs text-muted-foreground">Toggle auto-clicker</p>
              </div>
              <button
                onClick={startRecordingStart}
                className={`min-w-[80px] px-4 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                  isRecordingStart
                    ? 'bg-primary text-primary-foreground animate-pulse'
                    : 'bg-muted hover:bg-muted/80 text-foreground'
                }`}
              >
                {isRecordingStart ? 'Press key...' : recordedStartKey || startStopKey}
              </button>
            </div>

            {/* Emergency Stop (configurable) */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium text-foreground">Emergency Stop</p>
                <p className="text-xs text-muted-foreground">Force stop (always active)</p>
              </div>
              <button
                onClick={startRecordingEmergency}
                className={`min-w-[80px] px-4 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                  isRecordingEmergency
                    ? 'bg-destructive text-destructive-foreground animate-pulse'
                    : 'bg-destructive/20 hover:bg-destructive/30 text-destructive'
                }`}
              >
                {isRecordingEmergency ? 'Press key...' : recordedEmergencyKey || emergencyStopKey}
              </button>
            </div>
          </div>

          {/* Info */}
          {!isElectron && (
            <p className="text-xs text-warning text-center p-2 rounded-lg bg-warning/10">
              ⚠️ Settings work only in desktop app
            </p>
          )}

          {/* Copyright */}
          <div className="pt-2 border-t border-border/30">
            <p className="text-xs text-muted-foreground/60 text-center">
              © thomasthanos/Kolokithes A.E.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;