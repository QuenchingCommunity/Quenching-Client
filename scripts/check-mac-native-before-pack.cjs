module.exports = async context => {
    if(context.electronPlatformName==='win32') {
        const { configureWindowsSigning } = await import('./windows-signing.mjs');
        await configureWindowsSigning(context);
    }
    const { prepareClientAssets } = await import('./prepare-client-assets.mjs');
    await prepareClientAssets(context.packager.info.projectDir);
    const fs = require('node:fs'), path = require('node:path');
    const release = JSON.parse(fs.readFileSync(path.join(context.packager.info.projectDir, 'release-version.json'), 'utf8'));
    if (release.channel === 'production') {
        const { checkProductionBuild } = await import('./check-production-build.mjs');
        await checkProductionBuild(context.packager.info.projectDir);
    }
    if (context.electronPlatformName !== 'darwin') return;
    const arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : null;
    if (!arch) throw new Error('Build separate arm64 and x64 Mac packages.');
    const { validateMacNative } = await import('./mac-native.mjs');
    validateMacNative(context.packager.info.appDir, arch);
};
