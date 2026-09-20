import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchWebTestBrowser } from '../../electron/main/webtest/browser';
import { finalizeRecordedVideo } from '../../electron/main/webtest/videos';
import { probeVideo } from '../../electron/main/ffmpeg/probe';

// 独立进程测试：在加载 Playwright 前，让真实适配器准备随包 ffmpeg。
const browser = await launchWebTestBrowser('msedge', true);
try {
  const directory = resolve('out-tbverify/webtest-runtime/video');
  await mkdir(directory, { recursive: true });
  const viewport = { width: 801, height: 601 };
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: directory, size: { width: 802, height: 602 } },
  });
  const page = await context.newPage();
  const video = page.video()!;
  await page.setContent('<h1>Bundled ffmpeg recording</h1>');
  await page.screenshot();
  await context.close();
  assert.ok((await stat(await video.path())).size > 0);
  const converted = await finalizeRecordedVideo(await video.path(), 'mp4');
  const metadata = await probeVideo(converted);
  assert.equal(metadata.video?.codec, 'h264');
  assert.equal(metadata.video?.width, 802);
  assert.equal(metadata.video?.height, 602);
  console.log('PASS 随包 ffmpeg 将奇数页面尺寸补齐为偶数 MP4，不裁掉页面边缘');
  console.log('PASS 生产浏览器适配器使用随包 ffmpeg 录制视频，不依赖系统 Playwright 缓存');
} finally {
  await browser.close();
}
