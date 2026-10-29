import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { SKILL_CHANNELS } from '../../shared/skills';
import {
  discardSkillPreview,
  installSkills,
  listSkills,
  skillLibrary,
  ensureSkillLibraryDirectory,
  previewLocalSkills,
  previewOnlineSkills,
  removeSkill,
  setSkillEnabled,
  skillDetail,
} from '../ai/skills/registry';
import { handle } from './helper';

const previewOwners = new WeakSet<WebContents>();
function watchPreviewOwner(sender: WebContents): number {
  const owner = sender.id;
  if (!previewOwners.has(sender)) {
    previewOwners.add(sender);
    sender.once('destroyed', () => discardSkillPreview(owner));
  }
  return owner;
}

export function registerSkillsIpc(): void {
  handle(SKILL_CHANNELS.list, () => listSkills());
  handle(SKILL_CHANNELS.library, () => skillLibrary());
  handle(SKILL_CHANNELS.openDirectory, async () => {
    const directory = await ensureSkillLibraryDirectory();
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    return directory;
  });
  handle(SKILL_CHANNELS.pickLocal, async (event, kind: unknown) => {
    const mode = z.enum(['file', 'directory']).parse(kind);
    const options = {
      title: mode === 'directory' ? '选择 Skill 目录或 Skill 集合' : '选择 SKILL.md 或 ZIP',
      properties: mode === 'directory' ? ['openDirectory' as const] : ['openFile' as const],
      ...(mode === 'file' ? { filters: [{ name: 'Skill', extensions: ['md', 'zip'] }] } : {}),
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options));
    if (result.canceled || !result.filePaths[0]) return null;
    const owner = watchPreviewOwner(event.sender);
    const preview = await previewLocalSkills(owner, result.filePaths[0]);
    if (event.sender.isDestroyed()) {
      discardSkillPreview(owner);
      return null;
    }
    return preview;
  });
  handle(SKILL_CHANNELS.previewOnline, async (event, source: unknown) => {
    const owner = watchPreviewOwner(event.sender);
    const preview = await previewOnlineSkills(owner, z.string().parse(source));
    if (event.sender.isDestroyed()) {
      discardSkillPreview(owner);
      throw new Error('安装窗口已关闭');
    }
    return preview;
  });
  handle(SKILL_CHANNELS.install, (event, input: unknown) => {
    const value = z
      .object({ token: z.string().uuid(), paths: z.array(z.string()).min(1).max(100) })
      .parse(input);
    return installSkills(event.sender.id, value.token, value.paths);
  });
  handle(SKILL_CHANNELS.discard, (event, token: unknown) => {
    discardSkillPreview(event.sender.id, z.string().uuid().parse(token));
    return true;
  });
  handle(SKILL_CHANNELS.detail, (_event, id: unknown) => skillDetail(z.string().uuid().parse(id)));
  handle(SKILL_CHANNELS.setEnabled, (_event, id: unknown, enabled: unknown) =>
    setSkillEnabled(z.string().uuid().parse(id), z.boolean().parse(enabled)),
  );
  handle(SKILL_CHANNELS.remove, async (_event, id: unknown) => {
    await removeSkill(z.string().uuid().parse(id));
    return true;
  });
}
