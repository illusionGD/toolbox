import {
  ImageOutline,
  SwapHorizontalOutline,
  CropOutline,
  ColorWandOutline,
  GridOutline,
  CreateOutline,
  DocumentTextOutline,
  DocumentAttachOutline,
} from '@vicons/ionicons5';
import type { Component } from 'vue';

/** 推荐工具卡片。 */
export interface RecommendedTool {
  /** 工具 key（对应 NavItem.key，用于跳转与埋点）。 */
  key: string;
  /** 展示名。 */
  label: string;
  /** 一句话描述。 */
  desc: string;
  /** 图标组件。 */
  icon: Component;
  /** 路由路径。 */
  path: string;
}

/** 推荐分组（对应设计稿的 tab）。 */
export interface RecommendGroup {
  /** 分组 key。 */
  key: string;
  /** tab 标题。 */
  label: string;
  /** 该分组下的工具。 */
  tools: RecommendedTool[];
}

/**
 * 首页推荐工具分组。
 * 静态配置，随工具开发逐步补充；仅收录已规划/已实现的工具。
 */
export const RECOMMEND_GROUPS: readonly RecommendGroup[] = [
  {
    key: 'recommend',
    label: '推荐工具',
    tools: [
      {
        key: 'image-compress',
        label: '图片压缩',
        desc: '批量压缩，支持多种格式',
        icon: ImageOutline,
        path: '/image/compress',
      },
      {
        key: 'image-convert',
        label: '格式转换',
        desc: '多格式批量转换',
        icon: SwapHorizontalOutline,
        path: '/image/convert',
      },
      {
        key: 'image-crop',
        label: '图片裁剪',
        desc: '批量裁剪透明区域',
        icon: CropOutline,
        path: '/image/crop',
      },
      {
        key: 'file-rename',
        label: '批量重命名',
        desc: '序列号、字符替换',
        icon: CreateOutline,
        path: '/file/rename',
      },
    ],
  },
  {
    key: 'image',
    label: '图片处理',
    tools: [
      {
        key: 'image-compress',
        label: '图片压缩',
        desc: '批量压缩，减小体积',
        icon: ImageOutline,
        path: '/image/compress',
      },
      {
        key: 'image-convert',
        label: '格式转换',
        desc: '多格式批量转换',
        icon: SwapHorizontalOutline,
        path: '/image/convert',
      },
      {
        key: 'image-crop',
        label: '图片裁剪',
        desc: '批量裁剪透明区域',
        icon: CropOutline,
        path: '/image/crop',
      },
      {
        key: 'image-stylize',
        label: '风格化',
        desc: '马赛克、模糊等',
        icon: ColorWandOutline,
        path: '/image/stylize',
      },
      {
        key: 'image-sprite',
        label: '精灵图',
        desc: '合并与切割图集',
        icon: GridOutline,
        path: '/image/sprite',
      },
    ],
  },
  {
    key: 'file',
    label: '文件管理',
    tools: [
      {
        key: 'file-rename',
        label: '批量重命名',
        desc: '序列号、字符替换',
        icon: CreateOutline,
        path: '/file/rename',
      },
      {
        key: 'file-word2pdf',
        label: 'Word 转 PDF',
        desc: '批量转换文档',
        icon: DocumentTextOutline,
        path: '/file/word2pdf',
      },
      {
        key: 'file-pdf2word',
        label: 'PDF 转 Word',
        desc: '批量转换文档',
        icon: DocumentAttachOutline,
        path: '/file/pdf2word',
      },
    ],
  },
];
