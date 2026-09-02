/**
 * Spine 骨架相关的纯计算。放 utils 而不是写在 composable 里：这些是可脱离 Pixi /
 * Spine 运行时单独验证的纯函数，composable 只负责把 `skeleton.data` 喂进来。
 */

/** 骨骼层级统计所需的最小骨骼形状（`BoneData` 结构上兼容）。 */
export interface BoneLike {
  /** 骨骼名，同一骨架内唯一。 */
  name: string;
  /** 父骨骼；root 为 null。 */
  parent: BoneLike | null;
}

/** 骨骼层级统计结果。 */
export interface SpineBoneStats {
  /** 骨骼总数（含 root）。 */
  count: number;
  /** 最大骨骼深度，**root 记作第 1 层**（只有 root 时为 1）。 */
  maxDepth: number;
  /** 最深的那条骨骼链，root → 最深骨骼，长度等于 `maxDepth`。 */
  deepestChain: string[];
}

/**
 * 统计骨骼数量与最大骨骼深度。
 *
 * 深度口径：**root 记作第 1 层**（不是 0）。理由是面板上要给人看「这套骨架有几层」，
 * 只有一根 root 的骨架说成「0 层」反直觉；`deepestChain.length === maxDepth` 也因此
 * 恒成立，读数与链条能互相对上。
 *
 * 实现**不依赖 `SkeletonData.bones` 的顺序**：往上收集未定深度的祖先、再自上而下
 * 回填的记忆化写法，打乱顺序（子在父前）也对（已断言）。文档说 bones 是
 * "sorted parent first"，实测**合法文件确实如此**，所以单趟累加父深度本来也够；
 * 顺序无关只是不把别人的实现细节当前提，代价是一个 Map（10000 根直链上还比逐根
 * 上溯快 18×）。
 *
 * 环形父子引用也不会死循环。实测这在合法文件里**不可能出现**：`SkeletonJson` 解析
 * 父骨骼走 `findBone(name)`，前向引用找不到就**静默返回 null**（不报错），于是那根
 * 骨骼被当成又一个 root——Spine 自己的渲染也一样错位。所以这里读出来的深度如实
 * 反映运行时手里的父子关系，不替它猜。环检测纯属保险。
 * @param bones 骨骼列表，通常是 `skeleton.data.bones`。
 * @returns 骨骼数量、最大深度与最深的一条链；空列表时为 0 / 0 / []。
 */
export function analyzeBones(bones: readonly BoneLike[]): SpineBoneStats {
  const depths = new Map<BoneLike, number>();
  let maxDepth = 0;
  let deepest: BoneLike | null = null;

  for (const bone of bones) {
    if (!depths.has(bone)) {
      // 从自己往上走到「已知深度的祖先」或 root，途中节点压栈
      const pending: BoneLike[] = [];
      const walking = new Set<BoneLike>();
      let cursor: BoneLike | null = bone;
      while (cursor && !depths.has(cursor)) {
        if (walking.has(cursor)) break; // 环：就地截断，宁可读数不准也不能死循环
        walking.add(cursor);
        pending.push(cursor);
        cursor = cursor.parent;
      }
      // 自上而下回填：栈顶是最靠上的那个
      let depth = cursor ? (depths.get(cursor) ?? 0) : 0;
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        depth += 1;
        depths.set(pending[i], depth);
      }
    }

    const depth = depths.get(bone) ?? 0;
    // 严格大于：并列时取 bones 里靠前的那条，结果与文件顺序一致、可复现
    if (depth > maxDepth) {
      maxDepth = depth;
      deepest = bone;
    }
  }

  const deepestChain: string[] = [];
  const seen = new Set<BoneLike>();
  for (let cursor = deepest; cursor && !seen.has(cursor); cursor = cursor.parent) {
    seen.add(cursor);
    deepestChain.push(cursor.name);
  }
  deepestChain.reverse();

  return { count: bones.length, maxDepth, deepestChain };
}
