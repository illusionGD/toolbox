import {
  ImageOutline,
  CropOutline,
  ColorWandOutline,
  GridOutline,
  QrCodeOutline,
  CreateOutline,
  StatsChartOutline,
  VideocamOutline,
  FilmOutline,
  LanguageOutline,
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
        label: '压缩 / 转换',
        desc: '批量压缩与格式转换',
        icon: ImageOutline,
        path: '/image/compress',
      },
      {
        key: 'image-crop',
        label: '图片裁剪',
        desc: '自动去边与手动裁剪',
        icon: CropOutline,
        path: '/image/crop',
      },
      {
        key: 'file-stats',
        label: '文件统计',
        desc: '按后缀统计数量与大小',
        icon: StatsChartOutline,
        path: '/file/stats',
      },
      {
        key: 'file-rename',
        label: '批量重命名',
        desc: '规则链批量改名',
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
        label: '压缩 / 转换',
        desc: '批量压缩与格式转换',
        icon: ImageOutline,
        path: '/image/compress',
      },
      {
        key: 'image-crop',
        label: '图片裁剪',
        desc: '自动去边与手动裁剪',
        icon: CropOutline,
        path: '/image/crop',
      },
      {
        key: 'image-stylize',
        label: '风格化',
        desc: '马赛克、模糊与调色滤镜',
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
      {
        key: 'image-qrcode',
        label: '二维码',
        desc: '批量生成与解析二维码',
        icon: QrCodeOutline,
        path: '/image/qrcode',
      },
    ],
  },
  {
    key: 'file',
    label: '文件管理',
    tools: [
      {
        key: 'file-stats',
        label: '文件统计',
        desc: '按后缀统计数量与大小',
        icon: StatsChartOutline,
        path: '/file/stats',
      },
      {
        key: 'file-rename',
        label: '批量重命名',
        desc: '规则链批量改名',
        icon: CreateOutline,
        path: '/file/rename',
      },
      {
        key: 'file-excel-i18n',
        label: 'Excel 多语言',
        desc: '多语言表转 i18n JSON',
        icon: LanguageOutline,
        path: '/file/excel-i18n',
      },
    ],
  },
  {
    key: 'media',
    label: '媒体处理',
    tools: [
      {
        key: 'media-video',
        label: '视频压缩 / 转码',
        desc: '批量压缩与格式转换',
        icon: VideocamOutline,
        path: '/media/video',
      },
      {
        key: 'media-spine',
        label: 'Spine 预览',
        desc: '预览并播放骨骼动画',
        icon: FilmOutline,
        path: '/media/spine',
      },
    ],
  },
];
