import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { searchContent } from '../../../electron/agent/tools/grep.ts';
import { searchSymbol } from '../../../electron/agent/tools/search-symbol.ts';
import { readFile } from '../../../electron/agent/tools/fs.ts';
import { validateUrl, webFetch } from '../../../electron/agent/tools/web-fetch.ts';
import { runCommand } from '../../../electron/agent/tools/shell.ts';
import { addAttachments } from '../../../electron/attachments/attachments.ts';
import { gitDiff } from '../../../electron/agent/tools/git.ts';
import { BrowserService } from '../../../electron/browser/service.ts';

async function main() {
  const base = await fs.mkdtemp('/private/tmp/stellara-security-fixture-');
  const root = path.join(base, 'project');
  const outside = path.join(base, 'project-private');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.ts'), 'const auditSecret = "SYNTHETIC_OUTSIDE_SECRET";\n');
  await fs.symlink(outside, path.join(root, 'linked'), 'dir');
  const control = await readFile({ path: 'linked/secret.ts' }, root);
  const grep = await searchContent({ pattern: '**/*.ts', query: 'auditSecret' }, root);
  const symbol = await searchSymbol({ symbol: 'auditSecret' }, root);
  assert.equal(control.ok, false);
  assert.ok(grep.output.includes('SYNTHETIC_OUTSIDE_SECRET'));
  assert.ok(symbol.output.includes('SYNTHETIC_OUTSIDE_SECRET'));
  console.log(JSON.stringify({ finding: 'search_symlink_escape', readFileBlocked: !control.ok, grep: grep.output, symbol: symbol.output }));

  const urls = ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:169.254.169.254]/'];
  const urlResults = [];
  for (const url of urls) urlResults.push({ url, normalized: new URL(url).hostname, result: await validateUrl(url) });
  assert.equal(urlResults[0].result.ok, false);
  assert.ok(urlResults.slice(1).every(r => r.result.ok));
  const oldFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (input: any) => {
    requested = String(input);
    return new Response('SYNTHETIC_LOCAL_SERVICE', { headers: { 'Content-Type': 'text/plain' } });
  };
  const fetched = await webFetch({ url: urls[1] }, root);
  globalThis.fetch = oldFetch;
  assert.ok(fetched.ok && requested === urls[1]);
  console.log(JSON.stringify({ finding: 'ipv4_mapped_ipv6_bypass', urlResults, reachedFetch: requested, mockedNetwork: true }));

  const shell = await runCommand({ command: 'cat ../project-private/secret.ts' }, root);
  assert.ok(shell.ok && shell.output.includes('SYNTHETIC_OUTSIDE_SECRET'));
  console.log(JSON.stringify({ finding: 'shell_sibling_prefix_escape', result: shell }));

  await fs.symlink(outside, path.join(root, '.stellara-attachments'), 'dir');
  const source = path.join(base, 'upload.txt');
  await fs.writeFile(source, 'SYNTHETIC_UPLOAD');
  await addAttachments('audit-session', root, [source]);
  assert.equal(await fs.readFile(path.join(outside, 'audit-session', 'upload.txt'), 'utf8'), 'SYNTHETIC_UPLOAD');
  console.log(JSON.stringify({ finding: 'attachment_symlink_write_escape', outsideFileCreated: true }));

  const repo = path.join(base, 'git-fixture');
  await fs.mkdir(repo);
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: gitEnv, stdio: 'pipe' });
  git('init');
  await fs.writeFile(path.join(repo, '.gitattributes'), '*.txt diff=audit\n');
  await fs.writeFile(path.join(repo, 'sample.txt'), 'before\n');
  git('add', '.gitattributes', 'sample.txt');
  await fs.writeFile(path.join(repo, 'sample.txt'), 'after\n');
  const marker = path.join(base, 'git-code-execution-marker');
  const converter = path.join(repo, 'audit-converter.sh');
  await fs.writeFile(converter, `#!/bin/sh\nprintf 'SYNTHETIC_EXECUTION' > '${marker}'\ncat "$1"\n`, { mode: 0o700 });
  git('config', 'diff.audit.textconv', converter);
  const diff = await gitDiff({}, repo);
  assert.equal(await fs.readFile(marker, 'utf8'), 'SYNTHETIC_EXECUTION');
  console.log(JSON.stringify({ finding: 'readonly_git_executes_textconv', markerCreated: true, diffOk: diff.ok, prerequisite: 'untrusted local git config or existing textconv driver' }));

  const handlers = new Map<string, Function>();
  let stopped = false;
  let permissionsConfigured = false;
  const wc = {
    on: (name: string, callback: Function) => handlers.set(name, callback),
    setWindowOpenHandler: () => {},
    executeJavaScriptInIsolatedWorld: async () => '',
    stop: () => { stopped = true; },
    session: {
      on: () => {},
      setPermissionRequestHandler: () => { permissionsConfigured = true; },
      setPermissionCheckHandler: () => { permissionsConfigured = true; },
    },
  };
  const svc = new BrowserService(undefined, { createWindow: () => ({ webContents: wc, isDestroyed: () => false, destroy: () => {} }) });
  await svc.get('audit').tabs({ op: 'create' });
  let prevented = false;
  const callback = handlers.get('will-redirect');
  assert.ok(callback);
  callback({ preventDefault: () => { prevented = true; } }, 'http://127.0.0.1/');
  assert.equal(prevented, false);
  const stoppedSynchronously = stopped;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, true);
  console.log(JSON.stringify({ finding: 'browser_redirect_guard_is_late', preventedSynchronously: prevented, stoppedSynchronously, stoppedLater: stopped, mockedElectron: true, permissionsConfigured }));
  console.log(JSON.stringify({ fixtures: base, result: 'All 6 reproduction assertions passed; only synthetic data used.' }));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
