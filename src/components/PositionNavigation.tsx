
import React from 'react';
import { Button } from '@/components/ui/button';
import { CategoryConfig, PositionType } from '@/types/chronometer';
import { cn } from '@/lib/utils';

interface PositionNavigationProps {
  activeCategory: CategoryConfig | null;
  activePositionType: PositionType | null;
  onSelectPosition: (position: PositionType) => void;
  className?: string;
}

const PositionNavigation: React.FC<PositionNavigationProps> = ({
  activeCategory,
  activePositionType,
  onSelectPosition,
  className,
}) => {
  if (!activeCategory) return null;

  const positions: { type: PositionType; label: string; colorClass: string }[] = [
    { type: 'favor', label: 'A favor', colorClass: 'bg-green-500 hover:bg-green-600' },
    { type: 'contra', label: 'En contra', colorClass: 'bg-red-500 hover:bg-red-600' },
  ];

  return (
    <div className={cn("flex justify-center space-x-2 my-3", className)}>
      {positions.map((pos) => (
        <Button
          key={pos.type}
          variant={activePositionType === pos.type ? 'default' : 'outline'}
          className={cn(
            "text-white",
            activePositionType === pos.type ? (pos.type === 'favor' ? 'bg-green-700' : 'bg-red-700') : pos.colorClass
          )}
          onClick={() => onSelectPosition(pos.type)}
        >
          {pos.label}
        </Button>
      ))}
    </div>
  );
};

export default PositionNavigation;
