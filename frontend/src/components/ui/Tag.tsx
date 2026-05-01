/**
 * 标签组件（NeuTag）
 * 可交互的标签元素，支持颜色圆点、数量显示、切换和移除操作
 */
import { cn } from '../../lib/utils';

interface TagProps {
  name: string;
  color?: string; // 左侧圆点颜色
  active?: boolean; // 是否激活态
  count?: number; // 显示数量
  onToggle?: () => void; // 切换回调
  onRemove?: () => void; // 移除回调
}

export function Tag({ name, color = '#1A1A1A', active = false, count, onToggle, onRemove }: TagProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-xs font-medium transition-all duration-150',
        'focus-ring',
        active
          ? 'bg-ink text-white' // 激活态：黑底白字
          : 'bg-ink-surface text-ink-secondary border border-ink-line hover:border-ink-muted hover:text-ink'
      )}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? '#fff' : color }} /> {/* 颜色标识圆点 */}
      <span>{name}</span>
      {count !== undefined && (
        <span className={cn('text-[10px]', active ? 'opacity-70' : 'opacity-50')}>{count}</span>
      )}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-40 hover:opacity-100 cursor-pointer"
        >
          ×
        </span>
      )}
    </button>
  );
}
