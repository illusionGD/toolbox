import {
  HomeOutline,
  ImageOutline,
  FolderOpenOutline,
  TextOutline,
  CodeSlashOutline,
  BuildOutline,
  GlobeOutline,
  FilmOutline,
  AppsOutline,
} from '@vicons/ionicons5';
import type { NavItem } from '@/types/navigation';

/**
 * 左侧导航菜单树。
 * key 同时作为 featureKey 用于权限判断（当前全部隐含 free）。
 * 尚未实现的功能路由指向占位页，随各功能开发逐步补齐真实页面。
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', icon: HomeOutline, path: '/home' },
  {
    key: 'image',
    label: '图片工具',
    icon: ImageOutline,
    children: [
      { key: 'image-compress', label: '压缩 / 转换', path: '/image/compress' },
      { key: 'image-crop', label: '图片裁剪', path: '/image/crop' },
      { key: 'image-stylize', label: '风格化', path: '/image/stylize' },
      { key: 'image-sprite', label: '精灵图', path: '/image/sprite' },
      { key: 'image-qrcode', label: '二维码', path: '/image/qrcode' },
    ],
  },
  {
    key: 'file',
    label: '文件工具',
    icon: FolderOpenOutline,
    children: [
      { key: 'file-stats', label: '文件统计', path: '/file/stats' },
      { key: 'file-rename', label: '批量重命名', path: '/file/rename' },
      { key: 'file-excel-i18n', label: 'Excel 多语言', path: '/file/excel-i18n' },
    ],
  },
  {
    key: 'font',
    label: '字体工具',
    icon: TextOutline,
    children: [
      { key: 'font-subset', label: '字体裁剪', path: '/font/subset' },
      { key: 'font-split', label: '网页分包', path: '/font/split' },
      { key: 'font-convert', label: '格式转换', path: '/font/convert' },
      { key: 'font-bitmap', label: '位图字体', path: '/font/bitmap' },
    ],
  },
  {
    key: 'media',
    label: '媒体工具',
    icon: FilmOutline,
    children: [
      { key: 'media-video', label: '视频工具', path: '/media/video' },
      { key: 'media-audio', label: '音频工具', path: '/media/audio' },
      { key: 'media-spine', label: 'Spine 预览', path: '/media/spine' },
    ],
  },
  {
    key: 'network',
    label: '网络工具',
    icon: GlobeOutline,
    children: [{ key: 'network-host', label: 'Host 工具', path: '/network/host' }],
  },
  { key: 'dev', label: '开发工具', icon: CodeSlashOutline, path: '/dev' },
  { key: 'system', label: '系统工具', icon: BuildOutline, path: '/system' },
  { key: 'more', label: '更多工具', icon: AppsOutline, path: '/more' },
];
