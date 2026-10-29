export type SettingsProgress = (step: string, percent: number) => void;

/** Keep real work reports monotonic and avoid one IPC message per archive entry. */
export function createSettingsProgressReporter(onProgress?: SettingsProgress): SettingsProgress {
  let previous = 0;
  let previousStep = '';
  return (step, value) => {
    if (!Number.isFinite(value)) return;
    const percent = Math.max(previous, Math.min(100, Math.max(0, Math.floor(value))));
    if (percent === previous && step === previousStep) return;
    previous = percent;
    previousStep = step;
    onProgress?.(step, percent);
  };
}
