import { z } from 'zod';
import { SKILL_CATALOG_PROMPT, SKILL_INLINE_PROMPT } from '../../../shared/prompts';
import { defineTool, type AnyToolDef } from '../tools/types';
import { enabledSkillDetails, readSkillResource } from './registry';
import { runSkillPython, skillPythonInput } from './python';

/** 每次对话刷新 Skill；开放工具时只发目录，匹配后再读取正文。 */
export async function buildSkillContext(toolsEnabled: boolean): Promise<{
  prompt: string;
  tools: AnyToolDef[];
  warnings: string[];
}> {
  const { skills, warnings } = await enabledSkillDetails().catch((error: unknown) => ({
    skills: [],
    warnings: [`Skill 目录读取失败：${error instanceof Error ? error.message : String(error)}`],
  }));
  if (!skills.length) return { prompt: '', tools: [], warnings };
  if (!toolsEnabled) {
    let bytes = 0;
    const sections: string[] = [];
    for (const item of skills) {
      const size = Buffer.byteLength(item.content);
      if (bytes + size > 128 * 1024) {
        warnings.push(`Skill「${item.skill.name}」未加载：工具关闭时 Skill 正文总计最多 128 KB`);
        continue;
      }
      bytes += size;
      sections.push(JSON.stringify({ name: item.skill.name, instructions: item.content }));
    }
    return { prompt: SKILL_INLINE_PROMPT + '\n' + sections.join('\n'), tools: [], warnings };
  }
  const schema = z.object({
    skillId: z.enum(skills.map((s) => s.skill.id) as [string, ...string[]]),
  });
  const tools = [
    defineTool({
      name: 'read_skill',
      kind: 'read',
      description:
        '读取已启用 Skill 的完整说明及附带资料清单。根据 Skill 目录的描述匹配当前任务，先读取再遵循其步骤。',
      inputSchema: schema,
      summarize: (input) =>
        `读取 Skill：${skills.find((s) => s.skill.id === input.skillId)?.skill.name ?? input.skillId}`,
      run: async (input) => {
        const item = skills.find((s) => s.skill.id === input.skillId)!;
        const result = await readSkillResource(input.skillId, 'SKILL.md');
        return {
          note: `已读取 ${item.skill.name}`,
          data: { name: item.skill.name, instructions: result.content, files: item.files },
        };
      },
    }),
    defineTool({
      name: 'read_skill_file',
      kind: 'read',
      description:
        '读取 Skill 附带的文本资料或脚本源码。file 是包内相对路径，每次最多返回 64 KB；不会执行脚本。',
      inputSchema: schema.extend({ file: z.string().min(1).max(240) }),
      summarize: (input) => `读取 Skill 资料：${input.file}`,
      run: async (input) => ({
        note: `已读取 ${input.file}`,
        data: await readSkillResource(input.skillId, input.file),
      }),
    }),
    defineTool({
      name: 'run_skill_python',
      kind: 'write',
      description:
        '非交互运行已启用 Skill 中的 Python 脚本。script 是文件清单中的相对路径，如 scripts/search_logs.py；args 为独立字符串参数数组，包含空格的参数保持为一个元素。工作目录是 Skill 根目录，优先使用其 .venv，否则自动查找 Python 3。返回 stdout、stderr、退出码；默认超时 120 秒，最多 600 秒。脚本可访问本机文件和网络，询问模式确认后执行。',
      inputSchema: skillPythonInput,
      summarize: (input) => {
        const name =
          skills.find((item) => item.skill.id === input.skillId)?.skill.name ?? input.skillId;
        return `运行 ${name}：${input.script}${input.args.length ? ' ' + input.args.map((arg) => JSON.stringify(arg)).join(' ') : ''}`;
      },
      run: async (input, ctx) => {
        if (!skills.some((item) => item.skill.id === input.skillId))
          throw new Error('该 Skill 未在本次对话中启用');
        const result = await runSkillPython(input, ctx.signal);
        return {
          note:
            result.error ?? `Python 执行完成（退出码 0${result.truncated ? '，输出已截断' : ''}）`,
          failed: Boolean(result.error),
          data: result,
        };
      },
    }),
  ];
  return {
    prompt:
      SKILL_CATALOG_PROMPT +
      '\n' +
      JSON.stringify(
        skills.map(({ skill }) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
        })),
      ),
    tools,
    warnings,
  };
}
