import { MapPin, X, MousePointer } from "lucide-react";

interface Position {
  id: number;
  x: number;
  y: number;
  label: string;
}

interface PositionItemProps {
  position: Position;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
  index: number;
}

const PositionItem = ({ position, isActive, onClick, onRemove, index }: PositionItemProps) => {
  return (
    <div
      className={`position-item animate-slide-in-right ${isActive ? "active" : ""}`}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}>
          {isActive ? (
            <MousePointer className="w-4 h-4" />
          ) : (
            <MapPin className="w-4 h-4" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{position.label}</p>
          <p className="text-xs text-muted-foreground">
            X: {position.x} • Y: {position.y}
          </p>
        </div>
      </div>
      
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default PositionItem;
