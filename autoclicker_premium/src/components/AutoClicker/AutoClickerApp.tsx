import { useState, useEffect, useCallback } from "react";
import { 
  Play, 
  Pause, 
  MousePointer2, 
  Target,
  Keyboard,
  Zap,
  Cloud
} from "lucide-react";
import WindowTitleBar from "./WindowTitleBar";
import StatCard from "./StatCard";
import IntervalSettings from "./IntervalSettings";
import RandomIntervalSettings from "./RandomIntervalSettings";
import MouseButtonSelect, { MouseButton } from "./MouseButtonSelect";
import ClickTypeSelect, { ClickType } from "./ClickTypeSelect";
import RepeatSettings, { RepeatMode } from "./RepeatSettings";
import ClicksPerPosition from "./ClicksPerPosition";
import LocationSettings from "./LocationSettings";
import { type LocationMode, type ClickPosition, type PositionCategory, createDefaultCategories } from "./types";
import SettingsPanel from "./SettingsPanel";
import SaveLoadPanel from "./SaveLoadPanel";
import ClickAnimation from "./ClickAnimation";
import { useAppSettings } from "@/hooks/useAppSettings";
import { toast } from "@/components/ui/sonner";
import type {} from "@/types/electron";

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const AutoClickerApp = () => {
  // Cloud settings sync
  const { settings, syncing, updateSettings, loading: settingsLoading } = useAppSettings();

  // Interval Settings (synced with cloud)
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [milliseconds, setMilliseconds] = useState(100);

  // Random Interval
  const [randomEnabled, setRandomEnabled] = useState(false);
  const [randomMin, setRandomMin] = useState(0.1);
  const [randomMax, setRandomMax] = useState(0.2);

  // Mouse Settings
  const [mouseButton, setMouseButton] = useState<MouseButton>('left');
  const [clickType, setClickType] = useState<ClickType>('single');

  // Repeat Settings
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('until_stopped');
  const [repeatCount, setRepeatCount] = useState(100);

  // Location Settings
  const [locationMode, setLocationMode] = useState<LocationMode>('current');
  const [positions, setPositions] = useState<ClickPosition[]>([]);
  const [categories, setCategories] = useState<PositionCategory[]>(createDefaultCategories());
  const [clicksPerPosition, setClicksPerPosition] = useState(1);

  // Hotkey Settings
  const [startStopKey, setStartStopKey] = useState('F6');
  const [emergencyStopKey, setEmergencyStopKey] = useState('F7');

  // State
  const [isRunning, setIsRunning] = useState(false);
  const [totalClicks, setTotalClicks] = useState(0);
  const [clicksThisSession, setClicksThisSession] = useState(0);
  const [currentPositionIndex, setCurrentPositionIndex] = useState(0);
  const [robotjsAvailable, setRobotjsAvailable] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaveLoadOpen, setIsSaveLoadOpen] = useState(false);

  // Sync local state with cloud settings when loaded
  useEffect(() => {
    if (!settingsLoading && settings) {
      setHours(settings.hours);
      setMinutes(settings.minutes);
      setSeconds(settings.seconds);
      setMilliseconds(settings.milliseconds);
      setRandomEnabled(settings.randomEnabled);
      setRandomMin(settings.randomMin);
      setRandomMax(settings.randomMax);
      setMouseButton(settings.mouseButton);
      setClickType(settings.clickType);
      setRepeatMode(settings.repeatMode);
      setRepeatCount(settings.repeatCount);
      setLocationMode(settings.locationMode);
      setClicksPerPosition(settings.clicksPerPosition);
      setStartStopKey(settings.startStopKey);
      setEmergencyStopKey(settings.emergencyStopKey || 'F7');
    }
  }, [settingsLoading, settings]);

  // Check if robotjs is available
  useEffect(() => {
    if (isElectron) {
      window.electronAPI?.checkRobotjs().then(result => {
        setRobotjsAvailable(result.available);
      });
    }
  }, []);

  // Push full config to main process so global hotkeys can start/stop reliably
  useEffect(() => {
    if (!isElectron) return;
    const cfg = {
      interval: { hours, minutes, seconds, milliseconds },
      random: { enabled: randomEnabled, minSeconds: randomMin, maxSeconds: randomMax },
      repeat: { mode: repeatMode, count: repeatCount },
      mouse: { button: mouseButton, clickType },
      location: { mode: locationMode, positions, clicksPerPosition, categories },
    };
    window.electronAPI?.clickerSetConfig(cfg);
  }, [hours, minutes, seconds, milliseconds, randomEnabled, randomMin, randomMax, repeatMode, repeatCount, mouseButton, clickType, locationMode, positions, clicksPerPosition, categories]);

  // Register global hotkeys in Electron (so they work even when app loses focus)
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.setStartStopHotkey(startStopKey);
  }, [startStopKey]);

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.setEmergencyStopHotkey(emergencyStopKey);
  }, [emergencyStopKey]);

  // Calculate interval in ms
  const calculateInterval = useCallback(() => {
    if (randomEnabled) {
      return Math.random() * (randomMax - randomMin) * 1000 + randomMin * 1000;
    }
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
  }, [hours, minutes, seconds, milliseconds, randomEnabled, randomMin, randomMax]);

  // Handle interval change with cloud sync
  const handleIntervalChange = (field: 'hours' | 'minutes' | 'seconds' | 'milliseconds', value: number) => {
    switch (field) {
      case 'hours': 
        setHours(value); 
        updateSettings({ hours: value });
        break;
      case 'minutes': 
        setMinutes(value); 
        updateSettings({ minutes: value });
        break;
      case 'seconds': 
        setSeconds(value); 
        updateSettings({ seconds: value });
        break;
      case 'milliseconds': 
        setMilliseconds(value); 
        updateSettings({ milliseconds: value });
        break;
    }
  };

  // Wrapper functions to sync settings to cloud
  const handleRandomEnabledChange = (value: boolean) => {
    setRandomEnabled(value);
    updateSettings({ randomEnabled: value });
  };

  const handleRandomMinChange = (value: number) => {
    setRandomMin(value);
    updateSettings({ randomMin: value });
  };

  const handleRandomMaxChange = (value: number) => {
    setRandomMax(value);
    updateSettings({ randomMax: value });
  };

  const handleMouseButtonChange = (value: MouseButton) => {
    setMouseButton(value);
    updateSettings({ mouseButton: value });
  };

  const handleClickTypeChange = (value: ClickType) => {
    setClickType(value);
    updateSettings({ clickType: value });
  };

  const handleRepeatModeChange = (value: RepeatMode) => {
    setRepeatMode(value);
    updateSettings({ repeatMode: value });
  };

  const handleRepeatCountChange = (value: number) => {
    setRepeatCount(value);
    updateSettings({ repeatCount: value });
  };

  const handleLocationModeChange = (value: LocationMode) => {
    setLocationMode(value);
    updateSettings({ locationMode: value });
  };

  const handleClicksPerPositionChange = (value: number) => {
    setClicksPerPosition(value);
    updateSettings({ clicksPerPosition: value });
  };

  const handleStartStopKeyChange = (value: string) => {
    setStartStopKey(value);
    updateSettings({ startStopKey: value });
  };

  const handleEmergencyStopKeyChange = (value: string) => {
    setEmergencyStopKey(value);
    updateSettings({ emergencyStopKey: value });
  };

  const toggleRunning = useCallback(() => {
    setIsRunning(prev => {
      if (!prev) {
        setClicksThisSession(0);
      }
      return !prev;
    });
  }, []);

  // Get enabled positions only
  const getEnabledPositions = useCallback(() => {
    return positions.filter(p => p.enabled);
  }, [positions]);

  // Main clicking loop
  // - Web: renderer loop (simulation)
  // - Electron: main-process clicker engine (reliable global stop)
  useEffect(() => {
    if (isElectron) return;
    if (!isRunning) return;

    let timeoutId: NodeJS.Timeout;
    let clicks = 0;
    let posIndex = currentPositionIndex;

    const doClick = () => {
      if (repeatMode === 'times' && clicks >= repeatCount) {
        setIsRunning(false);
        return;
      }

      clicks++;
      setTotalClicks(prev => prev + (clickType === 'double' ? 2 : 1));
      setClicksThisSession(prev => prev + 1);

      if (locationMode === 'multi') {
        const enabledPositionsNow = getEnabledPositions();
        if (enabledPositionsNow.length > 0) {
          posIndex = (posIndex + 1) % enabledPositionsNow.length;
          setCurrentPositionIndex(posIndex);
        }
      }

      const nextInterval = calculateInterval();
      timeoutId = setTimeout(doClick, nextInterval);
    };

    const initialInterval = calculateInterval();
    timeoutId = setTimeout(doClick, initialInterval);

    return () => clearTimeout(timeoutId);
  }, [isRunning, repeatMode, repeatCount, clickType, calculateInterval, locationMode, getEnabledPositions, currentPositionIndex]);

  // Electron: receive status/stats/errors from the MAIN process clicker
  useEffect(() => {
    if (!isElectron) return;

    const offStatus = window.electronAPI?.onClickerStatus((payload) => {
      setIsRunning(Boolean(payload?.running));
      if (payload?.running) {
        setClicksThisSession(payload?.sessionClicks ?? 0);
      }
      if (typeof payload?.totalClicks === 'number') setTotalClicks(payload.totalClicks);
      if (typeof payload?.positionIndex === 'number') setCurrentPositionIndex(payload.positionIndex);
    });

    const offStats = window.electronAPI?.onClickerStats((payload) => {
      if (typeof payload?.totalClicks === 'number') setTotalClicks(payload.totalClicks);
      if (typeof payload?.sessionClicks === 'number') setClicksThisSession(payload.sessionClicks);
      if (typeof payload?.positionIndex === 'number') setCurrentPositionIndex(payload.positionIndex);
    });

    const offErr = window.electronAPI?.onClickerError((payload) => {
      toast.error(payload?.message || 'Clicker error');
    });
    const offHotkeyError = window.electronAPI?.onHotkeyError((payload) => {
      toast.error(`${payload.message}: ${payload.key}`);
    });

    // Debug: show interval calculation - temporary
    const offIntervalDebug = (window.electronAPI as any)?.onIntervalDebug?.((payload: any) => {
      toast.info(`Interval: h=${payload.hours} m=${payload.minutes} s=${payload.seconds} ms=${payload.milliseconds} → ${payload.clampedMs}ms`);
    });

    // Sync initial status
    window.electronAPI?.clickerGetStatus().then((s) => {
      if (!s) return;
      setIsRunning(Boolean(s.running));
      setTotalClicks(s.totalClicks ?? 0);
      setClicksThisSession(s.sessionClicks ?? 0);
      setCurrentPositionIndex(s.positionIndex ?? 0);
    });

    return () => {
      offStatus?.();
      offStats?.();
      offErr?.();
      offHotkeyError?.();
      offIntervalDebug?.();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    // In Electron we use GLOBAL hotkeys from the main process.
    // If we also listen here, F6 will toggle twice (start then instantly stop / vice-versa).
    if (isElectron) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      let pressedKey = e.key;
      if (pressedKey === ' ') pressedKey = 'Space';
      if (pressedKey.length === 1) pressedKey = pressedKey.toUpperCase();

      if (pressedKey === startStopKey) {
        e.preventDefault();
        toggleRunning();
      } else if (pressedKey === emergencyStopKey && isRunning) {
        setIsRunning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleRunning, isRunning, startStopKey]);

  // Get current position for animation
  const getCurrentPosition = () => {
    if (locationMode === 'current') return null;
    if (positions.length === 0) return null;
    if (locationMode === 'fixed') return positions[0];
    return positions[currentPositionIndex] || positions[0];
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="w-full h-screen flex flex-col overflow-hidden">
        <ClickAnimation isActive={isRunning} currentPosition={getCurrentPosition()} />
        
        {/* Settings Modal */}
        <SettingsPanel
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          startStopKey={startStopKey}
          onStartStopKeyChange={handleStartStopKeyChange}
          emergencyStopKey={emergencyStopKey}
          onEmergencyStopKeyChange={handleEmergencyStopKeyChange}
        />

        {/* Save/Load Panel */}
        <SaveLoadPanel
          isOpen={isSaveLoadOpen}
          onClose={() => setIsSaveLoadOpen(false)}
          currentPositions={positions}
          currentCategories={categories}
          onLoadPositions={setPositions}
          onLoadCategories={setCategories}
        />
        
        <WindowTitleBar onOpenSettings={() => setIsSettingsOpen(true)} />
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={MousePointer2}
              label="Total Clicks"
              value={totalClicks.toLocaleString()}
              color="primary"
            />
            <StatCard
              icon={Target}
              label="Session Clicks"
              value={clicksThisSession}
              color="success"
            />
            <StatCard
              icon={Zap}
              label="Clicks/Sec"
              value={isRunning ? Math.round(1000 / calculateInterval()) : 0}
              color="warning"
            />
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column */}
            <div className="space-y-4">
              <IntervalSettings
                hours={hours}
                minutes={minutes}
                seconds={seconds}
                milliseconds={milliseconds}
                onChange={handleIntervalChange}
                disabled={randomEnabled}
              />

              <RandomIntervalSettings
                enabled={randomEnabled}
                minSeconds={randomMin}
                maxSeconds={randomMax}
                onEnabledChange={handleRandomEnabledChange}
                onMinChange={handleRandomMinChange}
                onMaxChange={handleRandomMaxChange}
              />

              <div className="glass-panel p-4 space-y-3">
                <MouseButtonSelect value={mouseButton} onChange={handleMouseButtonChange} />
                <div className="border-t border-border/50" />
                <ClickTypeSelect value={clickType} onChange={handleClickTypeChange} />
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <RepeatSettings
                mode={repeatMode}
                repeatCount={repeatCount}
                onModeChange={handleRepeatModeChange}
                onRepeatCountChange={handleRepeatCountChange}
              />

              <LocationSettings
                mode={locationMode}
                positions={positions}
                categories={categories}
                onModeChange={handleLocationModeChange}
                onPositionsChange={setPositions}
                onCategoriesChange={setCategories}
                onOpenSaveLoad={() => setIsSaveLoadOpen(true)}
              />

              {/* Clicks Per Position - only show in multi mode */}
              {locationMode === 'multi' && (
                <ClicksPerPosition
                  value={clicksPerPosition}
                  onChange={handleClicksPerPositionChange}
                />
              )}
            </div>
          </div>

          {/* Sync Indicator */}
          {syncing && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Cloud className="w-3 h-3 animate-pulse" />
              <span>Syncing...</span>
            </div>
          )}

          {/* Start/Stop Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={async () => {
                if (isElectron) {
                  // Send fresh config immediately before starting to ensure clicksPerPosition is correct
                  const cfg = {
                    interval: { hours, minutes, seconds, milliseconds },
                    random: { enabled: randomEnabled, minSeconds: randomMin, maxSeconds: randomMax },
                    repeat: { mode: repeatMode, count: repeatCount },
                    mouse: { button: mouseButton, clickType },
                    location: { mode: locationMode, positions, clicksPerPosition, categories },
                  };
                  await window.electronAPI?.clickerSetConfig(cfg);
                  window.electronAPI?.clickerStart();
                } else {
                  setIsRunning(true);
                }
              }}
              disabled={isRunning}
              className="py-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90 btn-primary-glow"
            >
              <Play className="w-5 h-5" />
              Start ({startStopKey})
            </button>
            <button
              onClick={() => {
                if (isElectron) {
                  window.electronAPI?.clickerStop();
                }
                setIsRunning(false);
              }}
              disabled={!isRunning}
              className={`py-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed bg-destructive text-destructive-foreground hover:bg-destructive/90 ${
                isRunning ? 'animate-pulse-glow' : ''
              }`}
            >
              <Pause className="w-5 h-5" />
              Stop ({startStopKey})
            </button>
          </div>

          {/* Hotkey Info */}
          <div className="flex items-center justify-center gap-6">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Keyboard className="w-3.5 h-3.5" />
              <span className="font-medium">{startStopKey}</span>
              <span className="text-muted-foreground/60">Start/Stop</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Keyboard className="w-3.5 h-3.5" />
              <span className="font-medium">ESC</span>
              <span className="text-muted-foreground/60">Emergency Stop</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AutoClickerApp;
