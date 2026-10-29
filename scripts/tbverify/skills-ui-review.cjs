const { chromium } = require('playwright-core');
const { build } = require('vite');
const vue = require('@vitejs/plugin-vue');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const artifactDir = path.join(root, 'out-tbverify/skills-ui');
  await mkdir(artifactDir, { recursive: true });
  const harness = `<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import { createApp, h } from 'vue';
import { NConfigProvider, NMessageProvider, darkTheme, zhCN } from 'naive-ui';
import Manager from '/src/components/ai/AiSkillManager.vue';
import '/src/assets/styles/tokens.scss';
import '/src/assets/styles/theme.scss';
window.calls = [];
let records = [];
const content = '---\\nname: ui-writing\\ndescription: 中文写作\\n---\\n\\n先整理内容，再写出结果。';
const candidate = {path:'writing/SKILL.md',name:'ui-writing',description:'用于中文写作与操作说明。',content,fileCount:2};
const success = data => ({code:0,data,message:''});
window.api = {ai:{skills:{
list: async () => success([...records]),
library: async () => success({directory:'D:/Toolbox/skills',skills:[...records],warnings:[]}),
openDirectory: async () => {window.calls.push(['openDirectory']);return success('D:/Toolbox/skills');},
pickLocal: async kind => {window.calls.push(['pickLocal',kind]); return success({token:'local',source:'D:/skills',candidates:[candidate]});},
previewOnline: async url => {window.calls.push(['online',url]); if(url.includes('invalid')) return {code:1,data:null,message:'Skill 下载失败（HTTP 404）'}; return success({token:'online',source:url,candidates:[candidate,{...candidate,path:'other/SKILL.md',name:'ui-other',description:'另一个 Skill'}]});},
install: async (token,paths) => {window.calls.push(['install',token,paths]); const added=paths.map(p=>({id:p,name:p.startsWith('other')?'ui-other':'ui-writing',description:candidate.description,enabled:false,source:'source',installedAt:Date.now(),fileCount:2}));records.push(...added);return success(added);},
discard: async token => {window.calls.push(['discard',token]);return success(true);},
detail: async id => success({skill:records.find(s=>s.id===id),content,files:['SKILL.md','references/guide.md']}),
setEnabled: async (id,enabled) => {window.calls.push(['enable',id,enabled]);records=records.map(s=>s.id===id?{...s,enabled}:s);return success(records.find(s=>s.id===id));},
remove: async id => {window.calls.push(['remove',id]);records=records.filter(s=>s.id!==id);return success(true);}
}}};
createApp({render:()=>h(NConfigProvider,{theme:darkTheme,locale:zhCN},()=>h(NMessageProvider,null,()=>h(Manager)))}).mount('#app');
</script><style>body{margin:24px;background:#18181c;color:#fff}#app{max-width:900px;margin:auto}</style></body></html>`;
  await writeFile(path.join(artifactDir, 'index.html'), harness);
  const buildDir = path.join(artifactDir, 'build');
  await build({
    configFile: false,
    root,
    plugins: [vue.default ? vue.default() : vue()],
    resolve: {
      alias: { '@': path.join(root, 'src'), '@shared': path.join(root, 'electron/shared') },
    },
    css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
    base: './',
    build: {
      outDir: buildDir,
      emptyOutDir: false,
      rollupOptions: { input: path.join(artifactDir, 'index.html') },
    },
    logLevel: 'warn',
  });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
      args: ['--allow-file-access-from-files'],
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 780 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      require('node:url').pathToFileURL(path.join(buildDir, 'out-tbverify/skills-ui/index.html'))
        .href,
    );
    await page.getByText('还没有 Skill', { exact: true }).waitFor();
    await page.getByText('Skill 文件夹：D:/Toolbox/skills', { exact: true }).waitFor();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.calls.some((call) => call[0] === 'openDirectory')),
      true,
    );
    await page.getByRole('button', { name: '在线安装', exact: true }).click();
    await page
      .getByPlaceholder('https://github.com/owner/repo')
      .fill('https://invalid.example/SKILL.md');
    await page.getByRole('button', { name: '下载并预览', exact: true }).click();
    await page.getByText('Skill 下载失败（HTTP 404）', { exact: true }).waitFor();
    await page
      .getByPlaceholder('https://github.com/owner/repo')
      .fill('https://github.com/example/skills');
    await page.getByRole('button', { name: '下载并预览', exact: true }).click();
    await page.getByRole('checkbox', { name: 'ui-writing', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '安装所选（0）', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: '预览说明', exact: true }).first().click();
    await page.getByText('先整理内容，再写出结果。', { exact: false }).waitFor();
    await page.locator('.n-modal').last().locator('.n-base-close').click();
    await page.getByRole('checkbox', { name: 'ui-writing', exact: true }).check();
    await page.getByRole('button', { name: '安装所选（1）', exact: true }).click();
    const skill = page.locator('.ai-skills__item').filter({ hasText: 'ui-writing' });
    await skill.getByText('未启用', { exact: true }).waitFor();
    await skill.getByRole('switch', { name: '启用 ui-writing' }).click();
    await skill.getByText('已启用', { exact: true }).waitFor();
    await skill.getByRole('button', { name: '查看', exact: true }).click();
    await page.getByText('references/guide.md', { exact: false }).waitFor();
    await page.locator('.n-modal').last().locator('.n-base-close').click();
    await page.locator('.n-modal').waitFor({ state: 'hidden' });
    await page.locator('.n-message').waitFor({ state: 'hidden' });
    await page.screenshot({
      path: path.join(artifactDir, 'desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 400, height: 760 });
    await page.screenshot({
      path: path.join(artifactDir, 'compact.png'),
      fullPage: true,
      animations: 'disabled',
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    await skill.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByText('还没有 Skill', { exact: true }).waitFor();
    await page.getByRole('button', { name: '添加本地目录', exact: true }).click();
    await page.getByRole('button', { name: '安装所选（1）', exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '添加本地文件', exact: true }).click();
    await page.getByRole('button', { name: '安装所选（1）', exact: true }).click();
    await page.locator('.ai-skills__item').getByText('ui-writing', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(
      calls.filter((c) => c[0] === 'pickLocal').map((c) => c[1]),
      ['directory', 'file'],
    );
    assert.deepEqual(calls.find((c) => c[0] === 'install' && c[1] === 'online')[2], [
      'writing/SKILL.md',
    ]);
    assert.equal(
      calls.some((c) => c[0] === 'discard' && c[1] === 'local'),
      true,
    );
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'Skills UI passed: 在线下载错误及重试、多项预览及选装、启停、查看、删除、本地目录取消和文件导入；窄屏无横向溢出，无页面错误。',
    );
  } finally {
    await browser?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
