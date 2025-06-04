
import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimerControlsProps {
  isRunning: boolean;
  isPaused: boolean;
  onToggle: () => void;
  onReset: () => void;
  disabled?: boolean;
  size?: 'normal' | 'large';
  variant?: 'default' | 'outline';
}

const TimerControls: React.FC<TimerControlsProps> = ({
  isRunning,
  isPaused,
  onToggle,
  onReset,
  disabled = false,
  size = 'normal',
  variant = 'outline'
}) => {
  const iconSize = size === 'large' ? 'h-6 w-6' : 'h-4 w-4';
  const buttonSize = size === 'large' ? 'lg' : 'default';
  
  const containerClasses = cn(
    'flex items-center justify-center gap-4',
    size === 'large' ? 'gap-6' : 'gap-4'
  );

  const getToggleLabel = () => {
    if (isRunning) return 'Pausar';
    if (isPaused) return 'Reanudar';
    return 'Iniciar';
  };

  const getToggleIcon = () => {
    if (isRunning) {
      return <Pause className={iconSize} />;
    }
    return <Play className={iconSize} />;
  };

  return (
    <div className={containerClasses}>
      <Button
        onClick={onToggle}
        disabled={disabled}
        variant={variant}
        size={buttonSize}
        aria-label={getToggleLabel()}
        className={cn(
          'transition-all duration-200',
          size === 'large' && 'px-8 py-4'
        )}
      >
        {getToggleIcon()}
        {size === 'large' && (
          <span className="ml-2">{getToggleLabel()}</span>
        )}
      </Button>
      
      <Button
        onClick={onReset}
        disabled={disabled}
        variant={variant}
        size={buttonSize}
        aria-label="Reiniciar"
        className={cn(
          'transition-all duration-200',
          size === 'large' && 'px-8 py-4'
        )}
      >
        <RotateCcw className={iconSize} />
        {size === 'large' && (
          <span className="ml-2">Reiniciar</span>
        )}
      </Button>
    </div>
  );
};

export default TimerControls;
