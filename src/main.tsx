import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/grounded-tokens.css';
import './styles/workbench.css';

async function bootstrap() {
  // 浏览器视觉回归专用。仅 Vite 开发环境 + 显式参数生效，生产包不会进入此分支。
  if (import.meta.env.DEV && !window.electronAPI && new URLSearchParams(window.location.search).has('ui-preview')) {
    const { installDevPreviewApi } = await import('./dev-preview');
    installDevPreviewApi();
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
