interface ClickerDebugPayload {
  clicksPerPos?: number;
  clicksAtCurrentPosition?: number;
  posIndex?: number;
  enabledCount?: number;
  event?: string;
  from?: number;
  to?: number;
}

export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  setAlwaysOnTop: (value: boolean) => void;
  getAlwaysOnTop: () => Promise<boolean>;
  isElectron: boolean;
  platform: string;
  
  // Mouse position capture
  getMousePosition: () => Promise<{ x: number; y: number }>;
  startMouseCapture: (callback: (position: { x: number; y: number }) => void) => () => void;
  captureClickPosition: (countdownSeconds?: number) => Promise<{ x: number; y: number } | null>;
  onCaptureCountdown: (callback: (secondsLeft: number) => void) => () => void;
  
  // Mouse clicking
  performClick: (options: { 
    x: number; 
    y: number; 
    button?: 'left' | 'right' | 'middle'; 
    clickType?: 'single' | 'double' 
  }) => Promise<{ success: boolean; error?: string }>;
  checkRobotjs: () => Promise<{ available: boolean }>;

  // Global hotkeys
  setStartStopHotkey: (key: string) => void;
  setEmergencyStopHotkey: (key: string) => void;
  onGlobalStartStop: (callback: () => void) => () => void;
  onGlobalEmergencyStop: (callback: () => void) => () => void;
  onHotkeyError: (callback: (payload: { key: string; message: string }) => void) => () => void;

  // Clicker engine (main process)
  clickerSetConfig: (cfg: any) => Promise<{ success: boolean }>;
  clickerStart: () => Promise<{ success: boolean }>;
  clickerStop: () => Promise<{ success: boolean }>;
  clickerGetStatus: () => Promise<{ running: boolean; totalClicks: number; sessionClicks: number; positionIndex: number }>;
  onClickerStatus: (callback: (payload: any) => void) => () => void;
  onClickerStats: (callback: (payload: any) => void) => () => void;
  onClickerError: (callback: (payload: { message: string }) => void) => () => void;
  onClickerDebug?: (callback: (payload: ClickerDebugPayload) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
