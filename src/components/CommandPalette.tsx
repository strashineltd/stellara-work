import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelListItem, SessionSummary, ThemeName } from '../../shared/ipc';
import { Icon, type IconName } from './Icon';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: 'navigation' | 'session' | 'model' | 'theme' | 'ui';
  keywords?: string[];
  /** 返回 true 表示已处理（关闭面板），false 不关闭（少见） */
  run: () => void | boolean | Promise<void | boolean>;
}

interface CommandPaletteProps {
  onClose: () => void;
  sessions: SessionSummary[];
  modelList: ModelListItem[];
  activeSessionId: string | null;
  activeModelId: string | null;
  theme: ThemeName;
  // actions
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onSetActiveModel: (id: string) => void;
  onSetTheme: (t: ThemeName) => void;
  onOpenSettings: (tab?: string) => void;
  onOpenFileTree: () => void;
  onChangeWorkDir: () => void;
  onToggleSidebar: () => void;
  onToggleWorkspace: () => void;
  onTogglePlanMode: () => void;
  onNewTask: () => void;
}

const GROUP_ORDER: CommandItem['group'][] = ['navigation', 'session', 'model', 'theme', 'ui'];
const commandIcon = (name: IconName): IconName => name;

/** 模糊匹配：返回 -1（不匹配）或分数（越高越靠前） */
function score(item: CommandItem, q: string): number {
  if (!q) return 1;
  const lower = q.toLowerCase();
  const hay = `${item.label} ${item.hint ?? ''} ${(item.keywords ?? []).join(' ')}`.toLowerCase();
  if (!hay.includes(lower)) return -1;
  // label 开头匹配优先
  if (item.label.toLowerCase().startsWith(lower)) return 100 + hay.indexOf(lower);
  // 之后按出现位置排序
  return 50 - hay.indexOf(lower);
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // 自动 focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 构建命令列表（每次 render 都重建，因为依赖 sessions/modelList/theme）
  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      // navigation
      {
        id: 'open-settings',
        label: '打开设置',
        hint: 'Providers / Sessions / App / 快捷键',
        icon: commandIcon('settings'),
        group: 'navigation',
        keywords: ['settings', 'preferences', '配置'],
        run: () => { props.onOpenSettings(); },
      },
      {
        id: 'manage-skills',
        label: '管理 skills',
        hint: '查看 / 重新加载 workDir 下的 skill 文件',
        icon: commandIcon('tool'),
        group: 'navigation',
        keywords: ['skills', 'manage', 'reload'],
        run: () => { props.onOpenSettings('skills'); },
      },
      {
        id: 'open-file-tree',
        label: '打开文件树',
        hint: '浏览工作目录的文件',
        icon: commandIcon('file-tree'),
        group: 'navigation',
        keywords: ['files', 'tree', 'browse', '目录'],
        run: () => { props.onOpenFileTree(); },
      },
      {
        id: 'change-workdir',
        label: '切换工作目录',
        hint: '打开原生目录选择器',
        icon: commandIcon('folder'),
        group: 'navigation',
        keywords: ['workdir', 'folder', '工作目录'],
        run: () => { props.onChangeWorkDir(); },
      },
      // session
      {
        id: 'new-session',
        label: '新建会话',
        icon: commandIcon('plus'),
        group: 'session',
        keywords: ['new', 'create', '会话'],
        run: () => { props.onNewSession(); },
      },
      {
        id: 'new-task',
        label: '新任务（清空当前聊天）',
        icon: commandIcon('file'),
        group: 'session',
        keywords: ['clear', 'reset', '清空'],
        run: () => { props.onNewTask(); },
      },
      ...props.sessions.slice(0, 10).map<CommandItem>((s) => ({
        id: `session-${s.id}`,
        label: `切换到：${s.title}`,
        hint: `${s.messageCount} 条消息 · ${new Date(s.updatedAt).toLocaleString()}`,
        icon: commandIcon('file'),
        group: 'session',
        keywords: ['switch', 'session', 'go to', '切到'],
        run: () => { props.onSelectSession(s.id); },
      })),
      ...(props.activeSessionId ? [{
        id: 'delete-current-session',
        label: '删除当前会话',
        hint: '不可恢复',
        icon: commandIcon('x'),
        group: 'session' as const,
        keywords: ['delete', 'remove', '删除'],
        run: () => {
          if (confirm('删除当前会话？')) props.onDeleteSession(props.activeSessionId!);
        },
      }] : []),
      // model
      ...props.modelList.map<CommandItem>((m) => ({
        id: `model-${m.id}`,
        label: `切到 model：${m.label}`,
        hint: m.hasKey ? `${m.baseUrl} · ${m.model}` : '未配置 API key',
        icon: commandIcon(m.isActive ? 'check' : 'refresh'),
        group: 'model',
        keywords: ['switch', 'model', '切换', '模型'],
        run: () => { void props.onSetActiveModel(m.id); },
      })),
      {
        id: 'add-model',
        label: '添加新模型',
        icon: commandIcon('plus'),
        group: 'model',
        keywords: ['new', 'create', '添加', 'provider'],
        run: () => { props.onOpenSettings(); },
      },
      // theme
      {
        id: 'theme-dark',
        label: '主题：深色',
        icon: commandIcon('moon'),
        group: 'theme',
        keywords: ['theme', 'dark', '主题', '深色', '暗色'],
        run: () => { props.onSetTheme('dark'); },
      },
      {
        id: 'theme-light',
        label: '主题：浅色',
        icon: commandIcon('sun'),
        group: 'theme',
        keywords: ['theme', 'light', '主题', '浅色', '亮色'],
        run: () => { props.onSetTheme('light'); },
      },
      {
        id: 'theme-system',
        label: '主题：跟随系统',
        icon: commandIcon('monitor'),
        group: 'theme',
        keywords: ['theme', 'system', 'auto', '跟随'],
        run: () => { props.onSetTheme('system'); },
      },
      // ui
      {
        id: 'toggle-sidebar',
        label: '切换左侧会话栏',
        icon: commandIcon('panel-left'),
        group: 'ui',
        keywords: ['sidebar', 'toggle', '侧栏'],
        run: () => { props.onToggleSidebar(); },
      },
      {
        id: 'toggle-workspace',
        label: '切换右侧工作区',
        icon: commandIcon('panel-right'),
        group: 'ui',
        keywords: ['workspace', 'panel', '工作区'],
        run: () => { props.onToggleWorkspace(); },
      },
      {
        id: 'toggle-plan-mode',
        label: '切换 Plan 模式',
        hint: '只读分析，不修改文件，先输出执行计划',
        icon: commandIcon('file'),
        group: 'ui',
        keywords: ['plan', 'read only', '计划'],
        run: () => { props.onTogglePlanMode(); },
      },
    ];
    return items;
  }, [props]);

  // 过滤 + 排序
  const filtered = useMemo(() => {
    if (!query) return allCommands;
    return allCommands
      .map((c) => ({ c, s: score(c, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [allCommands, query]);

  // 选中项 clamp
  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(0);
  }, [filtered.length, selectedIdx]);

  // 滚动到选中项
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  async function runItem(item: CommandItem) {
    const result = await item.run();
    if (result !== false) props.onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIdx];
      if (item) void runItem(item);
    }
  }

  // 按 group 分组
  const grouped = useMemo(() => {
    const map = new Map<CommandItem['group'], CommandItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const item of filtered) {
      map.get(item.group)!.push(item);
    }
    return map;
  }, [filtered]);

  // 索引 → 在 flat filtered 里的位置（用于高亮）
  const itemGlobalIdx = (group: CommandItem['group'], i: number) => {
    let n = 0;
    for (const g of GROUP_ORDER) {
      if (g === group) return n + i;
      n += mapSize(grouped, g);
    }
    return n + i;
  };
  function mapSize<T>(m: Map<T, unknown[]>, k: T): number {
    return m.get(k)?.length ?? 0;
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="搜索命令，例如「主题」「新建任务」「切换模型」"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={onKeyDown}
        />
        <ul ref={listRef} className="command-palette-list">
          {filtered.length === 0 && (
            <li className="command-palette-empty">无匹配命令</li>
          )}
          {GROUP_ORDER.map((g) => {
            const items = grouped.get(g) ?? [];
            if (items.length === 0) return null;
            const groupLabel = { navigation: '导航', session: '会话', model: '模型', theme: '主题', ui: '界面' }[g];
            return (
              <li key={g} className="command-palette-group">
                <div className="command-palette-group-label">{groupLabel}</div>
                <ul>
                  {items.map((item, i) => {
                    const globalIdx = itemGlobalIdx(g, i);
                    const isSelected = globalIdx === selectedIdx;
                    return (
                      <li
                        key={item.id}
                        className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                        onMouseEnter={() => setSelectedIdx(globalIdx)}
                        onClick={() => void runItem(item)}
                      >
                        <span className="command-palette-icon"><Icon name={item.icon} size={15} /></span>
                        <div className="command-palette-text">
                          <div className="command-palette-label">{item.label}</div>
                          {item.hint && <div className="command-palette-hint">{item.hint}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        <div className="command-palette-footer">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
          <span className="command-palette-count">{filtered.length} 条命令</span>
        </div>
      </div>
    </div>
  );
}
