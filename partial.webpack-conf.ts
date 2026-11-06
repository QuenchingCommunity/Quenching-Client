import { LOCAL_APP_TITLE } from './src/shared/local-release';
import releaseVersion from './release-version.json';
import { buildChannelPlugins, buildChannelRules } from './scripts/lib/build-channel-policy.mjs';
const { ProvidePlugin } = webpack;

export const main = (
	//项目根目录,即`electron-reaxes-react`
	repoRootPath: string,
	//子工程目录,即/projects/Autohotkey-GUI/projects/War3
	subProjectRootPath: string
): WebpackConfiguration => {

	return {
		entry: path.join(subProjectRootPath, "src/main.ts"),
		output: {
			path: path.join(subProjectRootPath, "dist"),
			devtoolModuleFilenameTemplate: 'webpack:[namespace]/[resource-path][loaders]',
			pathinfo: false,
		},
		resolve: {
			alias: {
				'#main': path.join(subProjectRootPath, 'src/Main'),
				'#renderer': path.join(subProjectRootPath, 'src/Renderer'),
				'#src': path.join(subProjectRootPath, 'src'),
				'#assets': path.join(subProjectRootPath, 'assets'),
			}
		},
		plugins: [
			...buildChannelPlugins(webpack, subProjectRootPath, releaseVersion.channel === 'test'),
			new CopyPlugin({
				patterns: [
					{
						from: path.join(subProjectRootPath, 'package.json'),
						to: path.join(subProjectRootPath, 'dist/statics')
					},
					{
						from: path.join(repoRootPath, 'node_modules/regedit/vbs'),
						to: path.join(subProjectRootPath, 'dist/statics/assets/vbs'),
					},
				],
			}),
			new ProvidePlugin({
				'IPCLogger': ['#main/exports', 'IPCLogger'],
			}),
		],
	};

};

export const renderer = (repoRootPath: string, subProjectRootPath: string): WebpackConfiguration => {
	return {
		experiments: {
			topLevelAwait: true,  // 启用顶层 await
		},
		entry: path.resolve(subProjectRootPath, "src/Renderer/index.tsx"),
		module: { rules: buildChannelRules(subProjectRootPath, releaseVersion.channel === 'test') },

		output: {
			path: path.join(subProjectRootPath, "dist/renderer"),
		},
		watchOptions: {

		},
		resolve: {
			alias: {
				'#main': path.join(subProjectRootPath, 'src/Main'),
				'#renderer': path.join(subProjectRootPath, 'src/Renderer'),
				'#src': path.join(subProjectRootPath, 'src'),
				'#assets': path.join(subProjectRootPath, 'assets'),
			}
		},
		plugins: [
			...buildChannelPlugins(webpack, subProjectRootPath, releaseVersion.channel === 'test'),
			new CopyPlugin({
				patterns: [
					{
						from: path.join(subProjectRootPath, 'public'),
						to: path.join(subProjectRootPath, 'dist/renderer'),
						globOptions: {
							ignore: ['**/index.html','**/[oO][fF][fF][lL][iI][nN][eE].[eE][xX][eE]'], // Never bundle the external offline tool.
						},
					},
				],
			}),
			new WatchFilePlugin({
				files: [
					path.join(subProjectRootPath, 'src/ahk-scripts/**'),
				],
			}),
			new HtmlWebpackPlugin({
				title: LOCAL_APP_TITLE,
				template: path.join(subProjectRootPath, "index.template.html"),
				filename: 'index.html',
				minify: false,
				hash: true,
				// inject: false,
			}),
			new ProvidePlugin({

				'I18n': ['#renderer/reaxels/exports', 'I18n'],
				'i18n': ['#renderer/reaxels/exports', 'i18n'],
			}),
		],

	};
};

export const preload = (repoRootPath: string, subProjectRootPath: string): WebpackConfiguration => {
	return {
		entry: path.join(subProjectRootPath, "src/Main/preload.ts"),
		mode: releaseVersion.channel === 'test' ? 'development' : 'production',
		devtool: releaseVersion.channel === 'test' ? 'cheap-source-map' : false,
		plugins: buildChannelPlugins(webpack, subProjectRootPath, releaseVersion.channel === 'test'),
		output: {
			path: path.join(subProjectRootPath, "dist"),
			filename: 'preload.cjs',
			library: {
				type: 'umd',
			},
		},
		resolve: {
			alias: {
				'#main': path.join(subProjectRootPath, 'src/Main'),
				'#renderer': path.join(subProjectRootPath, 'src/Renderer'),
				'#src': path.join(subProjectRootPath, 'src'),
				'#assets': path.join(subProjectRootPath, 'assets'),
			}
		},
	};
};


import path, { } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WatchFilePlugin = require('webpack-watch-files-plugin').default || require('webpack-watch-files-plugin');
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';
import type { Configuration as WebpackConfiguration } from 'webpack'
