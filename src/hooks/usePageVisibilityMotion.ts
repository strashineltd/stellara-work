import { useEffect } from 'react';

export function usePageVisibilityMotion(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute('data-page-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      root.removeAttribute('data-page-hidden');
    };
  }, []);
}