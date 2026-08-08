import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBrowserWindow, mockGetAllWindows } = vi.hoisted(() => ({
  mockBrowserWindow: vi.fn(),
  mockGetAllWindows: vi.fn(() => []),
}));

vi.mock('electron', () => {
  mockBrowserWindow.mockImplementation(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
    Object.assign(this, opts);
    this.loadURL = vi.fn();
    this.loadFile = vi.fn();
    this.show = vi.fn();
    this.focus = vi.fn();
    this.isDestroyed = vi.fn(() => false);
    this.close = vi.fn();
    this.on = vi.fn();
    this.once = vi.fn();
    this.webContents = { send: vi.fn() };
  });
  mockBrowserWindow.getAllWindows = mockGetAllWindows;
  return {
    BrowserWindow: mockBrowserWindow,
    app: {
      getPath: vi.fn(() => '/tmp/test-user-data'),
      getAppPath: vi.fn(() => '/tmp/test-app'),
    },
  };
});

let openSettingsWindow: typeof import('./settings-window').openSettingsWindow;
let broadcastSettingsChanged: typeof import('./settings-window').broadcastSettingsChanged;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('./settings-window');
  openSettingsWindow = mod.openSettingsWindow;
  broadcastSettingsChanged = mod.broadcastSettingsChanged;
});

describe('openSettingsWindow', () => {
  it('creates a fixed-size settings window with window=settings query', () => {
    openSettingsWindow('models');
    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 760,
      height: 640,
      resizable: false,
      maximizable: false,
    }));
    const opts = mockBrowserWindow.mock.calls[0]![0];
    expect(opts.webPreferences.preload).toMatch(/preload\.js$/);
  });

  it('loads dist/index.html with window=settings and tab query (production)', () => {
    const win = openSettingsWindow('app');
    expect(win.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('dist/index.html'),
      { query: { window: 'settings', tab: 'app' } },
    );
  });

  it('loads dev server URL with window=settings and tab param in dev mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { openSettingsWindow: openDev } = await import('./settings-window');
    const win = openDev('app');
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173?window=settings&tab=app');
    vi.unstubAllEnvs();
  });

  it('defaults to the models tab when no tab given', () => {
    openSettingsWindow();
    const win = mockBrowserWindow.mock.results[0]!.value;
    expect(win.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('dist/index.html'),
      { query: { window: 'settings', tab: 'models' } },
    );
  });

  it('focuses existing window instead of creating a second one', () => {
    const created = openSettingsWindow('models');
    const again = openSettingsWindow();
    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(again).toBe(created);
    expect(created.focus).toHaveBeenCalled();
    expect(created.show).toHaveBeenCalled();
  });
});

describe('broadcastSettingsChanged', () => {
  it('sends settings-changed to every non-destroyed window', () => {
    const winA = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const winB = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const winDead = { isDestroyed: () => true, webContents: { send: vi.fn() } };
    mockGetAllWindows.mockReturnValue([winA, winB, winDead]);
    broadcastSettingsChanged();
    expect(mockGetAllWindows).toHaveBeenCalledTimes(1);
    expect(winA.webContents.send).toHaveBeenCalledWith('settings-changed', expect.objectContaining({ at: expect.any(Number) }));
    expect(winB.webContents.send).toHaveBeenCalledWith('settings-changed', expect.objectContaining({ at: expect.any(Number) }));
    expect(winDead.webContents.send).not.toHaveBeenCalled();
  });
});
