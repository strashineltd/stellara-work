import { describe, it, expect } from 'vitest';
import { toCloudAccount } from './cloud-user';

describe('toCloudAccount 归一化', () => {
  it('识别 SDK v3 的 Supabase 形状（真实返回形态）', () => {
    // 取自 @cloudbase/js-sdk convertToUser() 的产物
    const account = toCloudAccount({
      id: 'u_abc123',
      aud: 'authenticated',
      email: 'me@example.com',
      phone: '',
      created_at: '2026-09-11T03:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { uid: 'u_abc123', username: 'stellara_user', name: 'Yuhang' },
      identities: [],
    });

    expect(account).toEqual({
      uid: 'u_abc123',
      email: 'me@example.com',
      username: 'stellara_user',
      displayName: 'Yuhang',
      phone: undefined,
    });
  });

  it('顶层没有 uid 时仍能从 id 取到 uid（旧代码就栽在这里）', () => {
    const account = toCloudAccount({ id: 'u_1', user_metadata: {} });
    expect(account?.uid).toBe('u_1');
  });

  it('user_metadata.nickName 作为昵称兜底', () => {
    const account = toCloudAccount({ id: 'u_1', user_metadata: { nickName: '小航' } });
    expect(account?.displayName).toBe('小航');
  });

  it('兼容原始结构（uid / phone_number 直传）', () => {
    const account = toCloudAccount({
      uid: 'raw_1',
      email: 'a@b.com',
      username: 'raw_user',
      name: 'Raw',
      phone_number: '+8613800000000',
    });
    expect(account).toEqual({
      uid: 'raw_1',
      email: 'a@b.com',
      username: 'raw_user',
      displayName: 'Raw',
      phone: '+8613800000000',
    });
  });

  it('空 email / 空 phone 收敛为 undefined，不产出空串', () => {
    const account = toCloudAccount({ id: 'u_1', email: '', phone: '' });
    expect(account?.email).toBeUndefined();
    expect(account?.phone).toBeUndefined();
  });

  it('取不到任何 uid 时返回 null', () => {
    expect(toCloudAccount(null)).toBeNull();
    expect(toCloudAccount(undefined)).toBeNull();
    expect(toCloudAccount({ email: 'a@b.com' })).toBeNull();
    expect(toCloudAccount({ user_metadata: {} })).toBeNull();
  });
});
