import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'node:crypto';
import { readabilityEnabled, supportsReadability } from '../../shared/rendering-presets';
import type { ModProfile } from '../../shared/mod-profile';
import { assertShaderProfileSupported } from '../../shared/mod-profile';
import { normalizeBrightnessLevel } from './dnc-lighting';
import { copyBundledResourceIfChanged } from './managed-resource-files';
import { shaderMaterialMode, shaderPixelFolder, readabilityProfileKey } from '../../shared/shader-variant';

export const OBJECT_SHADER_FILES = [
    'ps/cliffblightmiscterrain.bls',
    'ps/foliage.bls',
    'ps/hd.bls',
    'ps/sd_on_hd.bls',
    'ps/terrain.bls',
    'vs/cliffblightmiscterrain.bls',
    'vs/foliage.bls',
    'vs/hd.bls',
    'vs/terrain.bls',
];

/** 后处理阴影：体积雾和色彩校正，不含辉光。 */
export const POST_PROCESSING_SHADOW_FILES = [
    'ps/fog.bls',
    'ps/volumetricfog.bls',
];
export const HDR_SHADER_FILES = ['ps/tonemap.bls'];
export const supportsHdr = (profile: FogProfile): boolean => profile.graphics !== 'sd' && !profile.shaderPack.includes('-legacy-');
const hdrEnabled = (settings: any): boolean => settings?.hdr ?? settings?.postProcessing !== false;

/** 后处理辉光：只控制两份 Bloom 和 Gaussian Blur。 */
export const POST_PROCESSING_GLOW_FILES = [
    'ps/bloomcombine.bls',
    'ps/bloomextract.bls',
    'ps/gaussianblur.bls',
];

export const POST_PROCESSING_FILES = [
    ...POST_PROCESSING_SHADOW_FILES,
    ...POST_PROCESSING_GLOW_FILES,
    ...HDR_SHADER_FILES,
];

const FOG_FILES = ['fog.bls', 'volumetricfog.bls'];
const FOG_VISIBILITY_WRITERS = ['hd.bls', 'sd_on_hd.bls', 'foliage.bls'];
const pairedWriterFiles = (fogPack: string) => ['terrain.bls', 'cliffblightmiscterrain.bls',
    ...(fogPack === 'fog_shaders' ? FOG_VISIBILITY_WRITERS : [])];
type FogProfile = Pick<ModProfile, 'graphics' | 'shaderPack' | 'ptrShaderCompatibility'>;
type FogSource = { file: string; source: string };

/** 3.7 retains fog composition and uses paired terrain identity/optimized AO;
 * ao_080/ao_066 remain compatibility selector names.
 * Outline intensity follows the existing switch; brightness controls DNC lighting.
 * Archived 3.0 retains its known-good assets and selection behavior. */
export function pickFogVariant(
    profile: FogProfile,
    lighting: unknown,
    brightnessLevel: unknown,
    outline: unknown = false,
): string | null {
    assertShaderProfileSupported(profile);
    if (profile.graphics === 'sd') return null;
    const mode = typeof lighting === 'string' && lighting ? lighting : 'standard';
    if (supportsFogProfiles(profile)) {
        return (mode === 'battle' ? 'ao_066' : 'ao_080') + (outline === true ? '_outline' : '');
    }
    if (profile.graphics === 'hd' && profile.shaderPack === 'shaders-300-legacy-hd') {
        const level = normalizeBrightnessLevel(brightnessLevel);
        if (mode === 'battle') return level >= 4 ? 'brightness_3' : 'brightness_2';
        if (mode === 'standard' || mode === 'rpg') return level >= 4 ? 'brightness_2' : null;
    }
    return null;
}

function supportsFogProfiles(profile: FogProfile): boolean {
    return profile.graphics !== 'sd' && ['shaders-300-hd', 'shaders-300-de', 'shaders-ptr-hd', 'shaders-ptr-de'].includes(profile.shaderPack);
}

/** Relative ZIP paths read by resolveFogSources, including validation inputs. */
export function shaderToggleResourcePaths(profile: FogProfile, modSettings: any): string[] {
    assertShaderProfileSupported(profile);
    const paths = new Set<string>();
    const pixel = shaderPixelFolder(profile, modSettings?.lighting);
    if (supportsHdr(profile) && hdrEnabled(modSettings)) paths.add(`shaders/${profile.shaderPack}/${pixel}/tonemap.bls`);
    const hd = `shaders/${profile.shaderPack}/${pixel}/hd.bls`;
    if (supportsReadability(profile) && modSettings?.objectShader !== false && modSettings?.improveReadability !== undefined) paths.add(hd);
    if (modSettings?.postProcessing === false) return [...paths];
    const variant = pickFogVariant(profile, modSettings?.lighting, modSettings?.lightingBrightness, modSettings?.postProcessingOutline);
    if (!variant) return [...paths];
    const fogPack = profile.shaderPack === 'shaders-300-legacy-hd' ? 'fog_shaders-legacy'
        : profile.ptrShaderCompatibility?.status === 'supported' ? profile.ptrShaderCompatibility.fogShaderPack : 'fog_shaders';
    if (supportsReadability(profile) && readabilityEnabled(modSettings)) {
        paths.add(hd);
        paths.add('shaders/readability-301/profiles.json');
        const key = readabilityProfileKey(profile, modSettings?.lighting, variant);
        for (const file of ['hd.bls', ...FOG_FILES]) paths.add(`shaders/readability-301/${key}/ps/${file}`);
    } else {
        for (const file of FOG_FILES) paths.add(`shaders/${fogPack}/${variant}/ps/${file}`);
    }
    if (supportsFogProfiles(profile)) {
        const writer = modSettings?.objectShader === false ? `shaders/${fogPack}/identity_writers/ps`
            : `shaders/${profile.shaderPack}/${pixel}`;
        for (const file of pairedWriterFiles(fogPack)) paths.add(`${writer}/${file}`);
    }
    return [...paths];
}

/**
 * Runs after every shader install. Shadow and glow are independent:
 * Shadow controls Fog, glow controls Bloom/Blur, and HDR controls tonemap independently.
 */
async function resolveFogSources(
    quenchingDir: string,
    profile: FogProfile,
    modSettings: any,
): Promise<{ variant: string | null; sources: FogSource[] }> {
    assertShaderProfileSupported(profile);
    const modeFolder = shaderMaterialMode(profile, modSettings?.lighting);
    const pixel = shaderPixelFolder(profile, modSettings?.lighting);
    const hdSource = resourcePath(quenchingDir, 'shaders', profile.shaderPack, pixel, 'hd.bls');
    const hdSources = supportsReadability(profile) && modSettings?.objectShader !== false && modSettings?.improveReadability !== undefined
        ? [{ file: 'hd.bls', source: hdSource }] : [];
    if (modSettings?.postProcessing === false) {
        for (const { source } of hdSources) if (!await fs.pathExists(source)) throw new Error(`Shader resource missing: ${source}`);
        return { variant: null, sources: hdSources };
    }
    const variant = pickFogVariant(profile, modSettings?.lighting, modSettings?.lightingBrightness, modSettings?.postProcessingOutline);
    if (!variant) return { variant, sources: [] };
    const fogPack = profile.shaderPack === 'shaders-300-legacy-hd' ? 'fog_shaders-legacy'
        : profile.ptrShaderCompatibility?.status === 'supported' ? profile.ptrShaderCompatibility.fogShaderPack : 'fog_shaders';
    const sourceDir = resourcePath(quenchingDir, 'shaders', fogPack, variant, 'ps');
    const sources = [...hdSources, ...FOG_FILES.map(file => ({ file, source: path.join(sourceDir, file) }))];
    if (supportsReadability(profile) && readabilityEnabled(modSettings)) {
        const resources = resourcePath(quenchingDir, 'shaders', 'readability-301');
        const index = await fs.readJson(path.join(resources, 'profiles.json'));
        const profileKey = readabilityProfileKey(profile, modSettings?.lighting, variant!);
        const entry = index.profiles?.[profileKey];
        if (index.schema !== 1 || !entry || entry.mode !== modeFolder) throw new Error('Readability shader profile is missing');
        // The shared extension may only accompany the exact independent base HD
        // it was built against, including PTR. Never substitute Retail base files.
        const digest = createHash('sha256').update(await fs.readFile(hdSource)).digest('hex');
        if (digest !== entry.baseHdSha256) throw new Error('Readability resources do not match the selected shader pack');
        sources.splice(0, sources.length, ...['hd.bls', ...FOG_FILES].map(file => ({
            file, source: path.join(resources, profileKey, 'ps', file),
        })));
    }
    if (supportsFogProfiles(profile)) {
        const writerDir = modSettings?.objectShader === false
            ? resourcePath(quenchingDir, 'shaders', fogPack, 'identity_writers', 'ps')
            : resourcePath(quenchingDir, 'shaders', profile.shaderPack, pixel);
        for (const file of pairedWriterFiles(fogPack)) {
            // Keep the selected readability HD writer; refresh the remaining
            // carriers even when the material pack was already installed.
            if (sources.some(entry => entry.file === file)) continue;
            const source = path.join(writerDir, file);
            // Current fog requires both identity producers even with enhanced
            // materials disabled; a missing producer must reject the whole pair.
            sources.push({ file, source });
        }
    }
    // Upgrade producers even when an older installation has the same pack marker.
    // Verify the complete pair before touching any installed file.
    for (const { source } of sources) {
        if (!await fs.pathExists(source)) throw new Error(`Fog shader missing (paired resource): ${source}`);
    }
    return { variant, sources };
}

async function applyResolvedPostProcessing(shadersDir: string, modSettings: any, { variant, sources }: Awaited<ReturnType<typeof resolveFogSources>>) {
    if (modSettings?.postProcessing === false) {
        for (const file of POST_PROCESSING_SHADOW_FILES) await fs.remove(path.join(shadersDir, file));
    }
    if (modSettings?.postProcessingGlow === false) {
        for (const file of POST_PROCESSING_GLOW_FILES) await fs.remove(path.join(shadersDir, file));
    }
    for (const { file, source } of sources) await copyBundledResourceIfChanged(source, path.join(shadersDir, 'ps', file));
    if (variant) console.log(`[Shader] Fog override: ${variant}`);
}

export async function applyPostProcessingShaders(shadersDir: string, quenchingDir: string, profile: FogProfile, modSettings: any): Promise<void> {
    await applyResolvedPostProcessing(shadersDir, modSettings, await resolveFogSources(quenchingDir, profile, modSettings));
}

/** After a full shader reinstall: re-apply the object shader and post-processing switches. */
export async function applyShaderToggles(
    shadersDir: string,
    quenchingDir: string,
    profile: FogProfile,
    modSettings: any,
): Promise<void> {
    const apply = await prepareShaderToggles(quenchingDir, profile, modSettings);
    await apply(shadersDir);
}

/** Resolve/validate once before an effect installer touches the active files. */
export async function prepareShaderToggles(
    quenchingDir: string,
    profile: FogProfile,
    modSettings: any,
): Promise<(shadersDir: string) => Promise<void>> {
    // Check all paired inputs before deleting a disabled object shader.
    const resolved = await resolveFogSources(quenchingDir, profile, modSettings);
    const enableHdr = supportsHdr(profile) && hdrEnabled(modSettings);
    const hdrSource = resourcePath(quenchingDir, 'shaders', profile.shaderPack, shaderPixelFolder(profile, modSettings?.lighting), 'tonemap.bls');
    if (enableHdr && !await fs.pathExists(hdrSource)) throw new Error(`HDR shader missing: ${hdrSource}`);
    return async shadersDir => {
        if (modSettings?.objectShader === false) {
            for (const file of OBJECT_SHADER_FILES) await fs.remove(path.join(shadersDir, file));
        }
        await applyResolvedPostProcessing(shadersDir, modSettings, resolved);
        if (enableHdr) await copyBundledResourceIfChanged(hdrSource, path.join(shadersDir, HDR_SHADER_FILES[0]));
        else await fs.remove(path.join(shadersDir, HDR_SHADER_FILES[0]));
    };
}
