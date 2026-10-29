const { IgnorePlugin } = webpack;

export const electronMainConf: Configuration = {
	target: 'electron-main',
	mode: 'production',
	externalsPresets: {
		// electron : true ,
		// electronMain : true ,
		// electronPreload : true,
	},
	output: {
		// The package is ESM, while webpack's Electron main runtime loads its
		// async chunks with require(). Give those chunks a CommonJS extension.
		chunkFilename: '[id].cjs',
		library: {
			type: 'umd',
		},
	},
	resolve: {
		fallback: {
			fs: false,
			tls: false,
			net: false,
			path: false,
			zlib: false,
			http: false,
			https: false,
			stream: false,
			crypto: false,
		}
	},
	// externals : {
	// 	electron : 'require("electron")',
	// 	fs : 'require("node:fs")'
	// },
	externals: {
		// electron : 'require("electron")',
		// fs : 'require("fs")',
		// path : 'require("path")',
		// child_process : 'require("child_process")',

		// @jamiephan/stormlib / casclib 为带 .node 的原生模块，必须由 Node 从 node_modules 加载（勿打进 webpack）。
		'@jamiephan/stormlib': 'commonjs @jamiephan/stormlib',
		'@jamiephan/casclib': 'commonjs @jamiephan/casclib',
		'7zip-bin-full': 'commonjs 7zip-bin-full',
	},
	plugins: [
		// new NodePolyfillPlugin() ,
		// new IgnorePlugin( {
		// 	resourceRegExp : /^electron$/ ,
		// } ),
		new webpack.BannerPlugin({
			banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
			raw: true,
			entryOnly: true
		})
	],

	node: {
		__dirname: false,
		__filename: false,
	},
};

import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
import webpack, { Configuration } from 'webpack';
