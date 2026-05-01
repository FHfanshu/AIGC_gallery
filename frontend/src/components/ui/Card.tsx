/**
 * 卡片容器组件（NeuCard）
 * 带圆角、边框和可配置内边距的基础容器
 */
import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
  clickable?: boolean; // 是否可点击（添加 hover 效果）
  bordered?: boolean;
}

export function Card({ padding = 'md', clickable = false, bordered = true, className, children, ...props }: CardProps) {
  const paddings = { sm: 'p-3', md: 'p-5', lg: 'p-8' };

  return (
    <div
      className={cn(
        'rounded-card bg-ink-bg transition-all duration-200 ease-out',
        bordered && 'border border-ink-line',
        paddings[padding],
        clickable && 'cursor-pointer hover:border-ink-muted',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
