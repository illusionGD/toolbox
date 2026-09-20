import { app, dialog, type BrowserWindow } from 'electron';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { WEBTEST_CHANNELS } from '../../shared/channels';
import type { WebTestFlow, WebTestFormat, WebTestSnapshot } from '../../shared/webtest';
import { cachePath, dataPath } from '../storage/paths';
import { handle } from './helper';
import { launchWebTestBrowser } from '../webtest/browser';
import { WebTestSession } from '../webtest/session';
import { importFlow } from '../webtest/flow';
import { exportFlow } from '../webtest/export';
import { listRecordedVideos } from '../webtest/videos';
import { videoFormatSchema, viewportSchema } from '../webtest/options';
import { allowMediaPath, revokeMediaPath, toMediaUrl } from '../protocol/media';
import { registerWebTestAccess } from '../webtest/access';

/**
 * 注册网页测试 IPC。所有入参在主进程验证，文件导入只读数据、不执行脚本。
 * @param win 工具页宿主窗口。
 */
export function registerWebTestIpc(win: BrowserWindow): void {
  let persistence: Promise<void> = Promise.resolve();
  let lastSaved = '';
  let persistenceError = '';
  const persist = (snapshot: WebTestSnapshot): void => {
    if (snapshot.mode !== 'idle' || !snapshot.flow) return;
    const content = JSON.stringify(snapshot.flow, null, 2);
    if (content === lastSaved) return;
    lastSaved = content;
    persistence = persistence
      .then(async () => {
        const path = dataPath('webtest', 'last-flow.json');
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, path);
        persistenceError = '';
      })
      .catch((error: unknown) => {
        lastSaved = '';
        persistenceError = `用例自动保存失败：${String(error)}`;
        console.error('[webtest]', persistenceError);
        if (!win.isDestroyed())
          win.webContents.send(WEBTEST_CHANNELS.changed, {
            ...session.snapshot(),
            error: persistenceError,
          });
      });
  };
  const session = new WebTestSession({
    launch: launchWebTestBrowser,
    artifactDir: () => dataPath('webtest', 'artifacts'),
    videoDir: () => cachePath('webtest', 'videos'),
    changed: (snapshot) => {
      if (!win.isDestroyed()) win.webContents.send(WEBTEST_CHANNELS.changed, snapshot);
      persist(snapshot);
    },
  });
  const ready = (async () => {
    try {
      const content = await readFile(dataPath('webtest', 'last-flow.json'), 'utf8');
      session.setFlow(importFlow(content, '.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        persistenceError = `上次用例读取失败，请重新导入：${String(error)}`;
        console.error('[webtest]', persistenceError);
      }
    }
  })();

  handle(WEBTEST_CHANNELS.snapshot, async () => {
    await ready;
    return { ...session.snapshot(), ...(persistenceError ? { error: persistenceError } : {}) };
  });
  // 旧视频继续可见，不把用户已持久保存的文件自动搬入可清理缓存。
  const getVideos = async () => {
    await ready;
    const roots = [...new Set([cachePath('webtest', 'videos'), dataPath('webtest', 'artifacts')])];
    const groups = await Promise.all(
      roots.map((root) => listRecordedVideos(root, session.activeArtifactDirectory())),
    );
    return groups
      .flat()
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
  };
  const samePath = (a: string, b: string): boolean =>
    resolve(a).toLowerCase() === resolve(b).toLowerCase();
  /** @param input IPC 文件路径；只允许当前列表中的已完成录制，拒绝任意路径操作。 */
  const requireVideo = async (input: unknown): Promise<string> => {
    const path = z.string().min(1).parse(input);
    const video = (await getVideos()).find((item) => samePath(item.path, path));
    if (!video) throw new Error('视频不存在、尚未录制完成或不属于录制视频目录，请刷新列表');
    return video.path;
  };
  const getPlayableVideos = async () => {
    const videos = await getVideos();
    return videos.map((video) => {
      allowMediaPath(video.path);
      return { ...video, url: toMediaUrl(video.path) };
    });
  };
  registerWebTestAccess({
    session,
    ready,
    flush: async () => {
      await persistence;
      if (persistenceError) throw new Error(persistenceError);
    },
    videos: getPlayableVideos,
  });
  handle(WEBTEST_CHANNELS.videos, getPlayableVideos);
  handle(WEBTEST_CHANNELS.saveVideo, async (_event, input: unknown) => {
    const source = await requireVideo(input);
    const extension = extname(source).slice(1).toLowerCase();
    const result = await dialog.showSaveDialog(win, {
      title: '保存录制视频',
      defaultPath: basename(source),
      filters: [{ name: `${extension.toUpperCase()} 视频`, extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    const target = result.filePath;
    if (extname(target).toLowerCase() !== `.${extension}`)
      throw new Error(`请保留 .${extension} 扩展名；视频格式需在录制前设置`);
    await requireVideo(source);
    if (samePath(source, target)) throw new Error('请选择不同于原视频的位置');
    for (const root of [cachePath('webtest', 'videos'), dataPath('webtest', 'artifacts')]) {
      const path = relative(root, target);
      if (!isAbsolute(path) && path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../'))
        throw new Error('请选择录制视频目录之外的保存位置，避免覆盖录制文件');
    }
    await copyFile(source, target);
    return target;
  });
  handle(WEBTEST_CHANNELS.deleteVideo, async (_event, input: unknown) => {
    const path = await requireVideo(input);
    await unlink(path);
    revokeMediaPath(path);
  });
  handle(WEBTEST_CHANNELS.record, async (_event, input: unknown) => {
    await ready;
    const options = z
      .object({
        name: z.string().trim().min(1).max(120),
        startUrl: z.url(),
        baseUrl: z.url(),
        browser: z.enum(['msedge', 'chrome']),
        recordVideo: z.boolean(),
        videoFormat: videoFormatSchema,
        viewport: viewportSchema.optional(),
      })
      .strict()
      .parse(input);
    return session.startRecording(options);
  });
  handle(WEBTEST_CHANNELS.replay, async (_event, input: unknown) => {
    await ready;
    const options = z
      .object({
        flow: z.unknown(),
        baseUrl: z.url(),
        browser: z.enum(['msedge', 'chrome']),
        timeout: z.number().int().min(100).max(120000),
        viewport: viewportSchema.optional(),
      })
      .strict()
      .parse(input);
    return session.startReplay({ ...options, flow: options.flow as WebTestFlow });
  });
  handle(WEBTEST_CHANNELS.stop, async () => {
    await ready;
    const result = await session.stop();
    await persistence;
    return { ...result, ...(persistenceError ? { error: persistenceError } : {}) };
  });
  handle(WEBTEST_CHANNELS.update, async (_event, input: unknown) => {
    await ready;
    const result = session.setFlow(input);
    await persistence;
    if (persistenceError) throw new Error(persistenceError);
    return result;
  });
  handle(WEBTEST_CHANNELS.import, async () => {
    await ready;
    if (session.snapshot().mode !== 'idle') throw new Error('请先结束当前会话');
    const result = await dialog.showOpenDialog(win, {
      title: '导入网页测试用例',
      properties: ['openFile'],
      filters: [{ name: '网页测试用例', extensions: ['json', 'ts', 'js'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('用例文件不能超过 5 MB');
    const snapshot = session.setFlow(
      importFlow(await readFile(path, 'utf8'), extname(path).toLowerCase()),
    );
    await persistence;
    return snapshot;
  });
  handle(WEBTEST_CHANNELS.export, async (_event, input: WebTestFlow, format: WebTestFormat) => {
    const extension = z.enum(['json', 'ts', 'js']).parse(format);
    const content = exportFlow(input, extension);
    const name = input.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
    const result = await dialog.showSaveDialog(win, {
      title: '导出网页测试用例',
      defaultPath: `${name}.${extension}`,
      filters: [{ name: `${extension.toUpperCase()} 用例`, extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void session
      .dispose()
      .catch((error: unknown) => console.error('[webtest] 关闭失败', error))
      .finally(async () => {
        await persistence;
        app.quit();
      });
  });
}
