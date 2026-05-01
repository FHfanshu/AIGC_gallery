import { NeuInput, NeuTag } from '../ui';
import { useI18n, tReplace } from '../../i18n';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedTag: string | null;
  clearTag: () => void;
  imageCount: number;
}

export function Header({ searchQuery, setSearchQuery, selectedTag, clearTag, imageCount }: HeaderProps) {
  const { t } = useI18n();

  return (
    <header className="flex items-center gap-4 px-6 py-4 bg-neu-bg">
      {/* Search */}
      <div className="relative flex-1 max-w-xl">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neu-muted pointer-events-none">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <NeuInput
          placeholder={t.header.searchPlaceholder}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="!pl-11 !py-2.5 !text-sm"
        />
      </div>

      {/* Active Tag Filter */}
      {selectedTag && (
        <div className="flex items-center gap-2">
          <NeuTag name={selectedTag} active onRemove={clearTag} />
        </div>
      )}

      {/* Image Count */}
      <div className="text-sm text-neu-muted flex-shrink-0">
        {tReplace(t.header.count, { count: imageCount })}
      </div>
    </header>
  );
}
