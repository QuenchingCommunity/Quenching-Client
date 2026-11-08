import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createPortable7z, run7z } from './lib/portable-7z.mjs';
import { createPortableZip } from './lib/portable-zip.mjs';
import { checkClientPackage } from './check-client-package.mjs';
import { preparePortableChannel, PORTABLE_TEST_MARKER } from './portable-release-channel.mjs';
import { RESOURCE_ARCHIVES } from '../src/shared/bundled-resource-paths.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const repo = path.resolve(import.meta.dirname, '..');
const source = path.resolve(repo, process.argv[2] || '__Bin/win-unpacked');
const output = path.resolve(repo, process.argv[3] || '__Bin/QMC-Win-test.zip');
const format=path.extname(output).toLowerCase();
assert(['.zip','.7z'].includes(format),'Portable output must be ZIP (or explicit historical 7z)');
const zipRoot = process.argv[4] || 'QMC-Win-test';
const option = name => { const i = process.argv.indexOf(name); if (i < 0) return undefined; const value = process.argv[i + 1]; assert(value && !value.startsWith('--'), `Missing ${name} value`); return value; };
const channel = option('--channel') || 'test';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const forbidden = name => /(?:^|[/\\])(?:_irys|\.git|\.env(?:\.[^/\\]*)?)(?:[/\\]|$)/i.test(name);

assert(await fs.pathExists(path.join(source, 'QMClient.exe')), 'Windows portable client is missing');
assert(!(await fs.pathExists(output)), 'Output archive already exists; do not overwrite another export');
const channelRecord = await preparePortableChannel(source, { channel, baseUrl: option('--test-base') });
const archivePath = path.join(source, 'resources', 'app.asar');
const packedMain = asar.extractFile(archivePath, 'dist/main.js');
assert.equal(sha(packedMain), sha(await fs.readFile(path.join(repo, 'dist/main.js'))), 'Portable main bundle differs from latest build');
for (const entry of asar.listPackage(archivePath)) assert(!forbidden(entry), `Private path in app.asar: ${entry}`);
for (const entry of await fs.readdir(source, { recursive: true })) assert(!forbidden(entry), `Private path in portable client: ${entry}`);
const resourceManifest = await fs.readJson(path.join(source, 'resources/assets/quenching/resources.manifest.json'));
assert.equal(resourceManifest.schema, 3, 'Resource shard manifest schema');
assert(resourceManifest.packages?.['zip-ui-30.zip'], 'Bundled UI group is missing');
for (const name of RESOURCE_ARCHIVES) {
  const resourceArchive = path.join(source, 'resources/assets/quenching', name);
  const record=resourceManifest.archives[name];assert.equal(record?.name,name);
  const resourceHash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(resourceArchive)) resourceHash.update(bytes);
  assert.equal(resourceHash.digest('hex'), record.sha256, 'Bundled resource archive mismatch: '+name);
  assert.equal((await fs.stat(resourceArchive)).size, record.size);
}
assert(!await fs.pathExists(path.join(source,'resources/assets/quenching/resources.7z')),'Obsolete monolithic resource archive shipped');
assert(!await fs.pathExists(path.join(source, 'resources/assets/unpacked')), 'Raw source must not be shipped');
console.log(JSON.stringify(await checkClientPackage(source)));
console.log('Verified latest main bundle, bundled UI assets, and absence of .env/_irys/.git');

await fs.ensureDir(path.dirname(output));
const entries = await (format==='.zip'?createPortableZip:createPortable7z)(source, output, zipRoot);
for (const entry of entries) assert(!forbidden(entry), 'Private path in archive: '+entry);
for (const required of ['QMClient.exe', 'resources/app.asar', ...RESOURCE_ARCHIVES.map(name=>'resources/assets/quenching/'+name), 'resources/assets/quenching/resources.manifest.json', ...(channel === 'test' ? [PORTABLE_TEST_MARKER] : [])]) assert(entries.includes(zipRoot+'/'+required), 'Missing 7z member: '+required);
if(channel==='production') assert(!entries.includes(zipRoot+'/'+PORTABLE_TEST_MARKER));
const packedHash=crypto.createHash('sha256');
await run7z(['x','-so',output,zipRoot+'/resources/app.asar'],{onData:bytes=>packedHash.update(bytes)});
assert.equal(packedHash.digest('hex'), sha(await fs.readFile(archivePath)), 'Archived app.asar differs from packaged client');

const hash = crypto.createHash('sha256');
for await (const bytes of fs.createReadStream(output)) hash.update(bytes);
console.log(JSON.stringify({ archive: output, bytes: (await fs.stat(output)).size, entries: entries.length, sha256: hash.digest('hex'), ...channelRecord }, null, 2));
