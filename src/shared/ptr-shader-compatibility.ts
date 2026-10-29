/** Verified builds for ONE active PTR format, not a promise that future PTR
 * builds use Retail's format. When replacing incompatible PTR assets, replace
 * this rule/build list too; do not leave old builds authorized for new bytes.
 * Current entry: user reports current PTR/Retail compatibility, and a read-only
 * .build.info check identified PTR 3.0.1.24368. This is NOT a PTR in-game test. */
export interface PtrShaderRule {
  id: string;
  builds: readonly string[];
  fogShaderPack: 'fog_shaders' | 'fog_shaders-ptr';
}

export const PTR_SHADER_RULE: PtrShaderRule = {
  id: 'ptr-301-24368', builds: ['3.0.1.24368'], fogShaderPack: 'fog_shaders',
};

export type PtrShaderCompatibility =
  | { status: 'supported'; detectedVersion: string; ruleId: string; fogShaderPack: PtrShaderRule['fogShaderPack'] }
  | { status: 'unverified'; detectedVersion: string };

export function resolvePtrShaderCompatibility(
  detected: { parts: readonly number[]; source: string },
  activeRule: PtrShaderRule = PTR_SHADER_RULE,
): PtrShaderCompatibility {
  const readable = detected.source !== 'unknown' && detected.parts.length > 0 &&
    detected.parts.every(part => Number.isSafeInteger(part) && part >= 0);
  const known = readable && detected.parts.length === 4;
  const version = readable ? detected.parts.join('.') : '';
  const rule = known && activeRule.builds.includes(version) ? activeRule : undefined;
  return rule ? { status: 'supported', detectedVersion: version, ruleId: rule.id, fogShaderPack: rule.fogShaderPack }
    : { status: 'unverified', detectedVersion: version };
}
