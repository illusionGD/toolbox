/** AI Skill 的跨进程数据；Python 脚本由 AI 工具按询问 / 自动模式运行。 */
export interface AiSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  installedAt: number;
  fileCount: number;
  /** 软件 skills 目录下的子文件夹名；旧安装记录迁移前可能为空。 */
  folder?: string;
}

export interface AiSkillLibrary {
  directory: string;
  skills: AiSkill[];
  warnings: string[];
}

export interface AiSkillDetail {
  skill: AiSkill;
  content: string;
  files: string[];
}

export interface AiSkillCandidate {
  /** SKILL.md 相对于导入源的位置。 */
  path: string;
  name: string;
  description: string;
  content: string;
  fileCount: number;
}

export interface AiSkillPreview {
  token: string;
  source: string;
  candidates: AiSkillCandidate[];
}

export const SKILL_CHANNELS = {
  list: 'ai:skills:list',
  library: 'ai:skills:library',
  openDirectory: 'ai:skills:openDirectory',
  pickLocal: 'ai:skills:pickLocal',
  previewOnline: 'ai:skills:previewOnline',
  install: 'ai:skills:install',
  discard: 'ai:skills:discard',
  detail: 'ai:skills:detail',
  setEnabled: 'ai:skills:setEnabled',
  remove: 'ai:skills:remove',
} as const;
