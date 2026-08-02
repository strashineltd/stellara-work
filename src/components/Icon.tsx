import type { SVGProps } from 'react';

export type IconName =
  | 'alert'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'copy'
  | 'database'
  | 'edit'
  | 'file'
  | 'file-tree'
  | 'folder'
  | 'home'
  | 'list'
  | 'more'
  | 'monitor'
  | 'moon'
  | 'panel-left'
  | 'panel-right'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'stop'
  | 'sun'
  | 'terminal'
  | 'tool'
  | 'x';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: IconName;
  size?: number;
}

/** Small, neutral line icons used by the desktop chrome. */
export function Icon({ name, size = 16, className, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className: ['app-icon', className].filter(Boolean).join(' '),
    ...props,
  };

  switch (name) {
    case 'alert':
      return <svg {...common}><path d="M8 2 14 13H2L8 2Z" /><path d="M8 5.7v3.5M8 11.5h.01" /></svg>;
    case 'check':
      return <svg {...common}><path d="m3 8.3 3.2 3.2L13 4.8" /></svg>;
    case 'chevron-down':
      return <svg {...common}><path d="m4 6 4 4 4-4" /></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m6 4 4 4-4 4" /></svg>;
    case 'copy':
      return <svg {...common}><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H5" /></svg>;
    case 'edit':
      return <svg {...common}><path d="m3 11.8.5-2.7 6.9-6.9 2.4 2.4-6.9 6.9-2.9.3Z" /><path d="m9.6 3 2.4 2.4M3 14h10" /></svg>;
    case 'file':
      return <svg {...common}><path d="M4 1.8h5l3 3v9.4H4V1.8Z" /><path d="M9 1.8v3h3" /></svg>;
    case 'file-tree':
      return (
        <svg {...common}>
          <path d="M3 2.5v8M3 5h4M3 10h4" />
          <rect x="7" y="3.5" width="6" height="3" rx="1" />
          <rect x="7" y="8.5" width="6" height="3" rx="1" />
        </svg>
      );
    case 'folder':
      return <svg {...common}><path d="M2 4h4l1.4 1.5H14v6.8a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.3V4Z" /></svg>;
    case 'home':
      return <svg {...common}><path d="m2.2 7.1 5.8-5 5.8 5" /><path d="M3.7 6.2v7h8.6v-7M6.5 13.2V9h3v4.2" /></svg>;
    case 'list':
      return <svg {...common}><rect x="2" y="2.2" width="12" height="11.6" rx="2" /><path d="m4.5 5.4.9.9 1.6-1.8M8.8 5.5h2.8M4.5 9.3l.9.9L7 8.4M8.8 9.5h2.8" /></svg>;
    case 'more':
      return (
        <svg {...common}>
          <circle cx="3.5" cy="8" r=".7" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r=".7" fill="currentColor" stroke="none" />
          <circle cx="12.5" cy="8" r=".7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'monitor':
      return <svg {...common}><rect x="1.8" y="2.5" width="12.4" height="8.8" rx="1.5" /><path d="M6 13.5h4M8 11.3v2.2" /></svg>;
    case 'moon':
      return <svg {...common}><path d="M12.8 10.4A5.6 5.6 0 0 1 5.6 3.2a5.6 5.6 0 1 0 7.2 7.2Z" /></svg>;
    case 'panel-left':
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="13" height="12" rx="2" />
          <path d="M5.5 2v12" />
        </svg>
      );
    case 'panel-right':
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="13" height="12" rx="2" />
          <path d="M10.5 2v12" />
        </svg>
      );
    case 'plus':
      return <svg {...common}><path d="M8 3v10M3 8h10" /></svg>;
    case 'refresh':
      return <svg {...common}><path d="M12.5 5.5A5 5 0 1 0 13 9M12.5 2.5v3h-3" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
    case 'send':
      return <svg {...common}><path d="M2.1 3.1 14 8 2.1 12.9l1.4-4.1L9 8 3.5 7.2 2.1 3.1Z" /></svg>;
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.8v1.3M8 12.9v1.3M14.2 8h-1.3M3.1 8H1.8M12.4 3.6l-.9.9M4.5 11.5l-.9.9M12.4 12.4l-.9-.9M4.5 4.5l-.9-.9" />
        </svg>
      );
    case 'shield':
      return <svg {...common}><path d="M8 1.8 13 4v3.7c0 3-1.9 5.3-5 6.5-3.1-1.2-5-3.5-5-6.5V4l5-2.2Z" /><path d="M8 5.1v3.2M8 10.7h.01" /></svg>;
    case 'stop':
      return <svg {...common}><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>;
    case 'sun':
      return <svg {...common}><circle cx="8" cy="8" r="2.8" /><path d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" /></svg>;
    case 'terminal':
      return <svg {...common}><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" /><path d="m4.5 6 2 2-2 2M8.5 10h3" /></svg>;
    case 'tool':
      return <svg {...common}><path d="M9.7 3.1a3.1 3.1 0 0 0-3.8 3.8l-3.7 3.7a1.6 1.6 0 1 0 2.2 2.2l3.7-3.7a3.1 3.1 0 0 0 3.8-3.8l-1.8 1.1-1.5-1.5 1.1-1.8Z" /></svg>;
    case 'x':
      return <svg {...common}><path d="m4 4 8 8M12 4l-8 8" /></svg>;
    case 'database':
      return (
        <svg {...common}>
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
          <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
        </svg>
      );
  }
}
