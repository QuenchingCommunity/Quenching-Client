/** Independent update-test channel. Never mutate app versions, MOD markers or settings. */
export function updateTestEnabled(): boolean {
  return process.env.QUENCHING_UPDATE_TEST === '1';
}

export function updateTestBase(): string | undefined {
  if (!updateTestEnabled()) return undefined;
  const base = process.env.QUENCHING_UPDATE_TEST_BASE?.trim() || 'https://www.tianxiazhengyi.net/';
  const parsed = new URL(base);
  const loopback = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if ((parsed.protocol !== 'https:' && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !base.endsWith('/')) {
    throw new Error('Invalid isolated update-test base URL');
  }
  // Already distributed TEST portables retain this marker after updating.
  // New clients use isolated filenames at the site root; old clients keep
  // using the website's legacy TEST aliases until the update is installed.
  return parsed.origin === 'https://www.tianxiazhengyi.net' && parsed.pathname === '/quenching/update-test/'
    ? `${parsed.origin}/` : base;
}

export function updateChannelPath(relative: string): string {
  return updateTestEnabled() ? relative.replace(/(\.[^/.]+)$/, '-test$1') : relative;
}

export function updateTestUrls(relative: string): string[] | undefined {
  const base = updateTestBase();
  return base ? [new URL(updateChannelPath(relative), base).toString()] : undefined;
}
