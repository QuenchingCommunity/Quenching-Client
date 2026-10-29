import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { syncClientWebUIFiles } from '../src/Main/services/webui-assets-service';

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-webui-sync-'));
  try {
    const quenching = path.join(root, 'assets', 'quenching');
    const target = path.join(root, '_retail_', 'webui');
    await fs.outputFile(resourcePath(quenching, 'tx', 'QuenchingOnCN.png'), 'versionless-cn');
    await fs.outputFile(resourcePath(quenching, 'tx', 'QuenchingOnEN.png'), 'versionless-en');
    await fs.outputFile(path.join(quenching, 'index.html'), '<html>3.5</html>');
    await fs.outputFile(path.join(target, 'QuenchingOn.png'), '3.4');
    await fs.outputFile(path.join(target, 'custom-player-file.txt'), 'keep');

    await syncClientWebUIFiles(target, quenching, 'zh-CN');
    assert.equal(await fs.readFile(path.join(target, 'QuenchingOn.png'), 'utf8'), 'versionless-cn');
    assert.equal(await fs.readFile(path.join(target, 'index.html'), 'utf8'), '<html>3.5</html>');
    assert.equal(await fs.readFile(path.join(target, 'custom-player-file.txt'), 'utf8'), 'keep');

    await syncClientWebUIFiles(target, quenching, 'en-US');
    assert.equal(await fs.readFile(path.join(target, 'QuenchingOn.png'), 'utf8'), 'versionless-en');
    assert.equal(await fs.readFile(path.join(target, 'custom-player-file.txt'), 'utf8'), 'keep');
    console.log('WebUI asset sync test passed');
  } finally {
    await fs.remove(root);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
