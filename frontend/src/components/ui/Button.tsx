/**
 * 按钮组件（NeuButton）
 * 支持多种变体（primary/secondary/ghost/danger/icon）和尺寸（sm/md/lg）
 */
import { type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'secondary', size = 'md', className, children, ...props }: ButtonProps) {
  const base = 'rounded-btn transition-all duration-200 ease-out font-body font-medium cursor-pointer select-none focus-ring';

  const sizes = {
    sm: 'px-3 py-1.5 text-sm min-h-[32px]',
    md: 'px-5 py-2 text-base min-h-[38px]',
    lg: 'px-6 py-2.5 text-lg min-h-[44px]',
  };

  const variants = {
    primary: 'bg-ink text-white hover:bg-ink/90 active:bg-ink/80',
    secondary: 'bg-ink-bg text-ink border border-ink-line hover:border-ink-muted hover:text-ink active:bg-ink-surface',
    ghost: 'bg-transparent text-ink-muted hover:text-ink hover:bg-ink-surface',
    danger: 'bg-ink-danger text-white hover:bg-ink-danger/90 active:bg-ink-danger/80',
    icon: 'bg-transparent text-ink-muted hover:text-ink !rounded-full !p-0 flex items-center justify-center',
  };

  const iconSizes = { sm: 'w-7 h-7', md: 'w-9 h-9', lg: 'w-11 h-11' }; // icon变体专用尺寸

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
