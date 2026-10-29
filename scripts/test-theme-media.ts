import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {resolveThemeMedia} from '../src/Renderer/utils/theme-media';
const base='file:///D:/client/dist/renderer/index.html';
assert.equal(resolveThemeMedia('assets/quenching/magicstorm.mp4',base),'file:///D:/client/dist/renderer/assets/quenching/magicstorm.mp4');
assert.equal(resolveThemeMedia('C:\\用户\\主题 #1%.mp4',base),'file:///C:/%E7%94%A8%E6%88%B7/%E4%B8%BB%E9%A2%98%20%231%25.mp4');
assert.equal(resolveThemeMedia('assets/a.mp4','http://localhost:4410/index.html'),'http://localhost:4410/assets/a.mp4');
assert.equal(resolveThemeMedia('https://example.com/a.mp4',base),'https://example.com/a.mp4');
const parent=path.resolve('_tmp/media-pixel-format-20261029');await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(path.join(parent,'test-'));
try{
 const output=path.join(root,'fixture.js');
 await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {BackgroundVideo} from './src/Renderer/components/MainWindow/BackgroundVideo';
 window.electronAPI={getConfig:async key=>key==='theme'?'magicstorm':[]};
 window.starts=[];document.addEventListener('loadstart',event=>{if(event.target.tagName==='VIDEO')window.starts.push(event.target.src)},true);
 createRoot(document.getElementById('root')).render(<BackgroundVideo/>);
 `},bundle:true,platform:'browser',outfile:output,loader:{'.less':'empty'}});
 await fs.writeFile(path.join(root,'index.html'),`<!doctype html><base href="${pathToFileURL(path.resolve('public')+path.sep).href}"><div id="root"></div><script src="${pathToFileURL(output).href}"></script>`);
 await fs.writeFile(path.join(root,'main.cjs'),`
 const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
 app.setPath('userData',path.join(__dirname,'profile'));
 app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await w.loadFile(path.join(__dirname,'index.html'));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(1200);
 const inspect=()=>w.webContents.executeJavaScript('Array.from(document.querySelectorAll("video")).map(v=>({src:v.getAttribute("src"),ready:v.readyState,frames:v.getVideoPlaybackQuality().totalVideoFrames,error:v.error?.code}))');
 let videos=await inspect();assert(videos.some(v=>v.ready>=2&&v.frames>0),'initial theme decodes');
 let count=await w.webContents.executeJavaScript('window.starts.length');
 await w.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("theme-changed",{detail:"magicstorm"}))');await wait(300);
 assert.equal(await w.webContents.executeJavaScript('window.starts.length'),count,'same theme does not reload');
 await w.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("theme-changed",{detail:"city"}))');await wait(1700);
 videos=await inspect();assert.equal(videos.filter(v=>v.src).length,1,'inactive decoder released after fade');
 assert(videos.some(v=>v.src?.endsWith("mainmenu4.mp4")&&v.frames>0),'switch decodes');
 await w.webContents.executeJavaScript('window.electronAPI.getConfig=async key=>[{id:"custom-broken",videoPath:"C:\\\\missing-theme-test.mp4"}];window.dispatchEvent(new CustomEvent("theme-changed",{detail:"custom-broken"}))');await wait(500);
 videos=await inspect();assert(videos.some(v=>v.src?.endsWith("mainmenu4.mp4")&&!v.error),'bad pending source keeps current theme');
 fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify({passed:true,videos}));app.exit(0);
 }).catch(e=>{console.error(e);app.exit(1)});
 `);
 const result=spawnSync(path.resolve('node_modules/electron/dist/electron.exe'),[path.join(root,'main.cjs')],{encoding:'utf8',windowsHide:true,timeout:25000});
 await fs.writeFile(path.join(parent,'component-native.log'),(result.stdout||'')+(result.stderr||''));
 assert.equal(result.status,0,(result.stderr||result.error?.message||'').slice(-3000));
 assert.equal((result.stderr||'').includes('Unsupported pixel format'),false,'actual theme playback produced no pixel-format warnings');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8')).passed,true);
 console.log('PASS: real Electron background decode, same-theme no reload, theme switch, decoder release, failed pending source preservation, Windows/Unicode/#/% media URLs; zero pixel-format warnings.');
}finally{assert.equal(path.dirname(root),parent);await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
