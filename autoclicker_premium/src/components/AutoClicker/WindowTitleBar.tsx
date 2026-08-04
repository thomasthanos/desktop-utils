import { Minus, Square, X, Mouse, Settings } from "lucide-react";

interface WindowTitleBarProps {
  onOpenSettings?: () => void;
}

const WindowTitleBar = ({ onOpenSettings }: WindowTitleBarProps) => {
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  const handleMinimize = () => {
    if (isElectron) {
      window.electronAPI?.minimizeWindow();
    }
  };

  const handleMaximize = () => {
    if (isElectron) {
      window.electronAPI?.maximizeWindow();
    }
  };

  const handleClose = () => {
    if (isElectron) {
      window.electronAPI?.closeWindow();
    }
  };

  return (
    <div className="window-title-bar border-b border-border/50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <Mouse className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground">AutoClicker Pro</h1>
          <p className="text-[10px] text-muted-foreground">Windows 11 Edition</p>
        </div>
      </div>
      
      <div className="flex items-center">
        {/* Settings Button */}
        <button 
          className="window-control" 
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </button>
        <button className="window-control" onClick={handleMinimize}>
          <Minus className="w-4 h-4 text-muted-foreground" />
        </button>
        <button className="window-control" onClick={handleMaximize}>
          <Square className="w-3 h-3 text-muted-foreground" />
        </button>
        <button className="window-control close" onClick={handleClose}>
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default WindowTitleBar;
