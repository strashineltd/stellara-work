import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Memory, MemoryStats } from '../../../shared/ipc';
import { usePresence } from '../../hooks/usePresence';
import { captureFocusTarget, restoreFocusTarget } from '../../lib/presence-ui';
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
  { value: 'web', label: '网页' },
];

const byUpdatedDesc = (a: Memory, b: Memory) => b.updatedAt - a.updatedAt;

export function MemoryCenter() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterScope, setFilterScope] = useState<Memory['scope'] | ''>('');
  const [filterKind, setFilterKind] = useState<Memory['kind'] | ''>('');
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<{
    present: boolean;
    memory: Memory | null;
  }>({ present: false, memory: null });
  const [deletion, setDeletion] = useState<{
    present: boolean;
    memory: Memory | null;
  }>({ present: false, memory: null });
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const editorPresence = usePresence(editor.present);
  const deletePresence = usePresence(deletion.present);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorReturnFocusRef = useRef<HTMLElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const editorGenerationRef = useRef(0);
  const deleteGenerationRef = useRef(0);
  const deleteRequestGenerationRef = useRef<number | null>(null);
  const deletedMemoryIdsRef = useRef(new Set<string>());

  const fetchMemories = useCallback(async () => {
    const scope = filterScope || undefined;
    const kind = filterKind || undefined;
    const options = { scope, kind, limit: LIST_LIMIT };
    const trimmed = searchQuery.trim();
    return trimmed
      ? window.electronAPI.memory.search(trimmed, options)
      : window.electronAPI.memory.list(options);
  }, [searchQuery, filterScope, filterKind]);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchMemories();
      setMemories(result.filter((memory) => !deletedMemoryIdsRef.current.has(memory.id)));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchMemories]);

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

  function openEditor(memory: Memory | null, returnFocus?: HTMLElement | null) {
    if (editor.present || deletion.present) return;
    editorGenerationRef.current += 1;
    editorReturnFocusRef.current = captureFocusTarget(returnFocus);
    setEditor({ present: true, memory });
  }

  function closeEditor() {
    if (!editor.present) return;
    editorGenerationRef.current += 1;
    restoreFocusTarget(editorReturnFocusRef.current, searchInputRef.current);
    setEditor((current) => ({ ...current, present: false }));
  }

  function openDeletion(memory: Memory, returnFocus?: HTMLElement | null) {
    if (editor.present || deletion.present) return;
    deleteGenerationRef.current += 1;
    deleteReturnFocusRef.current = captureFocusTarget(returnFocus);
    setDeletion({ present: true, memory });
  }

  function closeDeletion() {
    if (
      !deletion.present
      || deleteRequestGenerationRef.current === deleteGenerationRef.current
    ) return;
    deleteGenerationRef.current += 1;
    restoreFocusTarget(deleteReturnFocusRef.current, searchInputRef.current);
    setDeletion((current) => ({ ...current, present: false }));
  }

  async function handleSave(data: {
    content: string;
    kind: string;
    scope: string;
    importance: number;
    tags: string[];
  }) {
    const operationGeneration = editorGenerationRef.current;
    const memory = editor.memory;
    try {
      if (memory) {
        await window.electronAPI.memory.update(memory.id, {
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
      void loadMemories();
      void loadStats();
      if (editorGenerationRef.current !== operationGeneration) return;
      restoreFocusTarget(editorReturnFocusRef.current, searchInputRef.current);
      editorGenerationRef.current += 1;
      setEditor((current) => ({ ...current, present: false }));
    } catch {
      // ignore
    }
  }

  async function confirmDelete() {
    const operationGeneration = deleteGenerationRef.current;
    const memory = deletion.memory;
    if (
      !deletion.present
      || !memory
      || deleteRequestGenerationRef.current === operationGeneration
    ) return;
    deleteRequestGenerationRef.current = operationGeneration;
    try {
      await window.electronAPI.memory.delete(memory.id);
      if (deleteGenerationRef.current !== operationGeneration) return;

      deletedMemoryIdsRef.current.add(memory.id);
      setMemories((current) => current.filter((candidate) => candidate.id !== memory.id));

      const [memoriesResult, statsResult] = await Promise.allSettled([
        fetchMemories(),
        window.electronAPI.memory.stats(),
      ]);
      if (deleteGenerationRef.current !== operationGeneration) return;

      if (memoriesResult.status === 'fulfilled') {
        setMemories(memoriesResult.value.filter(
          (candidate) => !deletedMemoryIdsRef.current.has(candidate.id),
        ));
      }
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
      restoreFocusTarget(searchInputRef.current);
      deleteGenerationRef.current += 1;
      setDeletion((current) => ({ ...current, present: false }));
    } catch {
      // ignore
    } finally {
      if (deleteRequestGenerationRef.current === operationGeneration) {
        deleteRequestGenerationRef.current = null;
      }
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
        onEdit={(selected) => openEditor(selected)}
        onDelete={(selected) => openDeletion(selected)}
        onExport={handleExport}
        onCopy={handleCopy}
        onTogglePin={handleTogglePin}
      />
    );
  }

  return (
    <div className="memory-center" data-motion="page-enter" data-page="memory">
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
            onClick={(event) => openEditor(null, event.currentTarget)}
          >
            新建记忆
          </button>
        </div>
      </header>

      <div className="memory-center__toolbar">
        <div className="memory-center__search">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
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
            onClick={(event) => openEditor(null, event.currentTarget)}
          >
            新建记忆
          </button>
        </div>
      )}

      {deletePresence.mounted && deletion.memory && (
        <MemoryDeleteDialog
          presence={deletePresence}
          memory={deletion.memory}
          onConfirm={confirmDelete}
          onClose={closeDeletion}
        />
      )}

      {editorPresence.mounted && (
        <MemoryEditDialog
          presence={editorPresence}
          memory={editor.memory ?? undefined}
          onSave={handleSave}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
