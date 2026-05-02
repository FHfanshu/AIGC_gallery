/**
 * 侧栏底部状态栏组件
 * 常驻左下角，展示后台任务进度（导入、重解析、AI 打标、备份导出/导入）
 * 无任务时显示就绪状态
 */

import { useI18n, tReplace } from '../../i18n';
import type { AiTagFinished, AiTagProgress, BackupProgress, BackupResult, ImportProgress, ImportResult } from '../../types';

/** 单个状态项的进度信息 */
interface StatusItem {
  key: string;
  label: string;
  /** 有 done/total 时显示进度条 */
  done?: number;
  total?: number;
  /** 百分比（用于 backup 的字节进度） */
  percent?: number;
  /** 是否为完成态（显示结果后几秒自动消失） */
  finished?: boolean;
  /** 完成态的额外文本 */
  resultText?: string;
  /** 是否有错误 */
  hasError?: boolean;
}

interface StatusBarProps {
  importProgress: ImportProgress | null;
  importResult: ImportResult | null;
  reparseProgress: { done: number; total: number } | null;
  isRefreshing: boolean;
  backupProgress: BackupProgress | null;
  backupResult: BackupResult | null;
  aiTagProgress: AiTagProgress | null;
  aiTagResult: AiTagFinished | null;
}

export function StatusBar({
  importProgress, importResult,
  reparseProgress, isRefreshing,
  backupProgress, backupResult,
  aiTagProgress, aiTagResult,
}: StatusBarProps) {
  const { t } = useI18n();

  // 汇总所有活跃/完成的任务为 StatusItem 列表
  const items: StatusItem[] = [];

  // 导入
  if (importProgress) {
    const phaseLabel = importProgress.phase === 'scanning'
      ? t.status.importScanning
      : importProgress.phase === 'saving'
        ? t.status.importSaving
        : importProgress.phase === 'queued'
          ? t.status.importQueued
          : t.status.importing;
    items.push({
      key: 'import',
      label: phaseLabel,
      done: importProgress.done,
      total: importProgress.total,
    });
  } else if (importResult) {
    const errCount = importResult.errors.length;
    items.push({
      key: 'import-result',
      label: tReplace(t.status.importDone, { count: importResult.success.length }),
      finished: true,
      hasError: errCount > 0,
      resultText: errCount > 0 ? tReplace(t.status.importErrors, { count: errCount }) : undefined,
    });
  }

  // 重解析元数据
  if (isRefreshing || reparseProgress) {
    items.push({
      key: 'reparse',
      label: t.status.reparsing,
      done: reparseProgress?.done,
      total: reparseProgress?.total,
    });
  }

  // AI 打标
  if (aiTagProgress) {
    items.push({
      key: 'ai-tag',
      label: t.status.aiTagging,
      done: aiTagProgress.done,
      total: aiTagProgress.total,
    });
  } else if (aiTagResult) {
    items.push({
      key: 'ai-tag-result',
      label: aiTagResult.empty || aiTagResult.total === 0
        ? t.status.aiTagNoTargets
        : tReplace(t.status.aiTagDone, { success: aiTagResult.success, total: aiTagResult.total }),
      finished: true,
      hasError: aiTagResult.errors > 0,
      resultText: aiTagResult.errors > 0 ? tReplace(t.status.aiTagErrors, { count: aiTagResult.errors }) : undefined,
    });
  }

  // 备份进度（导出或导入）
  if (backupProgress) {
    const percent = backupProgress.total_bytes > 0
      ? Math.min(100, Math.round((backupProgress.bytes_done / backupProgress.total_bytes) * 100))
      : backupProgress.total > 0
        ? Math.min(100, Math.round((backupProgress.done / backupProgress.total) * 100))
        : 0;
    items.push({
      key: 'backup',
      label: backupProgress.current || t.status.backupWorking,
      done: backupProgress.total > 0 ? backupProgress.done : undefined,
      total: backupProgress.total > 0 ? backupProgress.total : undefined,
      percent,
    });
  } else if (backupResult) {
    items.push({
      key: 'backup-result',
      label: backupResult.message || (backupResult.success ? t.status.backupDone : t.status.backupFailed),
      finished: true,
      hasError: !backupResult.success,
    });
  }

  // 无活跃任务时显示就绪状态
  if (items.length === 0) {
    return (
      <footer className="shrink-0 flex items-center gap-1 px-2 py-[3px] min-h-[22px] bg-ink-surface border-t border-ink-line text-[10px] select-none text-ink-muted">
        <svg className="flex-shrink-0 text-ink-success" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>{t.status.idle}</span>
      </footer>
    );
  }

  return (
    <footer className="shrink-0 flex flex-col gap-[2px] px-2 py-[3px] min-h-[22px] text-[10px] select-none overflow-hidden bg-ink-surface border-t border-ink-line">
      {items.map(item => (
        <div key={item.key} className="flex items-center gap-1 min-w-0">
          {/* 旋转 spinner（活跃任务）或完成图标 */}
          {!item.finished ? (
            <svg className="animate-spin flex-shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : item.hasError ? (
            <svg className="flex-shrink-0 text-ink-danger" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : (
            <svg className="flex-shrink-0 text-ink-success" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}

          {/* 任务标签 */}
          <span className={`truncate ${item.finished && !item.hasError ? 'text-ink-muted' : 'text-ink-secondary'}`}>
            {item.label}
          </span>

          {/* 进度数字 */}
          {item.done !== undefined && item.total !== undefined && item.total > 0 && (
            <span className="text-ink-faint tabular-nums flex-shrink-0">
              {item.done}/{item.total}
            </span>
          )}

          {/* 进度条（仅在有百分比且 < 100% 时显示） */}
          {item.percent !== undefined && item.percent < 100 && (
            <div className="w-full h-1 bg-ink-line rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-ink rounded-full transition-all duration-200"
                style={{ width: `${item.percent}%` }}
              />
            </div>
          )}

          {/* 完成态额外文本（如错误数） */}
          {item.resultText && (
            <span className="text-ink-danger flex-shrink-0">{item.resultText}</span>
          )}
        </div>
      ))}
    </footer>
  );
}
