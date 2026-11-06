import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function setBuildChannel(channel, root = path.resolve('.')) {
  if (!['production', 'test'].includes(channel)) throw new Error('Build channel must be production or test');
  const file = path.join(root, 'release-version.json');
  const release = JSON.parse(await fs.readFile(file, 'utf8'));
  const result = {...release, channel};
  await fs.writeFile(file, JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await setBuildChannel(process.argv[2])));
}
