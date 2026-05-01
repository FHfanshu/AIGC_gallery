/**
 * 输入框组件（NeuInput）
 * 支持 forwardRef 的受控输入框，带圆角边框和焦点样式
 */
import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-btn bg-ink-bg px-3 py-2 text-ink text-sm border border-ink-line',
        'placeholder:text-ink-faint transition-colors duration-150',
        'focus-ring focus:border-ink-muted',
        className
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';
