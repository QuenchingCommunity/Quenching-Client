import path from 'node:path';

export const TEST_ONLY_ENVIRONMENT = Object.freeze([
  'QUENCHING_UPDATE_TEST', 'QUENCHING_UPDATE_TEST_BASE', 'QUENCHING_PREVIEW_UPDATES',
  'QUENCHING_VERSION_URL', 'QUENCHING_MANIFEST_URL', 'QUENCHING_CLIENT_MANIFEST_URL',
  'QUENCHING_CLIENT_UPDATE_TEST', 'QUENCHING_TEST_CONFIG_DIR', 'QUENCHING_DEVTOOLS',
  'QUENCHING_AUTOMATED_TEST_HEADLESS', 'QUENCHING_UPDATE_PUBLIC_KEY', 'QUENCHING_BASELINE_MANIFEST',
]);

export function buildChannelPlugins(webpack, root, testBuild) {
  const definitions = { __QUENCHING_TEST_BUILD__: JSON.stringify(testBuild) };
  if (!testBuild) for (const name of TEST_ONLY_ENVIRONMENT) definitions['process.env.' + name] = 'undefined';
  return [new webpack.DefinePlugin(definitions), ...(testBuild ? [] : [
    new webpack.NormalModuleReplacementPlugin(/offline-test-launcher(?:\.ts)?$/, path.join(root, 'src/Main/services/offline-test-disabled.ts')),
    new webpack.NormalModuleReplacementPlugin(/update-test-init(?:\.ts)?$/, path.join(root, 'src/Main/services/update-test-disabled.ts')),
    new webpack.NormalModuleReplacementPlugin(/(?:^|[\\/])update-channel(?:\.ts)?$/, path.join(root, 'src/Main/services/update-channel-production.ts')),
  ])];
}

export function buildChannelRules(root, testBuild) {
  return testBuild ? [] : [{
    test: /[\\/]src[\\/]Renderer[\\/]utils[\\/]i18n[\\/]locales[\\/][^\\/]+\.ts$/,
    enforce: 'pre', use: [{ loader: path.join(root, 'scripts/loaders/production-test-content.cjs') }],
  }, {
    test: /[\\/]src[\\/]Renderer[\\/]styles[\\/]global\.css$/,
    enforce: 'pre', use: [{ loader: path.join(root, 'scripts/loaders/production-test-content.cjs') }],
  }];
}
