import { type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'icon';
  size?: 'sm' | 'md' | 'lg';
}

export function NeuButton({ variant = 'secondary', size = 'md', className, children, ...props }: NeuButtonProps) {
  const base = 'rounded-neu-btn transition-all duration-300 ease-out font-body font-medium cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-neu-accent focus:ring-offset-2 focus:ring-offset-neu-bg';
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm min-h-[36px]',
    md: 'px-5 py-2.5 text-base min-h-[44px]',
    lg: 'px-7 py-3 text-lg min-h-[52px]',
  };

  const variants = {
    primary: 'bg-neu-accent text-white neu-raised hover:-translate-y-[1px] hover:neu-raised-hover active:translate-y-[0.5px] active:neu-inset-sm',
    secondary: 'bg-neu-bg text-neu-text neu-raised hover:-translate-y-[1px] hover:neu-raised-hover active:translate-y-[0.5px] active:neu-inset-sm',
    danger: 'bg-neu-danger text-white neu-raised hover:-translate-y-[1px] hover:neu-raised-hover active:translate-y-[0.5px] active:neu-inset-sm',
    icon: 'bg-neu-bg text-neu-muted neu-raised-sm hover:-translate-y-[1px] hover:neu-raised active:translate-y-[0.5px] active:neu-inset-sm !rounded-full !p-0 flex items-center justify-center',
  };

  const iconSizes = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-12 h-12' };

  return (
    <button
      className={cn(
        base,
        sizes[size],
        variants[variant],
        variant === 'icon' && iconSizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
