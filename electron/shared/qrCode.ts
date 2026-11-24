import type { QrGenerateOptions } from './types';

export const QR_GENERATE_DEFAULTS: Omit<QrGenerateOptions, 'items' | 'outputDir'> = {
  size: 320,
  margin: 2,
  level: 'M',
  dark: '#000000',
  light: '#ffffff',
  format: 'png',
};
