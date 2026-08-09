import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractRelativePaths } from '../lib/path-utils';
import { HoverablePath } from './hover/HoverablePath';

interface MarkdownViewProps {
  content: string;
  workDir?: string;
}

/**
 * 渲染 assistant 的 markdown 回复
 * - 支持 GFM（表格、任务列表、删除线、链接）
 * - 代码块、列表、标题、引用、行内代码、链接
 * - 简单代码高亮（关键词颜色），不上 highlight.js（避免 50KB 依赖）
 */
export function MarkdownView({ content, workDir }: MarkdownViewProps) {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 行内代码（react-markdown v10: inline prop 已移除，用 className 判断）
          code({ className, children, ...props }: {
            className?: string;
            children?: React.ReactNode;
          } & React.HTMLAttributes<HTMLElement>) {
            if (!className) {
              return <code className="md-inline-code" {...props}>{children}</code>;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // 链接：新窗口打开
          a({ children, ...props }: { children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
            return (
              <a {...props} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          // 段落：按相对路径拆分，包成可 hover 预览的 span
          p({ children, ...props }: { children?: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>) {
            if (!workDir || typeof children !== 'string') {
              return <p {...props}>{children}</p>;
            }
            const paths = extractRelativePaths(children);
            if (paths.length === 0) return <p {...props}>{children}</p>;
            // 按路径分割文本：先按每个路径 split，再交错渲染
            let rest = children;
            const nodes: React.ReactNode[] = [];
            for (const p of paths) {
              const idx = rest.indexOf(p);
              if (idx < 0) continue;
              if (idx > 0) nodes.push(rest.slice(0, idx));
              nodes.push(<HoverablePath key={`${p}-${idx}`} path={p} workDir={workDir}>{p}</HoverablePath>);
              rest = rest.slice(idx + p.length);
            }
            if (rest) nodes.push(rest);
            return <p {...props}>{nodes}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
