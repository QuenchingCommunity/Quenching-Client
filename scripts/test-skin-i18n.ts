import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { SKIN_CONFIG } from '../src/Renderer/assets/data/skin-config';
import { builtInSkins, skinTargets } from '../src/Renderer/assets/data/skin-panel-catalog';
import { builtInSkinLabel, targetLabel } from '../src/Renderer/utils/skin-labels';
import { readI18nCatalogs } from './lib/read-i18n-catalogs.mjs';

const { languages, duplicates } = readI18nCatalogs(process.cwd());
assert.deepEqual(duplicates, []);
const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  [...languages].map(([locale, entries]) => [locale, Object.fromEntries(entries)])
);
let checked = 0;
for (const [locale, catalog] of Object.entries(catalogs)) {
  const strictTranslate = (key: string) => {
    assert.ok(catalog[key], `${locale}: missing dynamic skin label ${key}`);
    if (locale !== 'zh-CN') assert.doesNotMatch(catalog[key], /[\u3400-\u9fff]/u, `${locale}: untranslated ${key}`);
    checked++; return catalog[key];
  };
  for (const race of Object.keys(SKIN_CONFIG)) {
    for (const category of ['hero', 'unit', 'building']) {
      for (const target of skinTargets(race, category)) {
        targetLabel(target.unitId, category, target.name, strictTranslate);
        for (const artSet of ['sd', 'hd', 'de'] as const) {
          for (const skin of builtInSkins(race, target.unitId, artSet)) {
            builtInSkinLabel(skin.id, race, target.unitId, skin.name, strictTranslate);
          }
        }
      }
    }
    for (const warband of SKIN_CONFIG[race].warbands || []) builtInSkinLabel(warband.id, race, '', warband.name, strictTranslate);
  }
  for (const key of Object.keys(catalog).filter(k => /^skin\.(panel|editor|preview)\./.test(k))) strictTranslate(key);
}
for (const name of ['SkinModal', 'CustomSkinEditor', 'ModelPreview']) {
  const file = ts.createSourceFile(name + '.tsx', fs.readFileSync(`src/Renderer/components/MainWindow/${name}.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      assert.doesNotMatch(node.text, /[\u3400-\u9fff]/u, `${name}: hard-coded Chinese UI text`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

// Exercise the production translator, mocking only browser storage/events.
const require = createRequire(import.meta.url);
const storage = new Map<string, string>();
const browser = new EventTarget();
Object.assign(browser, { electronAPI: {} });
(globalThis as any).window = browser;
(globalThis as any).localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
const bundle = await build({ stdin: { contents: "export { reaxel_I18n } from './src/Renderer/utils/i18n';", resolveDir: process.cwd(), loader: 'ts' }, platform: 'node', format: 'cjs', external: ['react'], bundle: true, write: false });
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const i18n = module.exports.reaxel_I18n();
for (const locale of Object.keys(catalogs)) {
  i18n.setLanguage(locale);
  const caption = i18n.t('skin.editor.linkCount', { linked: 3, total: 12 });
  assert.ok(caption.includes('3') && caption.includes('12'), `${locale}: interpolated counts`);
  assert.doesNotMatch(caption, /\{\{?[\w.]+\}\}?/);
  assert.equal(i18n.t('skin.panel.targetCount', { count: 8 }), catalogs[locale]['skin.panel.targetCount'].replace(/\{\{?count\}\}?/, '8'));
  assert.equal(i18n.t('unknown.fixture.key', 'User name'), 'User name');
}
console.log(`Skin i18n passed: ${Object.keys(catalogs).length} languages, ${checked} dynamic/UI labels, no hard-coded Chinese, production interpolation and fallback.`);
