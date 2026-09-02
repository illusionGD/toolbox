import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { Application, Assets, Graphics, loadTextures, type Texture } from 'pixi.js';
import {
  Spine,
  SpineTexture,
  TextureAtlas,
  AtlasAttachmentLoader,
  SkeletonJson,
  SkeletonBinary,
} from '@esotericsoftware/spine-pixi-v8';
import { analyzeBones, type SpineBoneStats } from '@/utils/spine';

// 禁用基于 Web Worker 的纹理解码：Electron 严格 CSP 下 Worker 从 blob 创建脚本会被拦，
// 改为主线程解码，避免 "Failed to construct 'Worker' ... denied by CSP"。
loadTextures.config = {
  preferWorkers: false,
  preferCreateImageBitmap: true,
  crossOrigin: 'anonymous',
};

/** 拖入的 spine 素材文件集合。 */
export interface SpineFiles {
  /** .atlas 文件。 */
  atlas: File | null;
  /** skeleton：.json 或 .skel 文件。 */
  skeleton: File | null;
  /** 贴图：文件名 → File，可多张。 */
  images: Map<string, File>;
}

/** 包围盒 / 骨架数据信息（调试用）。 */
export interface SpineBoundsInfo {
  /** getLocalBounds() 的本地包围盒（未缩放）。 */
  bounds: { x: number; y: number; width: number; height: number };
  /** skeleton.data 的关键字段。 */
  skeleton: {
    /** 骨架名（导出时的 skeleton name，可能为空）。 */
    name: string | null;
    /** setup 姿势下的宽。 */
    width: number;
    /** setup 姿势下的高。 */
    height: number;
    /** 原点偏移 x。 */
    x: number;
    /** 原点偏移 y。 */
    y: number;
    /** 导出帧率。 */
    fps: number;
  };
}

/** useSpine 返回。 */
export interface UseSpineReturn {
  /** 画布容器 ref，绑定到模板元素。 */
  containerRef: Ref<HTMLDivElement | null>;
  /** 当前 spine 的动画名列表。 */
  animations: Ref<string[]>;
  /** 当前播放的动画名。 */
  currentAnimation: Ref<string>;
  /** 是否已加载 spine。 */
  loaded: Ref<boolean>;
  /** 是否暂停。 */
  paused: Ref<boolean>;
  /** 是否循环播放。 */
  loop: Ref<boolean>;
  /** 播放速度倍率（1 = 正常）。 */
  speed: Ref<number>;
  /** 是否显示包围盒。 */
  showBounds: Ref<boolean>;
  /** 当前 spine 的包围盒 / 骨架数据（未加载时为 null）。 */
  boundsInfo: Ref<SpineBoundsInfo | null>;
  /** 当前 spine 的骨骼数量与最大深度（未加载时为 null）。 */
  boneStats: Ref<SpineBoneStats | null>;
  /** 加载素材并渲染。 */
  load: (files: SpineFiles) => Promise<void>;
  /** 播放指定动画。 */
  play: (name: string) => void;
  /** 暂停/继续。 */
  togglePause: () => void;
  /** 设置循环播放，并对当前动画立即生效。 */
  setLoop: (value: boolean) => void;
  /** 设置播放速度倍率，立即生效。 */
  setSpeed: (value: number) => void;
  /** 显示/隐藏包围盒。 */
  setShowBounds: (value: boolean) => void;
  /** 卸载并清理资源。 */
  dispose: () => void;
}

/**
 * 读取 File 为文本。
 * @param file 文件。
 * @returns 文本内容。
 */
function readText(file: File): Promise<string> {
  return file.text();
}

/**
 * Spine 预览 composable：管理 Pixi 应用、从拖入的 objectURL 素材加载 Spine，
 * 并提供播放/切换/暂停控制。渲染进程内完成，不经 IPC。
 * @returns 画布 ref、动画状态与控制方法。
 */
export function useSpine(): UseSpineReturn {
  const containerRef = ref<HTMLDivElement | null>(null);
  const animations = ref<string[]>([]);
  const currentAnimation = ref('');
  const loaded = ref(false);
  const paused = ref(false);
  const loop = ref(true);
  const speed = ref(1);
  const showBounds = ref(false);
  const boundsInfo = ref<SpineBoundsInfo | null>(null);
  const boneStats = ref<SpineBoneStats | null>(null);

  let app: Application | null = null;
  const spineRef: ShallowRef<Spine | null> = shallowRef(null);
  let boundsGfx: Graphics | null = null;
  /** setup 姿势下测得的固定本地包围盒；供 fit 与描边共用，避免随动画帧抖动。 */
  let baseBounds: { x: number; y: number; width: number; height: number } | null = null;
  const objectUrls: string[] = [];

  /** 确保 Pixi 应用已初始化。 */
  async function ensureApp(): Promise<Application> {
    if (app) return app;
    const instance = new Application();
    await instance.init({
      background: '#1d1d21',
      resizeTo: containerRef.value ?? undefined,
      antialias: true,
    });
    if (containerRef.value) containerRef.value.appendChild(instance.canvas);
    // 画布尺寸变化（窗口缩放/最大化）后重新适配模型
    instance.renderer.on('resize', () => fitToScreen());
    app = instance;
    return instance;
  }

  /** 释放当前 spine 与其纹理，但保留 app。 */
  function clearSpine(): void {
    if (spineRef.value && app) {
      app.stage.removeChild(spineRef.value);
      spineRef.value.destroy();
      spineRef.value = null;
    }
    if (boundsGfx) {
      boundsGfx.clear();
    }
    baseBounds = null;
    boundsInfo.value = null;
    boneStats.value = null;
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.length = 0;
  }

  async function load(files: SpineFiles): Promise<void> {
    if (!files.atlas || !files.skeleton) {
      throw new Error('缺少 atlas 或 skeleton 文件');
    }
    const instance = await ensureApp();
    clearSpine();

    // 1) 读 atlas 文本，交由 TextureAtlas 解析；其贴图按文件名从拖入的 images 里取
    const atlasText = await readText(files.atlas);

    const atlas = new TextureAtlas(atlasText);
    for (const page of atlas.pages) {
      const imageFile = files.images.get(page.name);
      if (!imageFile) {
        throw new Error(`缺少贴图文件：${page.name}`);
      }
      const url = URL.createObjectURL(imageFile);
      objectUrls.push(url);
      const texture = (await Assets.load({ src: url, loadParser: 'loadTextures' })) as Texture;
      page.setTexture(SpineTexture.from(texture.source));
    }

    // 2) 解析 skeleton（json 文本 / skel 二进制）
    const attachmentLoader = new AtlasAttachmentLoader(atlas);
    const isBinary = files.skeleton.name.toLowerCase().endsWith('.skel');
    let skeletonData;
    if (isBinary) {
      const buffer = new Uint8Array(await files.skeleton.arrayBuffer());
      const binary = new SkeletonBinary(attachmentLoader);
      skeletonData = binary.readSkeletonData(buffer);
    } else {
      const jsonText = await readText(files.skeleton);
      const json = new SkeletonJson(attachmentLoader);
      skeletonData = json.readSkeletonData(JSON.parse(jsonText));
    }

    // 3) 创建 Spine 显示对象
    const spine = new Spine(skeletonData);
    spine.state.timeScale = speed.value;
    instance.stage.addChild(spine);
    spineRef.value = spine;

    // setup 姿势下测一次固定包围盒（此刻还没设动画，姿势稳定）
    const setup = spine.getLocalBounds();
    baseBounds = { x: setup.x, y: setup.y, width: setup.width, height: setup.height };

    animations.value = skeletonData.animations.map((a) => a.name);
    // 骨骼统计只依赖 skeletonData，与渲染无关，所以放在设动画之前算
    boneStats.value = analyzeBones(skeletonData.bones);
    loaded.value = true;
    paused.value = false;

    // 默认播放第一个动画（fit 用固定基准盒，不受动画帧影响）
    if (animations.value.length) play(animations.value[0]);
    fitToScreen();
    captureBoundsInfo();
  }

  /** 把固定基准包围盒与骨架数据写入 boundsInfo。 */
  function captureBoundsInfo(): void {
    const spine = spineRef.value;
    if (!spine || !baseBounds) {
      boundsInfo.value = null;
      return;
    }
    const data = spine.skeleton.data;
    boundsInfo.value = {
      bounds: { ...baseBounds },
      skeleton: {
        name: data.name ?? null,
        width: data.width,
        height: data.height,
        x: data.x,
        y: data.y,
        fps: data.fps,
      },
    };
  }

  /**
   * 按画布尺寸自动缩放并居中当前 spine，使其完整可见（留边距）。
   * 用 setup 姿势的固定包围盒计算，避免随动画帧抖动。
   */
  function fitToScreen(): void {
    const spine = spineRef.value;
    if (!spine || !app || !baseBounds) return;
    const bounds = baseBounds;
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const padding = 0.85; // 留 15% 边距
    const { width: sw, height: sh } = app.screen;
    const scale = Math.min(sw / bounds.width, sh / bounds.height) * padding;

    spine.scale.set(scale);
    // 包围盒中心对齐画布中心
    spine.x = sw / 2 - (bounds.x + bounds.width / 2) * scale;
    spine.y = sh / 2 - (bounds.y + bounds.height / 2) * scale;

    drawBounds();
  }

  /**
   * 按当前 spine 的变换在 stage 上重绘包围盒描边。
   * 用固定基准盒（非实时 getLocalBounds），保证每次开关一致。
   */
  function drawBounds(): void {
    const spine = spineRef.value;
    if (!app || !spine || !baseBounds) return;
    // 保证描边始终在模型之上
    if (!boundsGfx) boundsGfx = new Graphics();
    app.stage.addChild(boundsGfx);
    boundsGfx.clear();
    boundsGfx.visible = showBounds.value;
    if (!showBounds.value) return;

    const b = baseBounds;
    const sx = spine.scale.x;
    const sy = spine.scale.y;
    boundsGfx
      .rect(spine.x + b.x * sx, spine.y + b.y * sy, b.width * sx, b.height * sy)
      .stroke({ width: 1, color: 0x7c3aed });
  }

  function play(name: string): void {
    if (!spineRef.value) return;
    spineRef.value.state.setAnimation(0, name, loop.value);
    currentAnimation.value = name;
    paused.value = false;
    spineRef.value.autoUpdate = true;
  }

  function togglePause(): void {
    if (!spineRef.value) return;
    paused.value = !paused.value;
    spineRef.value.autoUpdate = !paused.value;
  }

  /**
   * 设置循环播放。对当前正在播放的动画立即生效（重设 track 的 loop）。
   * @param value 是否循环。
   */
  function setLoop(value: boolean): void {
    loop.value = value;
    const track = spineRef.value?.state.tracks[0];
    if (track) track.loop = value;
  }

  /**
   * 设置播放速度倍率，立即生效。
   * @param value 速度倍率（>0，1 为正常）。
   */
  function setSpeed(value: number): void {
    speed.value = value;
    if (spineRef.value) spineRef.value.state.timeScale = value;
  }

  /**
   * 显示/隐藏包围盒描边。
   * @param value 是否显示。
   */
  function setShowBounds(value: boolean): void {
    showBounds.value = value;
    drawBounds();
  }

  function dispose(): void {
    clearSpine();
    if (boundsGfx) {
      boundsGfx.destroy();
      boundsGfx = null;
    }
    if (app) {
      app.destroy(true, { children: true });
      app = null;
    }
    loaded.value = false;
  }

  return {
    containerRef,
    animations,
    currentAnimation,
    loaded,
    paused,
    loop,
    speed,
    showBounds,
    boundsInfo,
    boneStats,
    load,
    play,
    togglePause,
    setLoop,
    setSpeed,
    setShowBounds,
    dispose,
  };
}
