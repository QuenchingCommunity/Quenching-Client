import { parseReleaseGate, ReleaseGate } from '../../shared/release-gate';
import { updateTestEnabled, updateTestUrls } from './update-channel';
import { fetchUpdateMetadata, requestUpdateMetadata } from './update-metadata';
import { updateGateUrls } from './update-metadata-urls';

export function previewUpdatesEnabled(): boolean {
  // Internal test launch only. A production manifest remains unavailable at
  // its default URLs while allowed=0, even if a user sets this environment flag.
  return updateTestEnabled() || process.env.QUENCHING_PREVIEW_UPDATES === '1';
}

export async function fetchReleaseGate(options?: { urls: string[]; timeoutMs?: number }): Promise<{ gate: ReleaseGate; source: string }> {
  const override = process.env.QUENCHING_VERSION_URL?.trim();
  const urls = updateTestUrls('version.que') || options?.urls || [...new Set([...(override ? [override] : []), ...updateGateUrls()])];
  try {
    return await fetchUpdateMetadata(urls, async (source, timeoutMs) => {
      const text = await requestUpdateMetadata(source, { limit: 4096, allowHttpLoopback: true, timeoutMs: options?.timeoutMs ?? timeoutMs });
      const gate = parseReleaseGate(text.toString('utf8'));
      // Old sites intentionally still advertise a plain version for old clients.
      // That is NOT an authorization gate for any modern client/MOD version.
      if (gate.legacyPlainText) throw new Error('legacy version text has no public-release gate; JSON gate required');
      return { gate, source };
    });
  } catch (error: any) {
    throw new Error(`all version.que sources failed: ${error?.message || String(error)}`);
  }
}
