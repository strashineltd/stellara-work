import { useState, useMemo } from 'react';
import { diffLines, type Change } from 'diff';

interface DiffCardProps {
  path: string;
  before: string | null;
  after: string;
}

/**
 * 文件变更卡片：行级 diff 视图
 * - before = null → 新建文件
 * - 改动 < 5 块 → 默认展开；多了 → 默认折叠
 * - 用 'diff' 包的 diffLines 算行级变更
 */
export function DiffCard({ path, before, after }: DiffCardProps) {
  const changes = useMemo<Change[]>(() => diffLines(before ?? '', after), [before, after]);
  const hasManyChanges = changes.length > 5;
  const [open, setOpen] = useState(!hasManyChanges);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      const lines = c.value.split('\n').filter((l) => l !== '').length;
      if (c.added) added += lines;
      else if (c.removed) removed += lines;
    }
    return { added, removed };
  }, [changes]);

  const isNew = before === null;

  return (
    <div className="tool-card tool-card-diff">
      <button
        type="button"
        className="tool-card-header"
        onClick={() => setOpen((o) => !o)}
        title={open ? '折叠' : '展开 diff'}
      >
        <span className="tool-card-icon">{isNew ? '✚' : '✎'}</span>
        <span className="tool-card-name">{path}</span>
        <span className="tool-card-summary">
          {isNew ? '新文件' : (
            <>
              <span className="diff-add">+{stats.added}</span>{' '}
              <span className="diff-remove">-{stats.removed}</span>
            </>
          )}
        </span>
        <span className="tool-card-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <pre className="diff-body">
          {changes.map((c, i) => {
            const lines = c.value.split('\n');
            // 最后一行如果是空字符串（split 末尾的 \n 产生的），去掉
            if (lines[lines.length - 1] === '') lines.pop();
            return lines.map((line, j) => (
              <div
                key={`${i}-${j}`}
                className={`diff-line ${c.added ? 'diff-added' : ''} ${c.removed ? 'diff-removed' : ''}`}
              >
                <span className="diff-sign">{c.added ? '+' : c.removed ? '-' : ' '}</span>
                <span className="diff-text">{line || ' '}</span>
              </div>
            ));
          })}
        </pre>
      )}
    </div>
  );
}
