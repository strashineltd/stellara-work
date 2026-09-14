import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAuthState, ElectronAPI } from '../../../shared/ipc';
import { SettingsCloudAccountSection } from './SettingsCloudAccountSection';

/**
 * H10：默认档（disabled）下云登录必须在界面层被真正拦住 ——
 * 按钮带 disabled 属性（键盘/焦点不可达），提交处理函数直接早退。
 * 主进程另有权威拦截（见 electron/auth/cloud-auth-manager.test.ts）。
 */

const SIGNED_OUT: CloudAuthState = { configured: true, signedIn: false, account: null };
const DISABLED_HINT = '请先创建本地身份后再登录云账号';

let mounted: { container: HTMLDivElement; root: Root } | null = null;

function installApi() {
  const cloud = {
    getState: vi.fn().mockResolvedValue(SIGNED_OUT),
    signInWithPassword: vi.fn().mockResolvedValue({ ok: true, data: SIGNED_OUT }),
    sendSignUpCode: vi.fn().mockResolvedValue({ ok: false, error: { code: 'unknown', message: 'x', hint: '' } }),
    verifySignUp: vi.fn(),
    isUsernameRegistered: vi.fn().mockResolvedValue({ ok: true, data: false }),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: { auth: { cloud } } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return cloud;
}

async function renderSection(disabled: boolean): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(<SettingsCloudAccountSection disabled={disabled} />);
  });
  await act(async () => {});
  return container;
}

async function rerender(disabled: boolean): Promise<void> {
  await act(async () => {
    mounted?.root.render(<SettingsCloudAccountSection disabled={disabled} />);
  });
  await act(async () => {});
}

async function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
}

async function pressEnter(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for Enter');
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => {});
}

function byText(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (el) => el.textContent?.trim() === text,
  );
}

/** React 受控输入：必须走原生 setter 再派发 input 事件，否则 onChange 不触发 */
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SettingsCloudAccountSection identity disabled state (H10)', () => {
  it('disables every action button and keeps the hint while disabled', async () => {
    installApi();
    const container = await renderSection(true);

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain(DISABLED_HINT);
    expect(byText(container, '登录')?.disabled).toBe(true);
    expect(byText(container, '注册')?.disabled).toBe(true);
  });

  it('keeps controls enabled for a real user and disables the sign-up submit when toggled disabled', async () => {
    installApi();
    const container = await renderSection(false);

    expect(byText(container, '登录')?.disabled).toBe(false);
    expect(byText(container, '注册')?.disabled).toBe(false);

    await fireClick(byText(container, '注册'));
    expect(byText(container, '发送验证码')?.disabled).toBe(false);

    await rerender(true);
    expect(byText(container, '发送验证码')?.disabled).toBe(true);
    expect(container.textContent).toContain(DISABLED_HINT);
  });

  it('ignores keyboard submits while disabled', async () => {
    const cloud = installApi();
    const container = await renderSection(true);

    const inputs = container.querySelectorAll<HTMLInputElement>('.cloud-field__input');
    await typeInto(inputs[0]!, 'alice@example.com');
    await typeInto(inputs[1]!, 'secret');

    await pressEnter(inputs[1]);

    expect(cloud.signInWithPassword).not.toHaveBeenCalled();
    expect(container.querySelector('.error-banner')).toBeNull();
  });

  it('still signs in via keyboard for a real user', async () => {
    const cloud = installApi();
    const container = await renderSection(false);

    const inputs = container.querySelectorAll<HTMLInputElement>('.cloud-field__input');
    await typeInto(inputs[0]!, 'alice@example.com');
    await typeInto(inputs[1]!, 'secret');

    await pressEnter(inputs[1]);

    expect(cloud.signInWithPassword).toHaveBeenCalledWith({
      identifier: 'alice@example.com',
      password: 'secret',
    });
  });
});
