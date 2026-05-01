import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface NeuCardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
  clickable?: boolean;
}

export function NeuCard({ padding = 'md', clickable = false, className, children, ...props }: NeuCardProps) {
  const paddings = { sm: 'p-4', md: 'p-6', lg: 'p-8' };
  
  return (
    <div
      className={cn(
        'rounded-neu-card bg-neu-bg neu-raised transition-all duration-300 ease-out',
        paddings[padding],
        clickable && 'cursor-pointer hover:-translate-y-[2px] hover:neu-raised-hover',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
