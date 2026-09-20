import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Browser } from 'playwright-core';
import type { WebTestBrowser } from '../../shared/webtest';
import { cachePath } from '../storage/paths';
import { FFMPEG_PATH } from '../ffmpeg/binary';

let runtimeReady: Promise<void> | null = null;

/** 将随应用分发的 ffmpeg 放进 Playwright 私有缓存，录视频不依赖 QA 安装命令行工具。 */
async function prepareRuntime(): Promise<void> {
  const runtime = cachePath('webtest', 'runtime');
  const manifestPath = join(
    dirname(require.resolve('playwright-core/package.json')),
    'browsers.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    browsers: { name: string; revision: string }[];
  };
  const revision = manifest.browsers.find((entry) => entry.name === 'ffmpeg')?.revision;
  if (!revision || !/^\d+$/.test(revision)) throw new Error('Playwright ffmpeg 版本信息缺失');
  const directory = join(runtime, `ffmpeg-${revision}`);
  await mkdir(directory, { recursive: true });
  await copyFile(FFMPEG_PATH, join(directory, 'ffmpeg-win64.exe'));
  // 必须先设置目录再 import：Playwright 在首次加载时读取并缓存注册表路径。
  process.env.PLAYWRIGHT_BROWSERS_PATH = runtime;
}

/**
 * 启动隔离的浏览器；不会读取用户日常浏览器的 cookies 或个人资料。
 * @param channel 用户选择的本机浏览器。
 * @param headless 仅自动验证使用无头模式；工具页默认显示浏览器。
 * @returns Playwright 浏览器实例。
 */
export async function launchWebTestBrowser(
  channel: WebTestBrowser,
  headless = false,
): Promise<Browser> {
  runtimeReady ??= prepareRuntime().catch((error) => {
    runtimeReady = null;
    throw error;
  });
  await runtimeReady;
  const { chromium } = await import('playwright-core');
  try {
    return await chromium.launch({ channel, headless, timeout: 30000 });
  } catch (error) {
    throw new Error(
      `无法启动 ${channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'}，请确认已安装该浏览器。${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
