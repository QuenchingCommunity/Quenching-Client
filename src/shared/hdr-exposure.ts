export const HDR_EXPOSURE_MIN = 0.75;
export const HDR_EXPOSURE_MAX = 2.4;
export function defaultHdrExposure(lighting: unknown): number {
  return lighting === 'rpg' ? 0.9 : lighting === 'battle' ? 1.8 : 1.2;
}
export function validHdrExposure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= HDR_EXPOSURE_MIN && value <= HDR_EXPOSURE_MAX;
}
export function validateHdrExposure(value: unknown): number {
  if (!validHdrExposure(value)) throw new Error('Invalid overall brightness');
  return Math.round(value * 100) / 100;
}
export function resolveHdrExposure(settings: {lighting?: unknown; hdrExposure?: unknown} = {}): number {
  return validHdrExposure(settings.hdrExposure) ? validateHdrExposure(settings.hdrExposure) : defaultHdrExposure(settings.lighting);
}
export function withHdrExposure<T extends {lighting?: unknown; hdrExposure?: unknown}>(current: T, changes: Partial<T>): T {
  const next = {...current, ...changes};
  if (changes.lighting !== undefined && changes.hdrExposure === undefined) next.hdrExposure = defaultHdrExposure(changes.lighting);
  next.hdrExposure = resolveHdrExposure(next);
  return next;
}
