import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('project window cross-layer contract', () => {
  const shared = readFileSync(resolve(__dirname, '../shared/ipc.ts'), 'utf-8');
  const main = readFileSync(resolve(__dirname, '../electron/main.ts'), 'utf-8');
  const preload = readFileSync(resolve(__dirname, '../electron/preload.ts'), 'utf-8');
  const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
  const mainView = readFileSync(resolve(__dirname, 'components/MainView.tsx'), 'utf-8');
  const sidebar = readFileSync(resolve(__dirname, 'components/Sidebar.tsx'), 'utf-8');
  const tree = readFileSync(resolve(__dirname, '../electron/fs/tree.ts'), 'utf-8');
  const onboarding = readFileSync(resolve(__dirname, 'components/Onboarding.tsx'), 'utf-8');
  const settings = readFileSync(resolve(__dirname, 'components/settings/SettingsModelsPanel.tsx'), 'utf-8');
  const dataDir = readFileSync(resolve(__dirname, '../electron/config/data-dir.ts'), 'utf-8');

  it('keeps the project work directory in sidebar summaries and newly created state', () => {
    expect(shared).toMatch(/interface ProjectSummary[\s\S]*?workDir\?: string;/);
    expect(shared).toMatch(/interface ProjectSummary[\s\S]*?entryFile\?: string;/);
    expect(main).toContain('workDir: p.workDir');
    expect(main).toContain('entryFile: p.entryFile');
    expect(app).toContain('workDir: project.workDir');
    expect(app).toContain('entryFile: project.entryFile');
    expect(mainView).toContain('workDir: selection.workDir');
    expect(mainView).toContain('entryFile: selection.path');
  });

  it('opens project setup before persistence and keeps existing project rows as toggles', () => {
    expect(mainView).toContain('onProjectCreate={() => setCreateProjectOpen(true)}');
    expect(mainView).toContain('onCreateProject={() => setCreateProjectOpen(true)}');
    expect(mainView).toMatch(/mode="create"[\s\S]*?onCreate=\{handleCreateProject\}/);
    expect(mainView).not.toContain("projects.create({ name: '新项目'");
    expect(sidebar).toContain('className="project-toggle-button"');
    expect(sidebar).not.toContain('aria-label={`打开项目窗口：${p.name}`}');
  });

  it('uses explicit native project-file grants and exclusive file creation', () => {
    expect(preload).toContain("ipcRenderer.invoke('dialog:openFile', workDir)");
    expect(preload).toContain("ipcRenderer.invoke('fs:createFile', workDir, relativePath)");
    expect(preload).toContain("ipcRenderer.invoke('dialog:selectProjectFile')");
    expect(preload).toContain("ipcRenderer.invoke('dialog:createProjectFile')");
    expect(main).toContain("ipcMain.handle('dialog:openFile'");
    expect(main).toContain("ipcMain.handle('fs:createFile'");
    expect(main).toContain("ipcMain.handle('dialog:selectProjectFile'");
    expect(main).toContain("ipcMain.handle('dialog:createProjectFile'");
    expect(tree).toContain("fs.open(check.realPath, 'wx')");
  });

  it('keeps model setup independent from projects and uses standard app storage', () => {
    expect(onboarding).not.toContain('请选择工作目录');
    expect(onboarding).not.toContain('openDirectory');
    expect(settings).not.toContain('默认工作目录');
    expect(app).not.toMatch(/onComplete=\{\(config\)[\s\S]{0,400}sessions\.create/);
    expect(main).toContain("if (!workDir) throw new Error('请先创建项目并设置入口文件')");
    expect(main).toContain("app.getPath('userData')");
    expect(dataDir).toContain('migrateLegacyAppData');
  });
});
