import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewProps {
  content: string;
}

/**
 * 渲染 assistant 的 markdown 回复
 * - 支持 GFM（表格、任务列表、删除线、链接）
 * - 代码块、列表、标题、引用、行内代码、链接
 * - 简单代码高亮（关键词颜色），不上 highlight.js（避免 50KB 依赖）
 */
export function MarkdownView({ content }: MarkdownViewProps) {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 行内代码
          code({ inline, className, children, ...props }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          } & React.HTMLAttributes<HTMLElement>) {
            if (inline) {
              return <code className="md-inline-code" {...props}>{children}</code>;
            }
            return (
              <code className={className ?? 'md-code-block'} {...props}>
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
