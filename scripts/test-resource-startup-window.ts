import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const fixture:any={};(globalThis as any).__resourceWindow=fixture;
const bundled=await build({
  stdin:{contents:'export * from "./src/Main/services/bundled-resource-startup";',resolveDir:process.cwd(),loader:'ts'},
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  plugins:[{name:'resource-window-fixture',setup(plugin){
    const mocks:Record<string,string>={
      electron:'export const ipcMain={handle:(name,handler)=>f.handlers.set(name,handler)};',
      'asset-sync':'export const AssetSyncService={prepareStartupAssets:(notify,ready)=>f.prepare(notify,ready)};',
      'client-update-service':'export const acknowledgeClientUpdate=async()=>{f.acks++;};',
      'startup-telemetry':'export const startupTelemetry={markStartupSuccess:()=>{f.success++;},recordStartupFailure:()=>{f.failures++;}};',
      'startup-rendering':'export const scheduleStartupRendering=()=>{f.rendering++;};',
      'bundled-assets':'export const deferBundledResourcePreparation=wait=>{f.gate=wait;};',
    };
    plugin.onResolve({filter:/./},args=>{const key=args.path.split('/').at(-1)!;if(mocks[key])return{path:key,namespace:'fixture'};});
    plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:'const f=globalThis.__resourceWindow;'+mocks[args.path]}));
  }}],
});
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function load(){const module={exports:{} as any};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports;}
function windowFixture(){const mainEvents=new Map(),webEvents=new Map();const messages:any[]=[];
  const webContents={isDestroyed:()=>false,send:(...message:any[])=>messages.push(message),once:(name:string,handler:Function)=>webEvents.set(name,handler)};
  return{window:{webContents,isDestroyed:()=>false,once:(name:string,handler:Function)=>mainEvents.set(name,handler)},messages,mainEvents,webEvents};}
const oldHeadless=process.env.QUENCHING_AUTOMATED_TEST_HEADLESS;delete process.env.QUENCHING_AUTOMATED_TEST_HEADLESS;
try {
  for(const firstRun of [true,false]) {
    Object.assign(fixture,{handlers:new Map(),acks:0,success:0,failures:0,rendering:0,started:0});
    let finish!:()=>void;
    fixture.prepare=async(notify:Function,ready:Function)=>{fixture.started++;await ready();notify({firstRun,percent:0});notify({firstRun,percent:50});await new Promise<void>(resolve=>{finish=resolve;});};
    const api=load(),w=windowFixture();api.installBundledResourceStartup(w.window);
    assert.equal(fixture.started,0,'window registration and load do not decompress');
    const start=fixture.handlers.get('resources:startup-ready');
    assert.throws(()=>start({sender:{}}),/Invalid resource startup sender/);
    const initial=start({sender:w.window.webContents});assert.equal(initial.phase,'preparing');await turn();
    assert.equal(fixture.started,1);assert.equal(fixture.acks,1,'painted client acknowledges health before slow derived-cache extraction');
    assert.equal(fixture.rendering,0,'game resource application waits for complete extraction');
    start({sender:w.window.webContents});assert.equal(fixture.started,1);
    assert.equal(w.messages.some(m=>m[0]==='resources:startup-progress'),firstRun,'only first launch receives progress events');
    finish();await fixture.gate;await turn();
    assert.equal(fixture.acks,1);assert.equal(fixture.success,1);assert.equal(fixture.rendering,1);
    assert.equal(start({sender:w.window.webContents}).phase,'ready');
    const reopened=windowFixture();api.installBundledResourceStartup(reopened.window);
    assert.equal(start({sender:reopened.window.webContents}).phase,'ready');assert.equal(fixture.started,1);
  }
  Object.assign(fixture,{handlers:new Map(),acks:0,success:0,failures:0,rendering:0,started:0,
    prepare:async()=>{fixture.started++;throw new Error('fixture decoder failed');}});
  const failed=load(),w=windowFixture();failed.installBundledResourceStartup(w.window);
  fixture.handlers.get('resources:startup-ready')({sender:w.window.webContents});await fixture.gate;await turn();
  assert.equal(fixture.failures,1);assert.equal(fixture.acks,0);assert.equal(fixture.rendering,0);
  assert(w.messages.some(m=>m[0]==='mod:startup-rendering-result' && m[1].status==='failed'));

  process.env.QUENCHING_AUTOMATED_TEST_HEADLESS='1';
  Object.assign(fixture,{handlers:new Map(),acks:0,success:0,failures:0,rendering:0,started:0,prepare:async(_notify:Function,ready:Function)=>{fixture.started++;await ready();}});
  const headless=load(),hidden=windowFixture();headless.installBundledResourceStartup(hidden.window);
  assert.equal(fixture.started,0);hidden.webEvents.get('did-finish-load')();await fixture.gate;await turn();
  assert.equal(fixture.started,1);assert.equal(fixture.acks,1,'hidden automation does not wait for paused animation frames');
  console.log('PASS: renderer readiness gates decompression, first-launch progress, completely silent warm updates, idempotent reopen, health acknowledgement, failure isolation and hidden automation.');
} finally {if(oldHeadless===undefined)delete process.env.QUENCHING_AUTOMATED_TEST_HEADLESS;else process.env.QUENCHING_AUTOMATED_TEST_HEADLESS=oldHeadless;}
