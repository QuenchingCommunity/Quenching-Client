import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import fs from 'fs-extra';
import path from 'node:path';
import { installBundledResourceFile } from './managed-resource-files';

const WEBUI_MARKER = '.quenching-webui-files';

/**
 * WebUI is shipped and versioned by the client, not selected by a MOD profile.
 * Always replace the two known client-owned paths while leaving unrelated
 * WebUI files untouched.
 */
export async function syncClientWebUIFiles(
  targetWebUIDir: string,
  quenchingDir: string,
  language: string,
): Promise<void> {
  const imageName = language === 'zh-CN' ? 'QuenchingOnCN.png' : 'QuenchingOnEN.png';
  const imageSource = resourcePath(quenchingDir, 'tx', imageName);
  const indexSource = path.join(quenchingDir, 'index.html');

  for (const source of [imageSource, indexSource]) {
    if (!(await fs.pathExists(source))) throw new Error(`Required client WebUI asset is missing: ${source}`);
  }

  await fs.ensureDir(targetWebUIDir);
  await installBundledResourceFile(
    targetWebUIDir,
    'QuenchingOn.png',
    imageSource,
    ['QuenchingOnCN.png', 'QuenchingOnEN.png'].map(name => resourcePath(quenchingDir, 'tx', name)),
    WEBUI_MARKER,
  );
  await installBundledResourceFile(
    targetWebUIDir,
    'index.html',
    indexSource,
    [indexSource],
    WEBUI_MARKER,
  );
}
