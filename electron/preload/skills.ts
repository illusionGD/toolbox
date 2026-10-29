import { ipcRenderer } from 'electron';
import {
  SKILL_CHANNELS,
  type AiSkill,
  type AiSkillDetail,
  type AiSkillPreview,
  type AiSkillLibrary,
} from '../shared/skills';
import type { IpcResponse } from '../shared/types';

export const skillsApi = {
  list: (): Promise<IpcResponse<AiSkill[]>> => ipcRenderer.invoke(SKILL_CHANNELS.list),
  library: (): Promise<IpcResponse<AiSkillLibrary>> => ipcRenderer.invoke(SKILL_CHANNELS.library),
  openDirectory: (): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.openDirectory),
  pickLocal: (kind: 'file' | 'directory'): Promise<IpcResponse<AiSkillPreview | null>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.pickLocal, kind),
  previewOnline: (source: string): Promise<IpcResponse<AiSkillPreview>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.previewOnline, source),
  install: (token: string, paths: string[]): Promise<IpcResponse<AiSkill[]>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.install, { token, paths }),
  discard: (token: string): Promise<IpcResponse<boolean>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.discard, token),
  detail: (id: string): Promise<IpcResponse<AiSkillDetail>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.detail, id),
  setEnabled: (id: string, enabled: boolean): Promise<IpcResponse<AiSkill>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.setEnabled, id, enabled),
  remove: (id: string): Promise<IpcResponse<boolean>> =>
    ipcRenderer.invoke(SKILL_CHANNELS.remove, id),
};
