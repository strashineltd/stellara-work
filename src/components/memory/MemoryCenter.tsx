import { useState, useEffect, useCallback } from 'react';
import type { Memory, MemoryStats } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { MemoryCard } from './MemoryCard';
import { MemoryEditDialog } from './MemoryEditDialog';

export function MemoryCenter() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterScope, setFilterScope] = useState<string>('');
  const [filterKind, setFilterKind] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const scope = filterScope || undefined;
      const kind = filterKind || undefined;
      let result: Memory[];
      if (searchQuery.trim()) {
        result = await window.electronAPI.memory.search(searchQuery, { scope, kind, limit: 50 });
      } else {
        result = await window.electronAPI.memory.list({ scope, kind, limit: 50 });
      }
      setMemories(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterScope, filterKind]);

  const loadStats = useCallback(async () => {
    try {
      const s = await window.electronAPI.memory.stats();
      setStats(s);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadMemories();
    void loadStats();
  }, [loadMemories, loadStats]);

  async function handleSave(data: { content: string; kind: string; scope: string; importance: number; tags: string[] }) {
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

  async function handleDelete(id: string) {
    try {
      await window.electronAPI.memory.delete(id);
      void loadMemories();
      void loadStats();
    } catch {
      // ignore
    }
  }

  return (
    <div className="memory-center">
      <div className="memory-center__header">
        <h1 className="memory-center__title">记忆中心</h1>
        <button
          className="memory-center__create-btn"
          type="button"
          onClick={() => setShowCreateDialog(true)}
        >
          <Icon name="plus" size={14} />
          <span>新建记忆</span>
        </button>
      </div>

      <div className="memory-center__filters">
        <div className="memory-center__search">
          <Icon name="search" size={14} />
          <input
            className="memory-center__search-input"
            type="text"
            placeholder="搜索记忆..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="memory-center__filter-select"
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value)}
          aria-label="按作用域筛选"
        >
          <option value="">全部作用域</option>
          <option value="personal">个人</option>
          <option value="project">项目</option>
          <option value="workspace">企业</option>
        </select>
        <select
          className="memory-center__filter-select"
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          aria-label="按类型筛选"
        >
          <option value="">全部类型</option>
          <option value="fact">事实</option>
          <option value="preference">偏好</option>
          <option value="decision">决策</option>
          <option value="codebase">代码库</option>
          <option value="requirement">需求</option>
          <option value="meeting">会议</option>
        </select>
      </div>

      {stats && (
        <div className="memory-center__stats">
          <div className="memory-center__stat">
            <span className="memory-center__stat-value">{stats.total}</span>
            <span className="memory-center__stat-label">总计</span>
          </div>
          <div className="memory-center__stat">
            <span className="memory-center__stat-value">{stats.byScope['personal'] ?? 0}</span>
            <span className="memory-center__stat-label">个人</span>
          </div>
          <div className="memory-center__stat">
            <span className="memory-center__stat-value">{stats.byScope['project'] ?? 0}</span>
            <span className="memory-center__stat-label">项目</span>
          </div>
          <div className="memory-center__stat">
            <span className="memory-center__stat-value">{stats.recentCount}</span>
            <span className="memory-center__stat-label">近7天</span>
          </div>
        </div>
      )}

      <div className="memory-center__list">
        {loading && <p className="memory-center__loading">加载中...</p>}
        {!loading && memories.length === 0 && (
          <p className="memory-center__empty">暂无记忆</p>
        )}
        {!loading && memories.map((m) => (
          <MemoryCard
            key={m.id}
            memory={m}
            onEdit={setEditingMemory}
            onDelete={handleDelete}
          />
        ))}
      </div>

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
