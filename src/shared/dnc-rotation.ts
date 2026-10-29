/** Warcraft MDL uses XYZW quaternions; light direction is rotated local +Z.
 * Same convention as the existing offline quaternion-light inspector.
 */
export type LightQuaternion = [number, number, number, number];
export interface LightRotationKey { frame: number; value: readonly number[] }
export const ROTATING_LIGHT_START = Object.freeze([0.25, 0.25, 0.7, 0]);
export const ROTATING_LIGHT_START_HOUR = 6;

export function normalizeLightQuaternion(value: readonly number[]): LightQuaternion {
  const length = Math.hypot(...value);
  if (value.length !== 4 || !value.every(Number.isFinite) || length < 1e-12) throw new Error('Invalid light quaternion');
  return value.map(component => component / length) as LightQuaternion;
}

export function lightDirection(value: readonly number[]): [number, number, number] {
  const [x, y, z, w] = normalizeLightQuaternion(value);
  return [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}

function slerp(left: readonly number[], right: readonly number[], amount: number): LightQuaternion {
  const a = normalizeLightQuaternion(left);
  let b = normalizeLightQuaternion(right);
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  if (dot < 0) { b = b.map(value => -value) as LightQuaternion; dot = -dot; }
  if (dot > 0.9995) return normalizeLightQuaternion(a.map((value, i) => value + (b[i] - value) * amount));
  const angle = Math.acos(Math.min(1, dot));
  return normalizeLightQuaternion(a.map((value, i) =>
    (value * Math.sin((1 - amount) * angle) + b[i] * Math.sin(amount * angle)) / Math.sin(angle)));
}

function multiply(a: readonly number[], b: readonly number[]): LightQuaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function validateUnitLightAngle(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 360) throw new Error('Invalid unit lighting angle');
  return value;
}

/** Absolute world azimuth, preserving elevation and local roll. */
export function lightQuaternionAtAzimuth(value: readonly number[], degrees: number): LightQuaternion {
  const direction=lightDirection(value);
  const yaw=validateUnitLightAngle(degrees)*Math.PI/180-Math.atan2(direction[1],direction[0]);
  return normalizeLightQuaternion(multiply([0,0,Math.sin(yaw/2),Math.cos(yaw/2)],normalizeLightQuaternion(value)));
}

/** Shift a normal units track so its 06:00 direction matches the selected angle. */
export function applyUnitLightAngle(content: string, degrees: number | undefined): string {
  if(degrees===undefined)return content;
  validateUnitLightAngle(degrees);
  const interval=content.match(/\bInterval\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}/);
  const range=interval?[Number(interval[1]),Number(interval[2])]:[0,60000];
  const scalar='[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
  const pattern=new RegExp(`(^[\\t ]*)(\\d+):\\s*\\{\\s*(${scalar}),\\s*(${scalar}),\\s*(${scalar}),\\s*(${scalar})\\s*\\}`, 'gm');
  return content.replace(/^[\t ]*Rotation\s+\d+\s*\{[^\r\n]*\r?\n[\s\S]*?^[\t ]*\}/gm, block=>{
    const keys=[...block.matchAll(pattern)].map(m=>({frame:Number(m[2]),value:m.slice(3,7).map(Number)}));
    if(!keys.length)throw new Error('Unit lighting rotation has no keys');
    const anchor=keys.length===1?keys[0].value:sampleReference(keys,range,ROTATING_LIGHT_START_HOUR/24);
    const direction=lightDirection(anchor),yaw=degrees*Math.PI/180-Math.atan2(direction[1],direction[0]);
    const turn=[0,0,Math.sin(yaw/2),Math.cos(yaw/2)];
    return block.replace(pattern,(_m,indent,frame,...values)=>{
      const result=normalizeLightQuaternion(multiply(turn,normalizeLightQuaternion(values.slice(0,4).map(Number))));
      return `${indent}${frame}: { ${result.join(', ')} }`;
    });
  });
}

function directionQuaternion(direction: readonly number[]): LightQuaternion {
  return direction[2] <= -1 + 1e-12 ? [1, 0, 0, 0] : normalizeLightQuaternion([
    -direction[1], direction[0], 0, 1 + direction[2],
  ]);
}

function sampleReference(keys: readonly LightRotationKey[], interval: readonly number[], phase: number): LightQuaternion {
  if (phase === 1) return normalizeLightQuaternion(keys[0].value);
  const frame = interval[0] + phase * (interval[1] - interval[0]);
  const next = keys.findIndex(key => key.frame > frame);
  const left = next < 0 ? keys[keys.length - 1] : keys[Math.max(0, next - 1)];
  const right = next < 0 ? { frame: interval[1], value: keys[0].value } : keys[next];
  return slerp(left.value, right.value, right.frame === left.frame ? 0 : (frame - left.frame) / (right.frame - left.frame));
}

/** Full azimuth orbit, retaining the reference DE elevation changes relative
 * to the user-selected starting orientation.
 * Copying DE keys alone gives ~8 degrees of azimuth change, not a full orbit.
 * Intermediate keys are essential: start/end represent the same orientation,
 * so a two-key SLERP would otherwise produce a stationary light.
 */
export function buildRotatingLightTrack(
  reference: readonly LightRotationKey[], sourceInterval: readonly number[], targetInterval: readonly number[],
  unitLightAngle?: number,
): LightRotationKey[] {
  const validInterval = (range: readonly number[]) => range.length === 2 && range.every(Number.isSafeInteger) && range[1] > range[0];
  if (!validInterval(sourceInterval) || !validInterval(targetInterval) || reference.length < 2 ||
      reference[0].frame !== sourceInterval[0] || reference.some((key, index) =>
        !Number.isSafeInteger(key.frame) || key.frame < sourceInterval[0] || key.frame > sourceInterval[1] ||
        (index > 0 && key.frame <= reference[index - 1].frame))) throw new Error('Invalid DNC rotation reference');
  reference.forEach(key => normalizeLightQuaternion(key.value));
  const [start, end] = targetInterval;
  const duration = end - start;
  const startPhase = ROTATING_LIGHT_START_HOUR / 24;
  const wrapPhase = (phase: number) => (phase % 1 + 1) % 1;
  const initial = unitLightAngle === undefined ? normalizeLightQuaternion(ROTATING_LIGHT_START)
    : lightQuaternionAtAzimuth(ROTATING_LIGHT_START, unitLightAngle);
  const firstDirection = lightDirection(initial);
  const firstAzimuth = Math.atan2(firstDirection[1], firstDirection[0]);
  const firstElevation = Math.asin(firstDirection[2]);
  const referenceElevation = Math.asin(lightDirection(reference[0].value)[2]);
  const minimalStart = directionQuaternion(firstDirection);
  // Keep the user's full starting orientation, including roll. A fixed local
  // roll does not change the light direction or introduce an end-of-cycle flip.
  const roll = multiply([-minimalStart[0], -minimalStart[1], -minimalStart[2], minimalStart[3]], initial);
  const frames = new Set([start, end]);
  // 7.5-degree sampling bounds interpolation error while keeping files small.
  for (let i = 1; i < 48; i++) frames.add(start + Math.round(duration * i / 48));
  for (const key of reference) frames.add(start + Math.round(wrapPhase(
    (key.frame - sourceInterval[0]) / (sourceInterval[1] - sourceInterval[0]) + startPhase,
  ) * duration));
  const keys = [...frames].sort((a, b) => a - b).map(frame => {
    // DNC Interval starts at midnight; the selected orientation belongs to 06:00.
    // Move the whole orbit/elevation curve, rather than starting at enable time.
    const phase = wrapPhase((frame - start) / duration - startPhase);
    const direction = lightDirection(sampleReference(reference, sourceInterval, phase));
    const elevation = firstElevation + Math.asin(Math.max(-1, Math.min(1, direction[2]))) - referenceElevation;
    const height = Math.sin(elevation);
    const horizontal = Math.cos(elevation);
    const azimuth = firstAzimuth + phase * Math.PI * 2;
    const value = normalizeLightQuaternion(multiply(directionQuaternion([
      horizontal * Math.cos(azimuth), horizontal * Math.sin(azimuth), height,
    ]), roll));
    return { frame, value };
  });
  keys.find(key => key.frame === start + Math.round(duration * startPhase))!.value = initial;
  keys[keys.length - 1].value = [...keys[0].value]; // midnight seam, not the 06:00 anchor
  return keys;
}
