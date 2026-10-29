// Bootstrap metadata belongs to our sites, not public GitHub file proxies.
// Both sites must serve identical signed bytes and the same JSON release gate.
const UPDATE_SITES = ['https://qm.txzy.net', 'https://www.tianxiazhengyi.net'];

export function updateMetadataUrls(paths: readonly string[]): string[] {
  return paths.flatMap(relative => UPDATE_SITES.flatMap(site => [
    `${site}/api/quenching/${relative}`, `${site}/quenching/${relative}`,
  ]));
}

export function updateGateUrls(): string[] {
  return [
    `${UPDATE_SITES[0]}/version.que`,
    `${UPDATE_SITES[0]}/quenching/version.que`,
    `${UPDATE_SITES[1]}/quenching/version.que`,
    `${UPDATE_SITES[1]}/version.que`,
  ];
}
