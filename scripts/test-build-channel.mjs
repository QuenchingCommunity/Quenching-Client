import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import webpack from 'webpack';
import ts from 'typescript';
import {buildChannelPlugins} from './lib/build-channel-policy.mjs';
import {setBuildChannel} from './set-build-channel.mjs';
import {checkProductionBuild} from './check-production-build.mjs';
const require=createRequire(import.meta.url);
const root=path.resolve('.'),parent=path.resolve('_tmp/build-channel');await fs.mkdir(parent,{recursive:true});
const work=await fs.mkdtemp(path.join(parent,'check-'));
try{
 const config=path.join(work,'config');await fs.mkdir(config);
 await fs.writeFile(path.join(config,'release-version.json'),JSON.stringify({displayVersion:'3.7',channel:'test'}));
 assert.equal((await setBuildChannel('production',config)).channel,'production');
 assert.equal((await setBuildChannel('test',config)).channel,'test');
 await assert.rejects(setBuildChannel('invalid',config),/production or test/);
 const loader=path.join(work,'typescript.cjs');await fs.writeFile(loader,`const ts=require('typescript');module.exports=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
 for(const testBuild of [false,true]){
  const name=testBuild?'test':'production',entry=path.join(work,name+'.mjs');
  const imports=`import {IS_TEST_RELEASE} from ${JSON.stringify(path.join(root,'src/shared/local-release.ts'))};
    import {updateTestEnabled,updateTestUrls,updateChannelPath} from ${JSON.stringify(path.join(root,'src/Main/services/update-channel.ts'))};`;
  const prod=testBuild?'':`import ${JSON.stringify(path.join(root,'src/Main/services/update-test-init.ts'))};
    import {registerOfflineTestLauncher} from ${JSON.stringify(path.join(root,'src/Main/services/offline-test-launcher.ts'))};registerOfflineTestLauncher();`;
  await fs.writeFile(entry,imports+prod+`export const result={test:IS_TEST_RELEASE,enabled:updateTestEnabled(),urls:updateTestUrls('version.que'),path:updateChannelPath('version.que'),preview:process.env.QUENCHING_PREVIEW_UPDATES};`);
  const compiler=webpack({mode:'production',context:root,target:'node',entry,output:{path:work,filename:name+'.cjs',library:{type:'commonjs2'}},
    resolve:{extensions:['.ts','.mjs','.js','.json']},module:{rules:[{test:/\.ts$/,use:[{loader}]}]},plugins:buildChannelPlugins(webpack,root,testBuild)});
  await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):resolve())));
  const code=await fs.readFile(path.join(work,name+'.cjs'),'utf8'),module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require,URL,process:{env:{QUENCHING_UPDATE_TEST:'1',QUENCHING_UPDATE_TEST_BASE:'https://www.tianxiazhengyi.net/',QUENCHING_PREVIEW_UPDATES:'1'}}});
  const result=module.exports.result;
  assert.equal(result.test,testBuild);assert.equal(result.enabled,testBuild);
  assert.equal(result.path,testBuild?'version-test.que':'version.que');
  if(testBuild){assert.equal(result.urls[0],'https://www.tianxiazhengyi.net/version-test.que');assert.equal(result.preview,'1');}
  else{assert.equal(result.urls,undefined);assert.equal(result.preview,undefined);assert(!/quenching-update-test\.json|game:launch-offline-starter|QUENCHING_UPDATE_TEST|QUENCHING_PREVIEW_UPDATES/.test(code));}
 }
 const productionContent=require('./loaders/production-test-content.cjs');
 for(const locale of ['zh-CN','en-US','fr-FR','pt-BR','ru-RU','es-ES','ko-KR','pl-PL']){
  const resourcePath=path.join(root,'src/Renderer/utils/i18n/locales',locale+'.ts');
  const source=await fs.readFile(resourcePath,'utf8');assert(source.includes('main.offlineTest.'));
  const stripped=productionContent.call({resourcePath},source);assert(!stripped.includes('main.offlineTest.'));
  const output=ts.transpileModule(stripped,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports});assert(module.exports.default['msg.update.incomplete']);
 }
 const css=productionContent.call({resourcePath:'global.css'},'.normal { color: gold; }\n.home-offline-test-button.ant-btn { color: gold; }\n');
 assert(css.includes('.normal'));assert(!css.includes('home-offline-test-button'));
 await setBuildChannel('production',config);
 await fs.mkdir(path.join(config,'assets/quenching'),{recursive:true});await fs.mkdir(path.join(config,'dist'));
 await fs.writeFile(path.join(config,'package.json'),JSON.stringify({version:'3.7.0'}));
 await fs.writeFile(path.join(config,'assets/quenching/local-release.json'),JSON.stringify({channel:'production',internalVersion:'3.7.0',label:'3.7'}));
 await fs.writeFile(path.join(config,'assets/quenching/index.html'),'Version 3.7');
 await fs.writeFile(path.join(config,'dist/preload.cjs'),'module.exports={};');
 assert.equal((await checkProductionBuild(config)).offlineUiAndIpcRemoved,true);
 await fs.writeFile(path.join(config,'dist/preload.cjs'),'"game:launch-offline-starter";');
 await assert.rejects(checkProductionBuild(config),/retains TEST-only content/);
 console.log('PASS: explicit channel switch, compiled production rejects TEST flags and preview overrides, marker initializer/offline launcher absent, shared production URLs, TEST channel retained, 8 locale catalogs and CSS strip only offline TEST content.');
}finally{assert.equal(path.dirname(work),parent);await fs.rm(work,{recursive:true,force:true});}
