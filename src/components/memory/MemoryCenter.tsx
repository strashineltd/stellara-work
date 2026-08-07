import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Memory, MemoryStats } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { MemoryCard, PIN_THRESHOLD } from './MemoryCard';
import { MemoryDeleteDialog } from './MemoryDeleteDialog';
import { MemoryEditDialog } from './MemoryEditDialog';

const LIST_LIMIT = 1000;

const SCOPE_CHIPS: Array<{ value: Memory['scope'] | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'personal', label: '个人' },
  { value: 'project', label: '项目' },
  { value: 'workspace', label: '企业' },
];

const KIND_OPTIONS: Array<{ value: Memory['kind']; label: string }> = [
  { value: 'fact', label: '事实' },
  { value: 'preference', label: '偏好' },
  { value: 'decision', label: '决策' },
  { value: 'codebase', label: '代码库' },
  { value: 'requirement', label: '需求' },
  { value: 'meeting', label: '会议' },
];

const byUpdatedDesc = (a: Memory, b: Memory) => b.updatedAt - a.updatedAt;

export function MemoryCenter() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterScope, setFilterScope] = useState<Memory['scope'] | ''>('');
  const [filterKind, setFilterKind] = useState<Memory['kind'] | ''>('');
  const [loading, setLoading] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const scope = filterScope || undefined;
      const kind = filterKind || undefined;
      const options = { scope, kind, limit: LIST_LIMIT };
      const trimmed = searchQuery.trim();
      const result = trimmed
        ? await window.electronAPI.memory.search(trimmed, options)
        : await window.electronAPI.memory.list(options);
      setMemories(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterScope, filterKind]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await window.electronAPI.memory.stats());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadMemories();
    void loadStats();
  }, [loadMemories, loadStats]);

  useEffect(() => {
    let alive = true;
    window.electronAPI.projects
      .list()
      .then((list) => {
        if (!alive) return;
        const names: Record<string, string> = {};
        for (const p of list) names[p.id] = p.name;
        setProjectNames(names);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      alive = false;
    };
  }, []);

  const pinned = useMemo(
    () => memories.filter((m) => m.importance >= PIN_THRESHOLD).sort(byUpdatedDesc),
    [memories],
  );
  const recent = useMemo(
    () => memories.filter((m) => m.importance < PIN_THRESHOLD).sort(byUpdatedDesc),
    [memories],
  );

  const chipCount = (scope: Memory['scope'] | ''): number => {
    if (!stats) return 0;
    if (scope === '') return stats.total;
    return stats.byScope[scope] ?? 0;
  };

  function scopeLabelOf(memory: Memory): string | undefined {
    if (memory.scope !== 'project') return undefined;
    return memory.scopeId ? projectNames[memory.scopeId] : undefined;
  }

  async function handleSave(data: {
    content: string;
    kind: string;
    scope: string;
    importance: number;
    tags: string[];
  }) {
    try {
      if (editingMemory) {
        await window.electronAPI.memory.update(editingMemory.id, {
          content: data.content,
          importance: data.importance,
          tags: data.tags,
        });
      } else {
        await window.electronAPI.memory.save({
          scope: data.scope as Memory['scope'],
          kind: data.kind as Memory['kind'],
          content: data.content,
          source: 'manual',
          importance: data.importance,
          confidence: 1.0,
          tags: data.tags,
        });
      }
      setEditingMemory(null);
      setShowCreateDialog(false);
      void loadMemories();
      void loadStats();
    } catch {
      // ignore
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await window.electronAPI.memory.delete(pendingDelete.id);
      setPendingDelete(null);
      void loadMemories();
      void loadStats();
    } catch {
      // ignore
    }
  }

  async function handleTogglePin(memory: Memory) {
    const isPinned = memory.importance >= PIN_THRESHOLD;
    try {
      await window.electronAPI.memory.update(memory.id, {
        importance: isPinned ? 0.5 : 0.9,
      });
      void loadMemories();
    } catch {
      // ignore
    }
  }

  async function handleExport(memory: Memory) {
    try {
      await window.electronAPI.memory.exportSingle(memory.id);
    } catch {
      // ignore
    }
  }

  async function handleCopy(memory: Memory) {
    try {
      const md = await window.electronAPI.memory.copyMd(memory.id);
      await navigator.clipboard.writeText(md);
    } catch {
      // ignore
    }
  }

  async function handleExportAll() {
    try {
      await window.electronAPI.memory.exportAll();
    } catch {
      // ignore
    }
  }

  function renderCard(memory: Memory) {
    return (
      <MemoryCard
        key={memory.id}
        memory={memory}
        scopeLabel={scopeLabelOf(memory)}
        onEdit={setEditingMemory}
        onDelete={setPendingDelete}
        onExport={handleExport}
        onCopy={handleCopy}
        onTogglePin={handleTogglePin}
      />
    );
  }

  return (
    <div className="memory-center">
      <header className="memory-center__header">
        <div>
          <h1>记忆</h1>
          <p className="memory-center__sub">
            Agent 会自动沉淀任务要点；你也可以手动记录，任务中会被自动检索
          </p>
        </div>
        <div className="memory-center__header-actions">
          <button className="btn btn-ghost" type="button" onClick={handleExportAll}>
            导出全部
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setShowCreateDialog(true)}
          >
            新建记忆
          </button>
        </div>
      </header>

      <div className="memory-center__toolbar">
        <div className="memory-center__search">
          <Icon name="search" size={14} />
          <input
            className="memory-center__search-input"
            type="text"
            placeholder="搜索记忆内容、标签…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="memory-center__select"
          aria-label="按类型筛选"
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as Memory['kind'] | '')}
        >
          <option value="">全部类型</option>
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="memory-center__select"
          aria-label="按作用域筛选"
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value as Memory['scope'] | '')}
        >
          <option value="">全部作用域</option>
          {SCOPE_CHIPS.slice(1).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="memory-chips">
        {SCOPE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`memory-chip${filterScope === chip.value ? ' memory-chip--active' : ''}`}
            onClick={() => setFilterScope(chip.value)}
          >
            {chip.label}
            <span className="memory-chip__count">{chipCount(chip.value)}</span>
          </button>
        ))}
      </div>

      {loading && <p>加载中...</p>}

      {!loading && memories.length > 0 && (
        <>
          {pinned.length > 0 && (
            <section className="memory-section">
              <h2 className="memory-section__label">
                <span className="memory-section__star">★</span>重要记忆
                <span className="memory-section__count">{pinned.length}</span>
              </h2>
              {pinned.map(renderCard)}
            </section>
          )}
          {recent.length > 0 && (
            <section className="memory-section">
              <h2 className="memory-section__label">
                最近记忆
                <span className="memory-section__count">{recent.length}</span>
              </h2>
              {recent.map(renderCard)}
            </section>
          )}
        </>
      )}

      {!loading && memories.length === 0 && (
        <div className="memory-empty">
          <div className="memory-empty__art">
            <Icon name="database" size={30} />
          </div>
          <h3>还没有记忆</h3>
          <p>Agent 会在任务中自动沉淀要点，你也可以手动记录</p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setShowCreateDialog(true)}
          >
            新建记忆
          </button>
        </div>
      )}

      {pendingDelete && (
        <MemoryDeleteDialog
          memory={pendingDelete}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {(showCreateDialog || editingMemory) && (
        <MemoryEditDialog
          memory={editingMemory ?? undefined}
          onSave={handleSave}
          onClose={() => {
            setEditingMemory(null);
            setShowCreateDialog(false);
          }}
        />
      )}
    </div>
  );
}
