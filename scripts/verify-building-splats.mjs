import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Capture-confirmed HD building splat and its 3.01 second-bank variant.
// Pin the approved decal programs so even a consistently rebuilt pack cannot
// accidentally apply the general HD material or cloud lighting pass to them.
const approved = new Map([
  [448, '0f7ab01d2a85d713581babfcf9cf034037a542b039cde3c6e0947fa1b01eebd4'],
  [1472, '87067ebd085d08bc3c40cd9ebb9bae1a92171f4f46addb018556dc557558ea78'],
]);

export function verifyBuildingSplatShader(data, label) {
  const start = 24 + 2048 * 4;
  if (data.length < start || data.toString('ascii', 0, 4) !== 'HSXG' ||
      data.readUInt32LE(12) !== 2048 || data.readUInt32LE(16) !== start) {
    throw new Error(`Unsupported HD building-splat layout in ${label}`);
  }
  for (const [index, expected] of approved) {
    const blobStart = start + data.readUInt32LE(24 + (index - 1) * 4) + 80;
    const end = start + data.readUInt32LE(24 + index * 4);
    const blob = data.subarray(blobStart, end);
    if (end > data.length || blob.toString('ascii', 0, 4) !== 'DXBC' ||
        createHash('sha256').update(blob).digest('hex') !== expected) {
      throw new Error(`Building splat ${index} in ${label} differs from the protected decal program`);
    }
  }
}

export async function verifyBuildingSplats(shaderRoot) {
  const files = ['standard', 'rpg', 'melee'].map(mode => `shaders-300-hd/ps/${mode}/hd.bls`);
  for (const key of ['ao_080', 'ao_066', 'rpg_ao_080']) {
    files.push(`readability-301/${key}/ps/hd.bls`, `readability-301/${key}_outline/ps/hd.bls`);
  }
  for (const file of files) verifyBuildingSplatShader(await fs.readFile(path.join(shaderRoot, file)), file);
  return { files: files.length, protectedVariants: [...approved.keys()] };
}
