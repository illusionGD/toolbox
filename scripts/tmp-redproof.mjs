/**
 * 一次性红证脚本（跑完即删）：逐条拆掉本轮新加的哨兵所守的行为，确认它**真的会红**。
 * 每条都在跑完后把文件原样还回去。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** 一条突变：文件 + 若干「原文 → 改成」的替换 + 期望在失败清单里看到的关键字。 */
const MUTATIONS = [
  {
    name: '① quitting 判断挪到 preventDefault 之后',
    file: 'electron/main/appClose.ts',
    ops: [
      ['    if (quitting) return;\n', ''],
      ['    event.preventDefault();\n', '    event.preventDefault();\n    if (quitting) return;\n'],
    ],
    expect: 'quitting 的放行排在 preventDefault 之前',
  },
  {
    name: '② hideHostToTray 先 hide() 后 ensureTray',
    file: 'electron/main/windowNav.ts',
    ops: [
      ['  if (!window) return false;\n', '  if (!window) return false;\n  window.hide();\n'],
      ['  window.hide();\n  return true;\n}', '  return true;\n}'],
    ],
    expect: '托盘建起来了才 hide() 主窗口',
  },
  {
    name: '③ ensureTray 去掉 isEmpty() 守卫',
    file: 'electron/main/tray.ts',
    ops: [['    if (icon.isEmpty()) return false;\n', '']],
    expect: 'ensureTray 自己查过图标是不是空的',
  },
  {
    name: '④ 「退出 app」改成由调用方给',
    file: 'electron/main/tray.ts',
    ops: [["{ label: '退出 app', click", '{ label: spec.quitLabel, click']],
    expect: '托盘菜单里有「退出 app」',
  },
  {
    name: '⑤ 去掉 removeAllListeners(click)',
    file: 'electron/main/tray.ts',
    ops: [["  tray.removeAllListeners('click');\n", '']],
    expect: '换 owner 时先清掉旧的 click 监听',
  },
  {
    name: '⑥ AI 那项排到「设置」后面',
    file: 'src/components/layout/SideNav.vue',
    ops: [
      ["      key: 'ai',\n", "      key: 'ai-x',\n"],
      [
        "{ key: 'settings', label: '设置', icon: renderIcon(SettingsOutline) },",
        "{ key: 'settings', label: '设置', icon: renderIcon(SettingsOutline) },\n    { key: 'ai', label: 'AI 助手' },",
      ],
    ],
    expect: 'AI 助手排在「设置」上面',
  },
  {
    name: '⑦ 设置页的 radio 少一项',
    file: 'src/views/SettingsView.vue',
    ops: [
      [
        "  { value: 'tray', label: '最小化到托盘', hint: '窗口收起来，任务继续跑，点托盘图标回来' },\n",
        '',
      ],
    ],
    expect: '设置页的 radio 选项数等于关闭动作的态数',
  },
  {
    name: '⑧ normalizeCloseAction 去掉白名单校验',
    file: 'electron/shared/appWindow.ts',
    ops: [
      [
        '  return (APP_CLOSE_ACTIONS as readonly string[]).includes(value as string)\n    ? (value as AppCloseAction)\n    : APP_CLOSE_ACTION_DEFAULT;',
        '  return value as AppCloseAction;',
      ],
    ],
    expect: 'normalizeCloseAction(null) 回默认值',
  },
  {
    name: '⑨ 退出桌宠又变回「把主窗口弹出来」',
    file: 'electron/main/pet/petWindow.ts',
    ops: [
      [
        "  if (getHostWindow()?.isVisible() !== true && !hideHostToTray()) showHostWindow('app');",
        "  showHostWindow('app');",
      ],
    ],
    expect: '退出桌宠时把 app 收进托盘',
  },
  {
    name: '⑩ 首页那块 AI 卡片没删干净',
    file: 'src/views/HomeView.vue',
    ops: [
      [
        '<!--\n        这儿先后放过',
        '<!-- openAiWindowApi() -->\n      <!--\n        这儿先后放过',
      ],
    ],
    expect: '首页不再有 AI 入口',
  },
];

let bad = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf-8');
  let mutated = original;
  for (const [from, to] of m.ops) {
    const count = mutated.split(from).length - 1;
    if (count !== 1) {
      console.error(`  ✗ ${m.name}：待替换的原文命中 ${count} 次（应为 1），突变没做成`);
      bad += 1;
      mutated = original;
      break;
    }
    mutated = mutated.replace(from, to);
  }
  if (mutated === original) continue;
  writeFileSync(m.file, mutated);
  let out = '';
  try {
    out = execSync('node scripts/tbverify/run.cjs', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  } finally {
    writeFileSync(m.file, original);
  }
  const red = out.includes(m.expect);
  if (!red) bad += 1;
  console.log(`  ${red ? '✓ 红了' : '✗ 没红'} ${m.name}`);
  if (!red) console.log(out.split('\n').filter((l) => l.includes('✗') || l.includes('桩测：')).join('\n'));
}

console.log(bad === 0 ? '\n全部突变都被哨兵抓住了' : `\n有 ${bad} 条没被抓住`);
process.exit(bad === 0 ? 0 : 1);
