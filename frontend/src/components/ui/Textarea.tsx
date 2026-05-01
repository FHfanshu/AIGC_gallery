/**
 * 文本域组件（NeuTextarea）
 * 支持 forwardRef 的多行文本输入，样式与 Input 保持一致
 */
import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-btn bg-ink-bg px-3 py-2 text-ink text-sm border border-ink-line',
        'placeholder:text-ink-faint transition-colors duration-150 resize-none',
        'focus-ring focus:border-ink-muted',
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';
