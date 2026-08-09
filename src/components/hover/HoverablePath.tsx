import { useEffect, useRef, useState } from 'react';
import { FileHoverPreview } from './FileHoverPreview';

const OPEN_DELAY = 300;
const CLOSE_DELAY = 200;

interface HoverablePathProps {
  path: string;
  workDir: string;
  children?: React.ReactNode;
}

export function HoverablePath({ path, workDir, children }: HoverablePathProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTrigger = useRef(false);
  const popoverInside = useRef(false);

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    onTrigger.current = true;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom });
    openTimer.current = setTimeout(() => {
      setOpen(true);
      openTimer.current = null;
    }, OPEN_DELAY);
  };

  const handleMouseLeave = () => {
    onTrigger.current = false;
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (popoverInside.current) return;
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, CLOSE_DELAY);
  };

  const handleHoverChange = (inside: boolean) => {
    popoverInside.current = inside;
    if (inside) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    } else if (!onTrigger.current) {
      closeTimer.current = setTimeout(() => {
        setOpen(false);
        closeTimer.current = null;
      }, CLOSE_DELAY);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    void window.electronAPI.fs.openPath(workDir, path);
  };

  return (
    <>
      <span
        className="hoverable-path"
        title={path}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {children ?? path}
      </span>
      {open && (
        <FileHoverPreview anchor={anchor} path={path} workDir={workDir} onClose={() => setOpen(false)} onHoverChange={handleHoverChange} />
      )}
    </>
  );
}
