import { cn } from '../../lib/utils';

interface NeuTagProps {
  name: string;
  color?: string;
  active?: boolean;
  count?: number;
  onToggle?: () => void;
  onRemove?: () => void;
}

export function NeuTag({ name, color = '#6C63FF', active = false, count, onToggle, onRemove }: NeuTagProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-300 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-neu-accent focus:ring-offset-1 focus:ring-offset-neu-bg',
        active
          ? 'neu-inset-sm text-neu-accent'
          : 'neu-raised-sm text-neu-muted hover:text-neu-text hover:-translate-y-[1px]'
      )}
    >
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span>{name}</span>
      {count !== undefined && (
        <span className="text-xs opacity-60">{count}</span>
      )}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 opacity-40 hover:opacity-100 cursor-pointer"
        >
          ×
        </span>
      )}
    </button>
  );
}
