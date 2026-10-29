import fs from 'fs-extra';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractArchive } from './archive-extraction';
import { withResourceDirectory } from './resource-directory-queue';
import { RESOURCE_ARCHIVE, RESOURCE_ARCHIVES, RESOURCE_MANIFEST, registerResourceRoot, resourceSourceAlias } from '../../shared/bundled-resource-paths.mjs';

interface FileRecord { size: number; sha256: string; archive?: string }
interface ArchiveRecord { name: string; size: number; sha256: string; id?: string }
export interface BundleManifest {
  schema: number; id: string; files: Record<string, FileRecord>; packages: Record<string, string>;
  archive?: ArchiveRecord;
  archives?: Record<string, ArchiveRecord>;
}
interface CacheState { schema: number; id: string; legacyId?: string; files: Record<string, { size: number; mtimeMs: number; ctimeMs?: number; sha256?: string }> }
interface PrepareOptions {
  cacheBase: string; preferLoose?: boolean; required?: boolean; selections?: string[];
  sharedCache?: boolean; verification?: 'strict' | 'light';
  startup?: boolean;
  onPreparation?: (firstRun: boolean) => void;
  onProgress?: (percent: number) => void;
}
const contexts = new Map<string, { assets: string; options: PrepareOptions }>();
export const hasResourceContext = (quenching: string): boolean => contexts.has(path.resolve(quenching));
const verifiedArchives = new Map<string, string>();
const manifests = new Map<string, { stamp: string; value: BundleManifest }>();
let startupBarrier:Promise<void>|null=null;
export function deferBundledResourcePreparation(until:Promise<void>):void {
  startupBarrier=until;
  void until.then(()=>{if(startupBarrier===until)startupBarrier=null;});
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function safeRelative(name: string): boolean {
  return !!name && !name.includes('\\') && !/[\x00-\x1f]/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'));
}
export function validateResourceManifest(value: BundleManifest): void {
  if (![2, 3].includes(value?.schema) || !/^[a-f0-9]{64}$/.test(value.id) ||
      !value.files || Array.isArray(value.files) || !Object.keys(value.files).length ||
      digest({ schema: value.schema, files: value.files }) !== value.id) throw new Error('Invalid bundled-resource manifest');
  const validArchive = (archive?: ArchiveRecord) => archive && /^[a-f0-9]{64}$/.test(archive.sha256) &&
    Number.isSafeInteger(archive.size) && archive.size > 0;
  if (value.schema === 2) {
    if (value.archive?.name !== RESOURCE_ARCHIVE || !validArchive(value.archive)) throw new Error('Invalid bundled-resource archive');
  } else {
    if (!value.archives || Array.isArray(value.archives) || Object.keys(value.archives).length !== RESOURCE_ARCHIVES.length ||
        RESOURCE_ARCHIVES.some(name => value.archives![name]?.name !== name || !validArchive(value.archives![name]))) throw new Error('Invalid bundled-resource archives');
    for (const [name, archive] of Object.entries(value.archives)) {
      const files=Object.fromEntries(Object.entries(value.files).filter(([, file]) => file?.archive === name));
      if (archive.id !== digest({ schema: 3, files })) throw new Error('Invalid bundled-resource archive identity');
    }
  }
  for (const [name, record] of Object.entries(value.files)) {
    if (!safeRelative(name) || !record || !Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256) ||
        value.schema === 3 && !RESOURCE_ARCHIVES.includes(record.archive!)) {
      throw new Error(`Invalid bundled-resource entry: ${name}`);
    }
  }
  for (const [name, prefix] of Object.entries(value.packages || {})) {
    if (!/^[\w.-]+\.zip$/.test(name) || prefix !== `packages/${name.slice(0, -4)}/`) throw new Error('Invalid bundled-resource package');
  }
}
export async function readResourceManifest(assets: string): Promise<BundleManifest | null> {
  const file=path.join(assets,'quenching',RESOURCE_MANIFEST);
  const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!stat)return null;
  if(!stat.isFile() || stat.isSymbolicLink())throw new Error('Invalid bundled-resource manifest path');
  const stamp=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if(manifests.get(file)?.stamp===stamp)return manifests.get(file)!.value;
  const manifest=await fs.readJson(file);
  validateResourceManifest(manifest);
  manifests.set(file,{stamp,value:manifest});
  return manifest;
}
async function ordinaryDirectory(directory: string): Promise<void> {
  await fs.ensureDir(directory);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Resource cache directory cannot be a link or file');
}
async function fileInfo(root: string, relative: string, checkedDirectories = new Set<string>()) {
  let current = root;
  const parts = relative.split('/');
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    if(index < parts.length-1 && checkedDirectories.has(current))continue;
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())) throw new Error(`Unsupported resource cache path: ${relative}`);
    if (index === parts.length - 1) return stat;
    checkedDirectories.add(current);
  }
  throw new Error('Invalid resource path');
}

async function hasPayload(root: string): Promise<boolean> {
  const entries=await fs.readdir(root,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const entry of entries) {
    if(entry.isSymbolicLink())throw new Error('Resource cache cannot contain links');
    if(entry.isFile() && entry.name!=='.ready.json')return true;
    if(entry.isDirectory() && await hasPayload(path.join(root,entry.name)))return true;
  }
  return false;
}

/** Adopt an earlier content-ID cache once, without copying its expanded gigabyte. */
async function sharedDestination(base: string, id: string): Promise<string> {
  const unpacked=path.join(base,'unpacked'),current=path.join(unpacked,'current');
  const existing=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing && (!existing.isDirectory() || existing.isSymbolicLink()))throw new Error('Resource cache directory cannot be a link or file');
  if(existing && await hasPayload(current))return current;
  const entries=await fs.readdir(unpacked,{withFileTypes:true});
  const candidates=await Promise.all(entries.filter(entry=>entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{64}$/.test(entry.name))
    .map(async entry=>({entry,time:(await fs.lstat(path.join(unpacked,entry.name,'.ready.json')).catch(()=>null))?.mtimeMs || 0})));
  candidates.sort((a,b)=>Number(b.entry.name===id)-Number(a.entry.name===id) || b.time-a.time);
  for(const {entry} of candidates) {
    const previous=path.join(unpacked,entry.name);
    if(await hasPayload(previous)) {
      if(!existing){await fs.rename(previous,current);return current;}
      const temporary=path.join(base,'_tmp');await ordinaryDirectory(temporary);
      const transaction=await fs.mkdtemp(path.join(temporary,'resource-adopt-'));
      const empty=path.join(transaction,'empty');
      await fs.rename(current,empty);
      try{await fs.rename(previous,current);}catch(error){await fs.rename(empty,current);throw error;}
      await fs.remove(transaction);
      return current;
    }
  }
  return current;
}
export async function prepareBundledAssets(assets: string, options: PrepareOptions): Promise<string | null> {
  if(startupBarrier && !options.startup && options.selections?.length!==0)await startupBarrier;
  return withResourceDirectory(path.join(options.cacheBase, 'prepare'), () => prepare(assets, options));
}
export async function ensureResourceSelection(quenching: string, selections: string[]): Promise<string> {
  const context = contexts.get(path.resolve(quenching));
  if (context) return (await prepareBundledAssets(context.assets, { ...context.options, selections }))!;
  const loose = path.join(path.dirname(quenching), 'unpacked');
  if (await fs.pathExists(loose)) { registerResourceRoot(quenching, loose); return loose; }
  // Isolated fixtures and old loose development inputs require no decompressor.
  return quenching;
}
async function prepare(assets: string, options: PrepareOptions): Promise<string | null> {
  const quenching = path.join(assets, 'quenching');
  const loose = path.join(assets, 'unpacked');
  if (options.preferLoose && await fs.pathExists(loose)) { registerResourceRoot(quenching, loose); return loose; }
  const manifest = await readResourceManifest(assets);
  if (!manifest) {
    if (options.required) throw new Error('客户端资源包缺失，请重新解压完整客户端。');
    return null;
  }
  const names = Object.keys(manifest.files).filter(name => options.selections === undefined || options.selections.some(selection => {
    const selected = resourceSourceAlias(selection).replace(/\/$/, '');
    return name === selected || name.startsWith(selected + '/');
  }));
  const archiveFor = (name: string) => manifest.schema === 3 ? manifest.files[name].archive! : RESOURCE_ARCHIVE;
  const verifyArchives = async (files: string[]) => { for (const name of new Set(files.map(archiveFor))) {
    const record = manifest.schema === 3 ? manifest.archives![name] : manifest.archive!;
    const archive=path.join(quenching,name);
    const stat=await fs.lstat(archive).catch(() => null);
    const stamp=stat ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${record.sha256}` : '';
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== record.size ||
        options.verification !== 'light' && verifiedArchives.get(archive) !== stamp && await fileHash(archive) !== record.sha256) {
      throw new Error(`客户端资源压缩包校验失败（${name}），请重新解压完整客户端。`);
    }
    if(options.verification!=='light')verifiedArchives.set(archive,stamp);
  }};
  if(options.verification!=='light')await verifyArchives(names);
  const base = path.resolve(options.cacheBase);
  await ordinaryDirectory(base);
  await ordinaryDirectory(path.join(base, 'unpacked'));
  const destination = options.sharedCache ? await sharedDestination(base,manifest.id) : path.join(base, 'unpacked', manifest.id);
  await ordinaryDirectory(destination);
  if(options.onPreparation)options.onPreparation(!await hasPayload(destination));
  const previous = await fs.readJson(path.join(destination, '.ready.json')).catch(() => null) as CacheState | null;
  const reusableState = previous && [2,3].includes(previous.schema) && (options.sharedCache || previous.id===manifest.id) &&
    previous.files && typeof previous.files==='object' && !Array.isArray(previous.files);
  const state: CacheState = {schema:3,id:manifest.id,files:reusableState?{...previous.files}:{},
    legacyId:reusableState?(previous.legacyId || (previous.schema===2?previous.id:undefined)):undefined};
  const metadataChanged=reusableState && (previous.id!==manifest.id || previous.schema!==3);
  const missing: string[] = [];
  let stampsChanged = false;
  const checkedDirectories=new Set<string>();
  for (const name of names) {
    try {
      const info = await fileInfo(destination, name,checkedDirectories), saved = state.files[name], record = manifest.files[name];
      const changed = !saved || saved.size !== info.size || saved.mtimeMs !== info.mtimeMs || saved.ctimeMs !== info.ctimeMs;
      const knownSame=saved?.sha256===record.sha256 || saved?.sha256===undefined && state.legacyId===manifest.id;
      if (info.size !== record.size || !changed && saved?.sha256 && !knownSame ||
          (changed || !knownSame) && await fileHash(path.join(destination, name)) !== record.sha256) throw new Error('Resource changed');
      stampsChanged ||= changed || !saved?.sha256;
      state.files[name] = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs,sha256:record.sha256 };
    } catch { missing.push(name); }
  }
  const obsolete=options.sharedCache && options.selections===undefined?Object.keys(state.files).filter(name=>!Object.hasOwn(manifest.files,name) && safeRelative(name)):[];
  if (missing.length || obsolete.length) {
    if(options.verification==='light')await verifyArchives(missing);
    const temporary = path.join(base, '_tmp'); await ordinaryDirectory(temporary);
    const transaction = await fs.mkdtemp(path.join(temporary, 'resource-unpack-'));
    const staged = path.join(transaction, 'prepared');
    const backups = path.join(transaction, 'previous');
    const installed: Array<{ name: string; backup: boolean }> = [];
    let preserve = false;
    try {
      console.log(`[Resources] Preparing ${missing.length} requested files`);
      const wanted = new Set(missing);
      let completed=0;
      const totalBytes=missing.reduce((sum,name)=>sum+manifest.files[name].size,0)||1;
      for (const archiveName of new Set(missing.map(archiveFor))) {
        const weight=missing.filter(name=>archiveFor(name)===archiveName).reduce((sum,name)=>sum+manifest.files[name].size,0);
        await extractArchive(path.join(quenching,archiveName), staged, { idleTimeoutMs: 90000,
          mapFile: name => { if (!Object.hasOwn(manifest.files, name) || archiveFor(name) !== archiveName) throw new Error(`Unexpected bundled resource: ${name}`); return wanted.has(name) ? name : null; },
          onProgress: percent => options.onProgress?.(Math.floor((completed+weight*percent/100)/totalBytes*90)),
        });
        completed+=weight;
      }
      if(options.verification!=='light') {
        const stagedDirectories=new Set<string>();
        for (const name of missing) {
          const record = manifest.files[name], info = await fileInfo(staged, name,stagedDirectories);
          if (info.size !== record.size || await fileHash(path.join(staged, name)) !== record.sha256) throw new Error(`Bundled resource failed verification: ${name}`);
        }
      }
      for(const name of obsolete) {
        const target=path.join(destination,name),backup=path.join(backups,name);
        const old=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(old) {await fileInfo(destination,name);await fs.ensureDir(path.dirname(backup));await fs.rename(target,backup);installed.push({name,backup:true});}
        delete state.files[name];
      }
      const parents=new Set<string>([destination]);
      let publishedCount=0;
      for (const name of missing) {
        // Walk/create each parent without following links in an existing cache.
        const parts = name.split('/'); let parent = destination;
        for (const part of parts.slice(0, -1)) { parent = path.join(parent, part); if(!parents.has(parent)){await ordinaryDirectory(parent);parents.add(parent);} }
        const target = path.join(destination, name), backup = path.join(backups, name);
        const old = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (old && (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)) throw new Error(`Unsupported resource cache target: ${name}`);
        if (old) { await fs.ensureDir(path.dirname(backup)); await fs.rename(target, backup); }
        installed.push({ name, backup: !!old });
        await fs.rename(path.join(staged, name), target);
        const info = await fs.lstat(target);
        if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size!==manifest.files[name].size)throw new Error(`Bundled resource failed verification: ${name}`);
        state.files[name] = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs,sha256:manifest.files[name].sha256 };
        options.onProgress?.(90+Math.floor(++publishedCount/missing.length*9));
      }
      const ready = path.join(transaction, 'ready.json'); await fs.writeJson(ready, state);
      const marker = path.join(destination, '.ready.json');
      const markerInfo = await fs.lstat(marker).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (markerInfo?.isSymbolicLink()) throw new Error('Resource cache marker cannot be a link');
      await fs.rename(ready, marker);
    } catch (error) {
      for (const item of installed.reverse()) {
        try {
          await fs.unlink(path.join(destination, item.name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          if (item.backup) await fs.rename(path.join(backups, item.name), path.join(destination, item.name));
        } catch { preserve = true; }
      }
      if (preserve) console.error(`[Resources] Recovery retained at ${transaction}`);
      throw error;
    } finally { if (!preserve) await fs.remove(transaction); }
  } else if (stampsChanged || metadataChanged) {
    const temporary = path.join(base, '_tmp'); await ordinaryDirectory(temporary);
    const transaction = await fs.mkdtemp(path.join(temporary, 'resource-state-'));
    try {
      const ready = path.join(transaction, 'ready.json'); await fs.writeJson(ready, state);
      await fs.rename(ready, path.join(destination, '.ready.json'));
    } finally { await fs.remove(transaction); }
  }
  registerResourceRoot(quenching, destination);
  contexts.set(path.resolve(quenching), { assets, options: { ...options, selections: [],onPreparation:undefined,onProgress:undefined,startup:undefined } });
  options.onProgress?.(100);
  return destination;
}
