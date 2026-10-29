import type { AiSkill, AiSkillDetail, AiSkillLibrary, AiSkillPreview } from '@shared/skills';
import { unwrap } from './ipc';

export function listAiSkillsApi(): Promise<AiSkill[]> {
  return unwrap(window.api.ai.skills.list(), { silent: true });
}
export function aiSkillLibraryApi(): Promise<AiSkillLibrary> {
  return unwrap(window.api.ai.skills.library(), { silent: true });
}
export function openAiSkillDirectoryApi(): Promise<string> {
  return unwrap(window.api.ai.skills.openDirectory(), { silent: true });
}
export function pickLocalAiSkillsApi(kind: 'file' | 'directory'): Promise<AiSkillPreview | null> {
  return unwrap(window.api.ai.skills.pickLocal(kind), { silent: true });
}
export function previewOnlineAiSkillsApi(source: string): Promise<AiSkillPreview> {
  return unwrap(window.api.ai.skills.previewOnline(source), { silent: true });
}
export function installAiSkillsApi(token: string, paths: string[]): Promise<AiSkill[]> {
  return unwrap(window.api.ai.skills.install(token, paths), { silent: true });
}
export function discardAiSkillPreviewApi(token: string): Promise<boolean> {
  return unwrap(window.api.ai.skills.discard(token), { silent: true });
}
export function aiSkillDetailApi(id: string): Promise<AiSkillDetail> {
  return unwrap(window.api.ai.skills.detail(id), { silent: true });
}
export function setAiSkillEnabledApi(id: string, enabled: boolean): Promise<AiSkill> {
  return unwrap(window.api.ai.skills.setEnabled(id, enabled), { silent: true });
}
export function removeAiSkillApi(id: string): Promise<boolean> {
  return unwrap(window.api.ai.skills.remove(id), { silent: true });
}
