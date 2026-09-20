import { z } from 'zod';
import { WEBTEST_VIEWPORT_LIMITS } from '../../shared/webtest';

/** 录制、回放、导入及 AI 共用的浏览器页面尺寸校验。 */
export const viewportSchema = z
  .object({
    width: z
      .number()
      .int()
      .min(WEBTEST_VIEWPORT_LIMITS.width.min)
      .max(WEBTEST_VIEWPORT_LIMITS.width.max),
    height: z
      .number()
      .int()
      .min(WEBTEST_VIEWPORT_LIMITS.height.min)
      .max(WEBTEST_VIEWPORT_LIMITS.height.max),
  })
  .strict();

/** 缺少配置时保留旧版 WebM 行为，拒绝未知格式。 */
export const videoFormatSchema = z.enum(['webm', 'mp4']).default('webm');
