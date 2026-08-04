import { useEffect, useState } from "react";

interface ClickRipple {
  id: number;
  x: number;
  y: number;
}

interface ClickAnimationProps {
  isActive: boolean;
  currentPosition: { x: number; y: number; id?: string; label?: string } | null;
}

const ClickAnimation = ({ isActive, currentPosition }: ClickAnimationProps) => {
  const [ripples, setRipples] = useState<ClickRipple[]>([]);

  useEffect(() => {
    if (!isActive || !currentPosition) return;

    const interval = setInterval(() => {
      const id = Date.now();
      setRipples(prev => [...prev, { id, x: currentPosition.x, y: currentPosition.y }]);
      
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 600);
    }, 200);

    return () => clearInterval(interval);
  }, [isActive, currentPosition]);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {ripples.map(ripple => (
        <div
          key={ripple.id}
          className="absolute w-4 h-4 rounded-full bg-primary/30 animate-click-ripple"
          style={{
            left: `${(ripple.x / 1920) * 100}%`,
            top: `${(ripple.y / 1080) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
};

export default ClickAnimation;
