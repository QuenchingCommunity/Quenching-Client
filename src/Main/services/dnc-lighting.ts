import fs from 'fs-extra';
import path from 'path';
import { applyUnitLightAngle } from '../../shared/dnc-rotation';

/** 向上查找当前行是否位于指定 MDL 动画块内（如 Rotation N） */
function isInsideMdlBlock(lines: string[], lineIndex: number, headerPattern: RegExp): boolean {
    for (let j = lineIndex - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        const prevLower = prev.toLowerCase();
        if (headerPattern.test(prevLower)) {
            return true;
        }
        if (prev.includes('}')) {
            break;
        }
        if (prev.includes('{') && !headerPattern.test(prevLower)) {
            break;
        }
    }
    return false;
}

const ROTATION_HEADER = /^rotation\s+\d+\b/;
const INTENSITY_HEADER = /^intensity\b/;

/** 3.x templates contain finalized level-3 values, with 15% steps relative to that baseline. */
const LIGHTING_BRIGHTNESS_MULTIPLIERS: readonly number[] = [0.7, 0.9, 1.1, 1.3, 1.5];

export function normalizeBrightnessLevel(level: unknown): number {
    const n = typeof level === 'number' ? level : parseInt(String(level), 10);
    if (n >= 1 && n <= 5) return n;
    return 3;
}

export function getBrightnessMultiplier(level: unknown, mode?: string, options?: DncLightingOptions): number {
    const normalized = normalizeBrightnessLevel(level);
    return options?.isVersion30 ? Math.round((1 + (normalized - 3) * 0.15) * 100) / 100 : LIGHTING_BRIGHTNESS_MULTIPLIERS[normalized - 1];
}

export function getAmbientBrightnessOffset(level: unknown, mode?: string): number {
    return Math.round(((normalizeBrightnessLevel(level) - 3) * 0.015 +
        (mode === 'battle' || mode === 'melee' ? 0.04 : 0)) * 1000000) / 1000000;
}

function transformScalarField(content: string, field: string, factor: number, offset: number): string {
    if (factor === 1 && offset === 0) return content;
    const scalar = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
    const transform = (value: string, shift = offset) => String(Math.round((Number(value) * factor + shift) * 1000000) / 1000000);
    let result = content.replace(new RegExp(`(^[\\t ]*static\\s+${field}\\s+)(${scalar})`, 'gmi'),
        (_match, prefix, value) => prefix + transform(value));
    result = result.replace(new RegExp(`(^[\\t ]*${field}\\s+\\d+\\s*\\{)([^{}]*)(\\})`, 'gmi'),
        (_match, header, body: string, end) => {
            const keys = body.replace(new RegExp(`(^[\\t ]*\\d+\\s*:\\s*)(${scalar})`, 'gmi'),
                (_key, prefix, value) => prefix + transform(value));
            return header + keys.replace(new RegExp(`(^[\\t ]*(?:InTan|OutTan)\\s+)(${scalar})`, 'gmi'),
                (_key, prefix, value) => prefix + transform(value, /\bBezier\s*,/i.test(body) ? offset : 0)) + end;
        });
    return result;
}

export function applyFinalizedDncBrightness(content: string, level: unknown, mode?: string): string {
    const ambient = transformScalarField(content, 'AmbIntensity', 1, getAmbientBrightnessOffset(level, mode));
    return transformScalarField(ambient, 'Intensity', getBrightnessMultiplier(level, mode, { isVersion30: true }), 0);
}

function formatIntensityValue(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
}

function scaleIntensityKeyframeLine(line: string, multiplier: number): string {
    const match = line.trim().match(/^(\d+):\s*([\d.-]+),?$/);
    if (!match) return line;
    const indent = line.match(/^(\t*)/)?.[1] ?? '\t\t';
    const scaled = parseFloat(match[2]) * multiplier;
    return `${indent}${match[1]}: ${formatIntensityValue(scaled)},`;
}

/** 将所有 Intensity（static 与关键帧）乘以亮度系数 */
export function applyBrightnessToIntensity(lines: string[], multiplier: number): boolean {
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lowerLine = line.toLowerCase();

        if (lowerLine.startsWith('static intensity')) {
            const match = line.match(/static Intensity\s+([\d.-]+)/i);
            if (match) {
                const scaled = parseFloat(match[1]) * multiplier;
                const newVal = `\tstatic Intensity ${formatIntensityValue(scaled)},`;
                if (lines[i] !== newVal) {
                    lines[i] = newVal;
                    modified = true;
                }
            }
            continue;
        }

        const intensityMatch = line.match(/^(\d+):\s*([\d.-]+),?$/);
        if (intensityMatch && isInsideMdlBlock(lines, i, INTENSITY_HEADER)) {
            const newLine = scaleIntensityKeyframeLine(lines[i], multiplier);
            if (newLine !== lines[i]) {
                lines[i] = newLine;
                modified = true;
            }
        }
    }

    return modified;
}

type DncCategory = 'surface' | 'underground';

/** 地表 unit 基准（dnclordaeronunit.mdl） */
const SURFACE_UNIT_BASELINE = {
    ambIntensity: -0.12,
    rotation: { x: 0.25, y: 0.25, z: 0.65, w: 0 },
    intensityKeyframes: [
        '\t\t0: 4,',
        '\t\t14000: 4.5,',
        '\t\t16000: 5,',
        '\t\t44000: 5,',
        '\t\t45000: 6,',
        '\t\t46000: 4.5,',
    ],
    ambColorKeyframes: ['\t\t0:  { 1, 1, 1 },'],
};

/** 地表 terrain 基准（dnclordaeronterrain.mdl）；相对原基准 Intensity 全量 +0.6 */
const SURFACE_TERRAIN_BASELINE = {
    ambIntensity: -0.12,
    rotation: { x: 0.2, y: 0.2, z: 0.5, w: 0 },
    intensityKeyframes: [
        '\t\t0: 4.10,',
        '\t\t14000: 5.10,',
        '\t\t16000: 5.10,',
        '\t\t44000: 5.10,',
        '\t\t45000: 5.60,',
        '\t\t46000: 4.10,',
    ],
    ambColorKeyframes: SURFACE_UNIT_BASELINE.ambColorKeyframes,
};

/**
 * 地表：dnclordaeron 等（zip-env 内多数 DNC 集）
 * 地下：仅 dncunderground / dncdungeon
 */
function getDncCategory(filePath: string): DncCategory {
    const parts = filePath.replace(/\\/g, '/').toLowerCase().split('/');
    const dncIdx = parts.lastIndexOf('dnc');
    if (dncIdx >= 0 && dncIdx + 1 < parts.length) {
        const setName = parts[dncIdx + 1];
        if (setName === 'dncunderground' || setName === 'dncdungeon') {
            return 'underground';
        }
    }
    return 'surface';
}

function getTargetAmbIntensity(category: DncCategory, mode: string): number | null {
    if (mode === 'standard' || mode === 'enhanced') {
        return null;
    }
    if (category === 'surface') {
        if (mode === 'battle') return 0.1;
        if (mode === 'rpg') return -0.12;
    } else {
        if (mode === 'battle') return 0.1;
        if (mode === 'rpg') return -0.2;
    }
    return null;
}

/** 地表 unit 对战光照方向 */
function getSurfaceUnitBattleRotation(): { x: number; y: number; z: number; w: number } {
    return { x: 0.14, y: 0.14, z: 0.7, w: 0 };
}

function formatRotationKeyframe(time: string, quat: { x: number; y: number; z: number; w: number }): string {
    return `\t\t${time}: { ${quat.x}, ${quat.y}, ${quat.z}, ${quat.w} },`;
}

function replaceMdlAnimatedBlock(
    lines: string[],
    headerPattern: RegExp,
    keyframes: string[]
): boolean {
    for (let i = 0; i < lines.length; i++) {
        if (!headerPattern.test(lines[i].trim())) {
            continue;
        }

        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() === '}') {
                end = j;
                break;
            }
        }

        const interpLine = lines[i + 1]?.includes('Linear') ? lines[i + 1] : '\t\tLinear,';
        const replacement = [lines[i], interpLine, ...keyframes, lines[end]];
        lines.splice(i, end - i + 1, ...replacement);
        return true;
    }
    return false;
}

function applySurfaceBaseline(lines: string[], isUnit: boolean): boolean {
    const baseline = isUnit ? SURFACE_UNIT_BASELINE : SURFACE_TERRAIN_BASELINE;
    let modified = false;

    if (replaceMdlAnimatedBlock(lines, /^Intensity\s+\d+\s*\{/, baseline.intensityKeyframes)) {
        modified = true;
    }
    if (replaceMdlAnimatedBlock(lines, /^AmbColor\s+\d+\s*\{/, baseline.ambColorKeyframes)) {
        modified = true;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lowerLine = line.toLowerCase();

        if (lowerLine.startsWith('static ambintensity')) {
            const newVal = `\tstatic AmbIntensity ${baseline.ambIntensity.toFixed(2)},`;
            if (lines[i] !== newVal) {
                lines[i] = newVal;
                modified = true;
            }
        }

        const rotationMatch = line.match(/^(\d+):\s*\{\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\},?$/);
        if (rotationMatch && isInsideMdlBlock(lines, i, ROTATION_HEADER)) {
            const newVal = formatRotationKeyframe(rotationMatch[1], baseline.rotation);
            if (lines[i].trim() !== newVal.trim()) {
                lines[i] = newVal;
                modified = true;
            }
        }
    }

    return modified;
}

export interface DncLightingOptions {
    deMode?: boolean;
    isVersion30?: boolean;
    unitLightAngle?: number;
}

/** Applied to freshly restored terrain models; other modes keep their source rotation. */
function applyBattleTerrainRotation(content: string, filePath: string, mode: string): string {
    const name = path.basename(filePath).toLowerCase();
    if (!['battle', 'melee'].includes(mode) || !name.includes('terrain') || name.includes('unit')) return content;
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    return content.replace(/^([\t ]*)Rotation\s+\d+\s*\{[^\r\n]*\r?\n[\s\S]*?^[\t ]*\}/gm,
        (_block, indent) => [`${indent}Rotation 1 {`, `${indent}\tDontInterp,`,
            `${indent}\t0: { 0.25, 0.25, 0.75, 0 },`, `${indent}}`].join(newline));
}

/** Pure transform, also used to recover the current profile's rotation on disable. */
export function renderDncLighting(content: string, filePath: string, mode: string, brightness: unknown, options: DncLightingOptions): string {
    if (mode === 'rpg') mode = 'standard';
    const brightnessLevel = normalizeBrightnessLevel(brightness);
    const finish = (text: string) => {
        const name=path.basename(filePath).toLowerCase();
        return name.includes('unit') && !name.includes('terrain') ? applyUnitLightAngle(text, options.unitLightAngle) : text;
    };
    if (options.isVersion30) {
        return finish(applyBattleTerrainRotation(applyFinalizedDncBrightness(content, brightnessLevel, mode), filePath, mode));
    }
    const lines = content.split(/\r?\n/);
    let modified = false;

    const category = getDncCategory(filePath);
    const lowerName = path.basename(filePath).toLowerCase();
    const isUnit = lowerName.includes('unit');
    const isTerrain = lowerName.includes('terrain');
    const targetAmb = getTargetAmbIntensity(category, mode);

    if (category === 'surface' && !options.deMode && !options.isVersion30) {
        const useUnitBaseline = isUnit && !isTerrain;
        const useTerrainBaseline = isTerrain && !isUnit;
        if ((useUnitBaseline || useTerrainBaseline) && applySurfaceBaseline(lines, useUnitBaseline)) {
            modified = true;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lowerLine = line.toLowerCase();

        if (lowerLine.startsWith('static ambintensity') && targetAmb !== null) {
            const newVal = `\tstatic AmbIntensity ${targetAmb.toFixed(2)},`;
            if (lines[i] !== newVal) {
                lines[i] = newVal;
                modified = true;
            }
        }

        const rotationMatch = line.match(/^(\d+):\s*\{\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\},?$/);
        if (rotationMatch && !options.deMode && !options.isVersion30 && category === 'surface' && isUnit && !isTerrain && mode === 'battle') {
            if (isInsideMdlBlock(lines, i, ROTATION_HEADER)) {
                const newVal = formatRotationKeyframe(rotationMatch[1], getSurfaceUnitBattleRotation());
                if (lines[i].trim() !== newVal.trim()) {
                    lines[i] = newVal;
                    modified = true;
                }
            }
        }
    }

    if (applyBrightnessToIntensity(lines, getBrightnessMultiplier(brightnessLevel, mode, options))) {
        modified = true;
    }

    return finish(applyBattleTerrainRotation(modified ? lines.join('\n') : content, filePath, mode));
}

async function patchDncMdlFile(filePath: string, mode: string, brightnessLevel: number, options: DncLightingOptions) {
    const content = await fs.readFile(filePath, 'utf-8');
    const result = renderDncLighting(content, filePath, mode, brightnessLevel, options);
    if (result !== content) await fs.writeFile(filePath, result, 'utf-8');
}

async function listMdlFiles(dir: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...await listMdlFiles(full));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mdl')) found.push(full);
    }
    return found;
}

/** Patch a freshly restored DNC directory for the lighting mode and brightness level. */
export async function applyDncLighting(dncDir: string, mode: string, brightnessLevel: unknown, options: DncLightingOptions, onProgress?: (completed: number, total: number) => void): Promise<void> {
    if (!(await fs.pathExists(dncDir))) return;
    if (mode === 'rpg') mode = 'standard'; // RPG changes materials and shares the finalized Standard DNC baseline.
    const level = normalizeBrightnessLevel(brightnessLevel);
    const files = await listMdlFiles(dncDir);
    onProgress?.(0, files.length);
    for (const [index, file] of files.entries()) {
        await patchDncMdlFile(file, mode, level, options);
        onProgress?.(index + 1, files.length);
    }
}
