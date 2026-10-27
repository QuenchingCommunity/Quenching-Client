/**
 * Package and ad hoc sign a portable macOS .app on a Mac build runner.
 *
 * StormLib and CascLib have no npm darwin prebuilds. The native preparation
 * step must run on the target architecture first. Electron framework symlinks
 * and Unix permissions are preserved by ditto, followed by signing and smoke tests.
 *
 * Usage:
 *   node scripts/package-mac-app.mjs           # arm64 (Apple Silicon)
 *   node scripts/package-mac-app.mjs --x64     # Intel
 */
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { validateMacNative, smokeMacNative } from './mac-native.mjs';
import { signMacApp } from './sign-mac-app.js';
import { downloadElectronZip } from './lib/electron-download.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const plist = require('plist');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = require('../package.json');
const electronPkg = require('electron/package.json');

const arch = process.argv.includes('--x64') ? 'x64' : process.argv.includes('--arm64') ? 'arm64' : process.platform === 'darwin' ? process.arch : 'arm64';
const appName = 'QMClient';
const bundleId = 'com.quenching.mod.client';
const outDir = path.join(root, '__Bin');
const finalAppDir = path.join(outDir, `${appName}-darwin-${arch}`);
const finalAppPath = path.join(finalAppDir, `${appName}.app`);


function listProductionTopLevelIds() {
	const result = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
		cwd: root,
		encoding: 'utf8',
		shell: true,
	});
	const nm = path.join(root, 'node_modules');
	const ids = new Set();
	for (const line of (result.stdout || '').split(/\r?\n/)) {
		const abs = line.trim();
		if (!abs.startsWith(nm)) continue;
		const rel = path.relative(nm, abs).replace(/\\/g, '/');
		if (!rel || rel.startsWith('..')) continue;
		const parts = rel.split('/').filter(Boolean);
		if (parts[0].startsWith('@')) {
			if (parts.length >= 2) ids.add(`${parts[0]}/${parts[1]}`);
		} else {
			ids.add(parts[0]);
		}
	}
	ids.delete('.bin');
	ids.delete('.cache');
	return ids;
}

function copyAppSources(stagingDir) {
    const native = validateMacNative(root, arch);
	fs.emptyDirSync(stagingDir);
	fs.writeJsonSync(path.join(stagingDir, 'package.json'), {
		name: pkg.name,
		productName: appName,
		version: pkg.version,
		main: pkg.main,
		type: pkg.type,
		license: pkg.license,
		dependencies: pkg.dependencies,
	}, { spaces: 2 });

	fs.copySync(path.join(root, 'dist'), path.join(stagingDir, 'dist'), {
		filter: (src) => {
			const rel = path.relative(path.join(root, 'dist'), src).replace(/\\/g, '/');
			if (!rel) return true;
			if (rel === 'statics' || rel.startsWith('statics/')) return false;
			if (rel.endsWith('.map')) return false;
			return true;
		},
	});

	const nmSrc = path.join(root, 'node_modules');
	const nmDest = path.join(stagingDir, 'node_modules');
	fs.mkdirSync(nmDest, { recursive: true });
	const copyFilter = (src) => {
		const base = path.basename(src);
		if (base === '.bin' || base === 'test' || base === 'tests' || base === '__tests__') return false;
		if (src.endsWith('.map')) return false;
		return true;
	};
	const ids = listProductionTopLevelIds();
	let copied = 0;
	for (const id of ids) {
		const from = path.join(nmSrc, ...id.split('/'));
		if (!fs.existsSync(from)) continue;
		fs.copySync(from, path.join(nmDest, ...id.split('/')), {
			dereference: true,
			filter: copyFilter,
		});
		copied += 1;
	}
	console.log(`[package-mac-app] copied ${copied} production node_modules packages`);
    // Do not ship build caches or foreign prebuilds. Use the exact binaries
    // validated above, where node-gyp-build can resolve them inside ASAR.
    for (const { name, file } of native) {
        const directory = path.join(nmDest, name);
        fs.removeSync(path.join(directory, 'build'));
        fs.removeSync(path.join(directory, 'prebuilds'));
        fs.copySync(file, path.join(directory, 'prebuilds', `darwin-${arch}`, `node.napi.node`));
    }
    validateMacNative(stagingDir, arch);
}

function updatePlist(plistPath, updates) {
	const parsed = plist.parse(fs.readFileSync(plistPath, 'utf8'));
	Object.assign(parsed, updates);
	fs.writeFileSync(plistPath, plist.build(parsed));
}

function renameBundle(appPath, fromBase, toBase) {
	const macOSDir = path.join(appPath, 'Contents', 'MacOS');
	const fromExec = path.join(macOSDir, fromBase);
	const toExec = path.join(macOSDir, toBase);
	if (fs.existsSync(fromExec) && fromExec !== toExec) {
		fs.moveSync(fromExec, toExec, { overwrite: true });
	}
	updatePlist(path.join(appPath, 'Contents', 'Info.plist'), {
		CFBundleExecutable: toBase,
		CFBundleName: toBase,
		CFBundleDisplayName: toBase,
	});
}

function customizeMacApp(appPath) {
	updatePlist(path.join(appPath, 'Contents', 'Info.plist'), {
		CFBundleIdentifier: bundleId,
		CFBundleName: appName,
		CFBundleDisplayName: appName,
		CFBundleExecutable: appName,
		CFBundleShortVersionString: pkg.version,
		CFBundleVersion: pkg.version,
		LSApplicationCategoryType: 'public.app-category.games',
		NSRequiresAquaSystemAppearance: false,
	});
	renameBundle(appPath, 'Electron', appName);

	const frameworks = path.join(appPath, 'Contents', 'Frameworks');
	const helperSuffixes = [
		' Helper',
		' Helper EH',
		' Helper NP',
		' Helper (Renderer)',
		' Helper (Plugin)',
		' Helper (GPU)',
	];
	for (const suffix of helperSuffixes) {
		const fromName = `Electron${suffix}`;
		const toName = `${appName}${suffix}`;
		const fromApp = path.join(frameworks, `${fromName}.app`);
		if (!fs.existsSync(fromApp)) continue;
		renameBundle(fromApp, fromName, toName);
		updatePlist(path.join(fromApp, 'Contents', 'Info.plist'), {
			CFBundleIdentifier: `${bundleId}.helper${suffix.replace(/[^A-Za-z]/g, '').toLowerCase() || ''}`,
		});
		fs.moveSync(fromApp, path.join(frameworks, `${toName}.app`), { overwrite: true });
	}
}

async function main() {
    if (process.platform !== 'darwin') {
        throw new Error('This Mac package needs native darwin modules and codesign. Run .github/workflows/build-mac.yml on a macOS runner; Windows copies of node_modules cannot produce a working signed Mac app.');
    }
    validateMacNative(root, arch);
	if (!fs.existsSync(path.join(root, 'dist', 'main.js'))) {
		throw new Error('dist/main.js is missing. Run npm run build first.');
	}

	console.log(`[package-mac-app] packaging ${appName} darwin-${arch} (Electron ${electronPkg.version})`);
	const zipPath = await downloadElectronZip(electronPkg.version, arch);
	console.log(`[package-mac-app] electron zip: ${zipPath}`);

	const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qm-mac-app-'));
	const extractDir = path.join(workRoot, 'electron');
	const stagingDir = path.join(workRoot, 'app');
	const asarPath = path.join(workRoot, 'app.asar');

	try {
        await fs.ensureDir(extractDir);
        const extracted = spawnSync('ditto', ['-x', '-k', zipPath, extractDir], { stdio: 'inherit' });
        if (extracted.status !== 0) throw new Error('Failed to extract Electron with its framework symlinks');
		const extractedApp = path.join(extractDir, 'Electron.app');
		if (!fs.existsSync(extractedApp)) {
			throw new Error(`Electron.app not found after extract in ${extractDir}`);
		}

		console.log('[package-mac-app] copying filtered app sources...');
		copyAppSources(stagingDir);
		console.log('[package-mac-app] packing asar...');
		await asar.createPackageWithOptions(stagingDir, asarPath, {
			unpack: '**/*.{node,dylib,so}',
		});

		await fs.remove(finalAppDir);
		await fs.ensureDir(finalAppDir);
		await fs.copy(extractedApp, finalAppPath);
		customizeMacApp(finalAppPath);

		const resources = path.join(finalAppPath, 'Contents', 'Resources');
		const defaultAsar = path.join(resources, 'default_app.asar');
		if (fs.existsSync(defaultAsar)) await fs.remove(defaultAsar);
		await fs.copy(asarPath, path.join(resources, 'app.asar'));
		const unpacked = `${asarPath}.unpacked`;
		if (fs.existsSync(unpacked)) {
			await fs.copy(unpacked, path.join(resources, 'app.asar.unpacked'));
		}

		await fs.access(path.join(root, 'assets/quenching/shaders.zip'));
		await fs.access(path.join(root, 'assets/quenching/shaders-300-legacy.zip'));
		await fs.copy(path.join(root, 'assets'), path.join(resources, 'assets'), { filter: source => {
			const relative = path.relative(path.join(root, 'assets'), source).split(path.sep).join('/');
			return relative !== 'quenching/shaders' && !relative.startsWith('quenching/shaders/');
		} });
		const staticsSrc = path.join(root, 'dist', 'statics');
		if (fs.existsSync(staticsSrc)) {
			await fs.copy(staticsSrc, path.join(resources, 'statics'));
		}

		const required = [
			path.join(finalAppPath, 'Contents', 'MacOS', appName),
			path.join(finalAppPath, 'Contents', 'Info.plist'),
			path.join(resources, 'app.asar'),
			path.join(resources, 'assets'),
		];
		for (const item of required) {
			if (!fs.existsSync(item)) {
				throw new Error(`Packaged app is missing expected path: ${item}`);
			}
		}

		const zipOut = path.join(outDir, `${appName}-darwin-${arch}.zip`);
        await signMacApp(finalAppPath);
        smokeMacNative(path.join(finalAppPath, 'Contents/MacOS', appName), path.join(resources, 'app.asar'));
        console.log(`[package-mac-app] zipping signed app with symlinks and permissions: ${zipOut}`);
        if (fs.existsSync(zipOut)) await fs.remove(zipOut);
        const zipped = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', finalAppPath, zipOut], { stdio: 'inherit' });
        if (zipped.status !== 0) throw new Error('Failed to ZIP the signed Mac app');
        const bytes = (await fs.stat(zipOut)).size;
		console.log(`[package-mac-app] .app: ${finalAppPath}`);
		console.log(`[package-mac-app] zip: ${zipOut} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
        console.log('Native modules and ad hoc signature passed. This build is not Developer ID notarized.');
	} finally {
		await fs.remove(workRoot).catch(() => {});
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
