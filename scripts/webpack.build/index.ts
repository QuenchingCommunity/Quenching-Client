/**
 * 为生产环境打包dist目录,此脚本并非将代码打包为exe, pack.ts才是
 */
setNodeEnv('production');
const started = performance.now();
const compile = async (name: string, config: typeof webpack_conf_for_electron_main) => {
	if (!config) return;
	const start = performance.now();
	console.log(`[build] ${name}: started`);
	const result = await webpack_promise(config);
	console.log(`[build] ${name}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
	return result;
};

Promise.all( [
	compile('renderer', webpack_conf_for_electron_renderer),
	compile('preload', webpack_conf_for_electron_preload),
	compile('main', webpack_conf_for_electron_main),
] ).
then( () => {
	console.log(`[build] webpack total: ${((performance.now() - started) / 1000).toFixed(2)}s`);
	console.log(chalk.green('complete'));
	console.log(chalk.yellow('Open file to build Electron: ','electron-reaxes-react/package.json'));
} ).
catch( e => {
	process.exitCode = 1;
	console.log( chalk.red( 'fatal' ) );
	console.log( e );
} );

import chalk from 'chalk';
import { setNodeEnv } from '../../engine/toolkit/entrance.ts';
import { webpack_promise } from '../../engine/utils';
import { webpack_conf_for_electron_main , webpack_conf_for_electron_preload , webpack_conf_for_electron_renderer } from '../utils/mixedRepoWebpackConf.ts';
