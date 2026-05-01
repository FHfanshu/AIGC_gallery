import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface NeuInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const NeuInput = forwardRef<HTMLInputElement, NeuInputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-neu-btn bg-neu-bg px-4 py-3 text-neu-text placeholder:text-[#A0AEC0]',
        'neu-inset transition-all duration-300 ease-out',
        'focus:neu-inset-deep focus:outline-none focus:ring-2 focus:ring-neu-accent focus:ring-offset-2 focus:ring-offset-neu-bg',
        className
      )}
      {...props}
    />
  );
});
NeuInput.displayName = 'NeuInput';
