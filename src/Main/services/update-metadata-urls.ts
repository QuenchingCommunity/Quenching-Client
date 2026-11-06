import { updateChannelPath, updateTestBase } from './update-channel';

// Bootstrap metadata belongs to our sites, not public GitHub file proxies.
// Both sites must serve identical signed bytes and the same JSON release gate.
const UPDATE_SITES = ['https://qm.txzy.net', 'https://www.tianxiazhengyi.net'];

export function updateMetadataUrls(paths: readonly string[], override?: string): string[] {
  const testBase = updateTestBase();
  const sites = testBase ? [testBase.replace(/\/$/, '')] : UPDATE_SITES;
  // Try independent hosts before retrying another alias on the same host.
  return [...new Set([...(override && !testBase ? [override] : []),
    ...paths.flatMap(relative => ['api/quenching', 'quenching'].flatMap(prefix =>
      sites.map(site => `${site}/${prefix}/${updateChannelPath(relative)}`)))])];
}

export function updateGateUrls(): string[] {
  const testBase = updateTestBase();
  const sites = testBase ? [testBase.replace(/\/$/, '')] : UPDATE_SITES;
  return ['version.que', 'quenching/version.que'].flatMap(relative =>
    sites.map(site => `${site}/${updateChannelPath(relative)}`));
}
