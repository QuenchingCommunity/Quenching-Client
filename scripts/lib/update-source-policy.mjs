// Pure publisher logic. No credentials, network calls or client-side mirror list.
export function canonicalUpdateJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalUpdateJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalUpdateJson(value[key])}`).join(',')}}`;
}

export function validateUpdateSourcePolicy(policy) {
  if (policy?.schema !== 1 || !Array.isArray(policy.githubMirrors) || policy.githubMirrors.length > 8) throw new Error('invalid update source policy');
  const mirrors = [...new Set(policy.githubMirrors)];
  for (const base of mirrors) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !base.endsWith('/')) throw new Error('invalid mirror prefix');
  }
  const metadataMirrors = policy.metadataMirrors || [];
  if (!Array.isArray(metadataMirrors) || metadataMirrors.length > 4) throw new Error('invalid metadata mirror policy');
  for (const mirror of metadataMirrors) {
    for (const value of [mirror.from, mirror.to]) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !value.endsWith('/')) throw new Error('invalid metadata mirror prefix');
    }
  }
  return { schema: 1, githubMirrors: mirrors, metadataMirrors };
}

function githubRelease(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash &&
      /^\/(?:UIZorrot|QuenchingCommunity)\/Quenching-(?:Client|Assets)\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname);
  } catch { return false; }
}

function proxiedGithubRelease(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const start = value.indexOf('https://github.com/', 8);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      start > 0 && githubRelease(value.slice(start)) && new URL(value.slice(0, start)).protocol === 'https:';
  } catch { return false; }
}

/** Version-independent: old schema 1 clients need explicit URLs; modern clients
 * expand the signed policy themselves. Never change file identity or payload. */
export function applyUpdateSourcePolicy(input, rawPolicy) {
  const { githubMirrors, metadataMirrors } = validateUpdateSourcePolicy(rawPolicy);
  const manifest = JSON.parse(JSON.stringify(input));
  if (!['quenching-client', 'quenching-mod'].includes(manifest.product) || ![1, 2, 3].includes(manifest.schema) ||
      (manifest.product === 'quenching-client' && manifest.schema === 3)) throw new Error('unsupported update manifest');
  delete manifest.signature;
  if (manifest.schema === 2) {
    if (!manifest.fileSync) throw new Error('fileSync descriptor missing');
    manifest.fileSync.githubMirrors = githubMirrors;
    // These are small, signed official inventories, not public Release assets.
    // Only a publisher-configured metadata host may mirror them. Never forward
    // credentials/query tokens or apply this rule to file objects/other sources.
    for (const artifact of [manifest.fileSync.inventory, ...Object.values(manifest.fileSync.baselines || {})]) {
      const extra = artifact.sources.flatMap(source => {
        if (typeof source !== 'string') return [];
        const url = new URL(source);
        if (url.username || url.password || url.search || url.hash) return [];
        return metadataMirrors.filter(mirror => source.startsWith(mirror.from))
          .map(mirror => mirror.to + source.slice(mirror.from.length));
      });
      artifact.sources = [...new Set([...artifact.sources, ...extra])];
      if (artifact.sources.length > 8) throw new Error('metadata mirror expansion exceeds 8 artifact sources');
    }
  } else if (manifest.schema === 3) manifest.githubMirrors = githubMirrors;
  else {
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.sources)) {
        // Preserve every real source, including chunks and non-GitHub fallbacks.
        // Replace only redundant proxy wrappers around a preserved original URL.
        const originals = node.sources.filter(source => !proxiedGithubRelease(source) ||
          !node.sources.some(original => githubRelease(original) && source.endsWith(original)));
        node.sources = [...new Set(originals.flatMap(source => githubRelease(source)
          ? [source, ...githubMirrors.map(base => base + source)] : [source]))];
        if (node.sources.length > 8) throw new Error('mirror expansion exceeds 8 artifact sources');
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'sources') visit(child);
    };
    visit(manifest);
  }
  return manifest;
}
