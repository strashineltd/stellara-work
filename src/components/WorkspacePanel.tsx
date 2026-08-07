import { useCallback, useEffect, useRef, useState } from 'react';
import type { FsNode } from '../../shared/ipc';
import { FileTreeNode } from './FileTreeNode';
import { Icon } from './Icon';

/**
 * 右侧工作区 sidebar（4 个垂直堆叠区域）：
 * - 目标：plan 步骤 或 首条 user 消息
 * - 进度：tool_call 总数 / 已完成 / 当前在跑
 * - 交付物：本次会话 write_file / edit_file 产物
 * - 文件：workDir 文件树 + 当前任务修改过的文件标记
 *
 * 数据由父组件 (MainView) 算好传过来；本组件只渲染。
 */

export type Goal =
  | { kind: 'plan'; steps: string[] }
  | { kind: 'userMessage'; content: string };

export interface Progress {
  completed: number;
  total: number;
  currentName?: string;
  /** Plan 模式：用 step 完成数而非 tool_call 数 */
  stepMode?: { doneCount: number; totalSteps: number };
}

export interface Deliverable {
  path: string;
  kind: 'write' | 'edit';
  ts: number;
}

export interface MemoryContextItem {
  kind: string;
  content: string;
  importance: number;
  source?: string;
}

interface WorkspacePanelProps {
  workDir: string;
  goal: Goal | null;
  progress: Progress;
  deliverables: Deliverable[];
  touchedFiles: Set<string>;
  stepStatus?: Record<number, 'pending' | 'done' | 'failed'>;
  onStepToggle?: (index: number) => void;
  initialWidth?: number;
  onWidthChange?: (w: number) => void;
  memoryContext?: MemoryContextItem[];
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 280;

export function WorkspacePanel({
  workDir, goal, progress, deliverables, touchedFiles,
  stepStatus, onStepToggle, initialWidth, onWidthChange, memoryContext,
}: WorkspacePanelProps) {
  const [width, setWidth] = useState(initialWidth ?? DEFAULT_WIDTH);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX; // 向左拖 = 增大宽度
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + dx));
      setWidth(w);
      onWidthChange?.(w);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onWidthChange]);

  return (
    <aside id="workspace-panel" className="workspace-panel" ref={panelRef} style={{ width }} aria-label="任务详情">
      <div
        className="workspace-resize-handle"
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const delta = e.key === 'ArrowLeft' ? 16 : -16;
          const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta));
          setWidth(next);
          onWidthChange?.(next);
        }}
        role="separator"
        aria-label="调整任务详情宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
      />
      <div className="workspace-panel-header">
        <span className="workspace-panel-kicker">检查器</span>
        <strong>任务详情</strong>
      </div>
      <GoalSection goal={goal} stepStatus={stepStatus} onStepToggle={onStepToggle} />
      <ProgressSection progress={progress} goal={goal} stepStatus={stepStatus} />
      <DeliverablesSection deliverables={deliverables} />
      <MemoryInjectSection memoryContext={memoryContext} />
      <FileSection workDir={workDir} touchedFiles={touchedFiles} />
    </aside>
  );
}

// ============================================
// 子组件
// ============================================

function GoalSection({
  goal,
  stepStatus,
  onStepToggle,
}: {
  goal: Goal | null;
  stepStatus?: Record<number, 'pending' | 'done' | 'failed'>;
  onStepToggle?: (index: number) => void;
}) {
  return (
    <details className="workspace-section" open>
      <summary className="workspace-section-header">
        <span>目标</span>
      </summary>
      {!goal && <div className="empty-hint">还没发起任务</div>}
      {goal?.kind === 'plan' && (
        <ol className="goal-steps">
          {goal.steps.map((step, i) => {
            const s = stepStatus?.[i] ?? 'pending';
            return (
              <li
                key={i}
                className={`goal-step-item ${s}`}
                onClick={() => onStepToggle?.(i)}
                onKeyDown={(event) => {
                  if (!onStepToggle || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  onStepToggle(i);
                }}
                role={onStepToggle ? 'button' : undefined}
                tabIndex={onStepToggle ? 0 : undefined}
                aria-label={onStepToggle ? `切换步骤 ${i + 1} 状态，当前为${s === 'done' ? '完成' : s === 'failed' ? '失败' : '待做'}` : undefined}
                title={onStepToggle ? '切换状态：待做 → 完成 → 失败' : undefined}
              >
                <span className="goal-step-num">{i + 1}</span>
                <span className="goal-step-text">{step}</span>
                <span className="goal-step-badge" aria-hidden="true">
                  {s === 'done' && <Icon name="check" size={13} />}
                  {s === 'failed' && <Icon name="alert" size={13} />}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {goal?.kind === 'userMessage' && (
        <div className="goal-text">{goal.content}</div>
      )}
    </details>
  );
}

function ProgressSection({
  progress,
  goal,
  stepStatus,
}: {
  progress: Progress;
  goal: Goal | null;
  stepStatus?: Record<number, 'pending' | 'done' | 'failed'>;
}) {
  const isPlan = goal?.kind === 'plan' && stepStatus;
  const doneCount = isPlan ? Object.values(stepStatus).filter((s) => s === 'done').length : progress.completed;
  const total = isPlan ? Object.keys(stepStatus).length : progress.total;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <details className="workspace-section" open>
      <summary className="workspace-section-header">
        <span>进度</span>
      </summary>
      {total > 0 && (
        <div className="progress-bar-wrap">
          <div
            className="progress-meter"
            role="progressbar"
            aria-label="任务进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-bar-text">{pct}%</span>
        </div>
      )}
      <div className="progress-summary">
        {isPlan
          ? `步骤 ${doneCount} / ${total}`
          : `已完成 ${progress.completed} / ${progress.total} 项操作`}
      </div>
      {progress.currentName && (
        <div className="progress-current">{progress.currentName}</div>
      )}
      {total === 0 && (
        <div className="empty-hint">任务开始后会显示进度</div>
      )}
    </details>
  );
}

function DeliverablesSection({ deliverables }: { deliverables: Deliverable[] }) {
  return (
    <details className="workspace-section" open>
      <summary className="workspace-section-header">
        <span>交付物 ({deliverables.length})</span>
      </summary>
      {deliverables.length === 0 && <div className="empty-hint">还没有写过的文件</div>}
      {deliverables.map((d, i) => (
        <div key={`${d.path}-${i}`} className="deliverable-item" title={d.path}>
          <span className="deliverable-icon" aria-hidden="true">
            <Icon name={d.kind === 'write' ? 'file' : 'edit'} size={13} />
          </span>
          <span className="deliverable-path">{d.path}</span>
        </div>
      ))}
    </details>
  );
}

function MemoryInjectSection({ memoryContext }: { memoryContext?: MemoryContextItem[] }) {
  if (!memoryContext || memoryContext.length === 0) return null;
  return (
    <details className="workspace-section" open>
      <summary className="workspace-section-header">
        <span>本次记忆</span>
      </summary>
      <ul className="memory-inject-list">
        {memoryContext.map((m, i) => (
          <li key={i} className="memory-inject-item" title={m.content}>
            <span className="memory-inject-kind">{m.kind}</span>
            <span className="memory-inject-content">{m.content}</span>
            {m.importance >= 0.8 && <span className="memory-inject-star">★</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FileSection({ workDir, touchedFiles }: { workDir: string; touchedFiles: Set<string> }) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([workDir]));
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    // 浅层 4 层：避免巨大仓库一次拉太多
    window.electronAPI.fs.listTree(workDir, 3)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((e) => { if (!cancelled) setTreeError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [workDir]);

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  /** Files touched by the current task receive a compact marker. */
  function badge(node: FsNode): string | undefined {
    if (node.type === 'dir') return undefined;
    return touchedFiles.has(node.path) ? '*' : undefined;
  }

  return (
    <details className="workspace-section" open>
      <summary className="workspace-section-header">
        <span>文件</span>
      </summary>
      <div className="workspace-files-tree">
        {treeError && <p className="empty-hint" role="alert">文件加载失败：{treeError}</p>}
        {!treeError && !tree && <p className="empty-hint" role="status">正在加载文件…</p>}
        {tree && (
          <ul className="ftree">
            <FileTreeNode
              node={tree}
              depth={0}
              expanded={expanded}
              selected={null}
              workDir={workDir}
              onToggle={toggleExpand}
              onSelect={() => { /* 暂不打开预览，避免和 FileTreeModal 重复 */ }}
              badge={badge}
            />
          </ul>
        )}
      </div>
    </details>
  );
}
