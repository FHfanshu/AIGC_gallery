import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface NeuTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const NeuTextarea = forwardRef<HTMLTextAreaElement, NeuTextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-neu-btn bg-neu-bg px-4 py-3 text-neu-text placeholder:text-[#A0AEC0]',
        'neu-inset transition-all duration-300 ease-out resize-none',
        'focus:neu-inset-deep focus:outline-none focus:ring-2 focus:ring-neu-accent focus:ring-offset-2 focus:ring-offset-neu-bg',
        className
      )}
      {...props}
    />
  );
});
NeuTextarea.displayName = 'NeuTextarea';
