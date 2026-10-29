import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readI18nCatalogs } from './lib/read-i18n-catalogs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const review = fs.readFileSync(path.join(root, 'docs/review/SETTINGS_COPY_REVIEW_ZH_CN.md'), 'utf8');
const catalog = readI18nCatalogs(root).languages.get('zh-CN');
const text = key => {
  assert(catalog.has(key), `Missing translation: ${key}`);
  return catalog.get(key);
};
const sections = new Map([...review.matchAll(/^### (\d+)\. (.+)\r?\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)]
  .map(match => [Number(match[1]), { title: match[2], body: match[3] }]));
const tableRows = body => {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith('|'));
  const result = [];
  for (let i = start + 2; start >= 0 && i < lines.length && lines[i].startsWith('|'); i++) {
    result.push(lines[i].split('|').slice(1, -1).map(cell => cell.trim()));
  }
  return result;
};
const row = (labelKey, descriptionKey = labelKey) => ({ labelKey, descriptionKey });
const toggle = prefix => [
  { labelKey: 'settings.btn.turnon', descriptionKey: `${prefix}.on.desc` },
  { labelKey: 'settings.btn.turnoff', descriptionKey: `${prefix}.off.desc` },
];
const definitions = [
  ['water', 'settings.water.title', ['off', 'realistic', 'transparent'].map(value => row(`settings.water.${value}`, `settings.water.${value}.desc`))],
  ['foliage', 'settings.foliage.title', toggle('settings.foliage')],
  ['blight', 'settings.blight.title', toggle('settings.blight')],
  ['object-shader', 'settings.shader.title', toggle('settings.shader')],
  ['post-processing', 'settings.postprocessing.title', toggle('settings.postprocessing')],
  ['outline', 'settings.postprocessing.outline.title', ['turnon', 'turnoff'].map(value => row(`settings.btn.${value}`, 'settings.postprocessing.outline.desc'))],
  ['bloom', 'settings.postprocessing.glow.title', toggle('settings.postprocessing.glow')],
  ['readability', 'settings.readability.title', ['turnon', 'turnoff'].map(value => row(`settings.btn.${value}`, 'settings.readability.desc'))],
  ['hero-glow', 'settings.glow.title', ['strong', 'weak'].map(value => row(`settings.glow.${value}`, `settings.glow.${value}.desc`))],
  ['anti-harmony', 'settings.antiharmony.title', toggle('settings.antiharmony')],
  ['ui', 'settings.ui.style', ['classic', 'quenching', 'blizzard'].map(value => row(`settings.ui.${value}`, `settings.ui.${value}.desc`))],
  ['terrain', 'settings.terrain.style', ['original', 'decisive', 'latest', 'tree.height.16', 'tree.height.18', 'retro'].map(value => row(value.startsWith('tree.') ? `settings.${value}` : `settings.terrain.${value}`))],
  ['trees', 'settings.tree.style', ['original', 'tall', 'short', 'height.18', 'height.16', 'terrain.retro'].map(value => row(value.startsWith('terrain.') ? `settings.${value}` : `settings.tree.${value}`))],
  ['lighting', 'settings.lighting', ['standard', 'level4'].map(value => row(`settings.lighting.${value}`))],
  ['brightness', 'settings.lighting.brightness', [1, 2, 3, 4, 5].map(value => ({ label: String(value), descriptionKey: 'settings.lighting.brightness.desc' }))],
  ['reset', 'settings.basic.resetRendering', [row('settings.basic.resetRendering', 'settings.basic.resetRendering.desc')]],
  ['uninstall', 'settings.basic.deleteMod', [row('settings.basic.deleteMod', 'settings.basic.deleteMod.desc')]],
];
const groups = definitions.map(([id, titleKey, options], index) => {
  const section = sections.get(index + 1);
  assert(section, `Missing review section: ${index + 1}`);
  const suggestions = tableRows(section.body);
  const originalTitle = text(titleKey);
  const suggestedTitle = section.body.match(/建议名称：\*\*(.+?)\*\*/)?.[1] || originalTitle;
  const rows = options.map((option, optionIndex) => {
    const cells = suggestions.length === 1 ? suggestions[0] : suggestions[optionIndex];
    assert(cells, `Missing suggestion for ${id}/${optionIndex}`);
    const originalLabel = option.label ?? text(option.labelKey);
    return {
      id: `${id}-${optionIndex + 1}`,
      originalLabel,
      suggestedLabel: id === 'trees' && optionIndex === 5 ? '复古树木' : originalLabel,
      original: text(option.descriptionKey),
      suggestion: id === 'brightness'
        ? `${cells.at(-1)}。调节当前光照的明暗。觉得画面太暗时调高，太亮时调低。`
        : cells.at(-1),
      binding: { labelKey: option.labelKey || null, descriptionKey: option.descriptionKey,
        sharedWithLabel: option.labelKey === option.descriptionKey,
        sharedDescription: options.filter(other => other.descriptionKey === option.descriptionKey).length > 1 },
    };
  });
  return {
    id, category: index < 10 ? '画面设置' : index < 15 ? '游戏设置' : '基础',
    originalTitle, suggestedTitle, titleKey, rows,
    context: section.body.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('|') && !line.startsWith('建议名称：'))
      .join('\n').replace(/\*\*/g, ''),
  };
});
assert.equal(groups.length, 17);
assert.equal(groups.reduce((total, group) => total + group.rows.length, 0), 45);
const prompts = tableRows(review.split('## 四、限制提示与通用说明')[1].split('## 五、')[0]);
groups.push({ id: 'messages', category: '通用提示', originalTitle: '限制提示与通用说明', suggestedTitle: '限制提示与通用说明',
  titleKey: null, context: '部分条件目前只有按钮禁用，没有单独提示。你可以在这里写希望玩家看到的文字。',
  rows: prompts.map(([label, original, suggestion], index) => ({ id: `message-${index + 1}`, originalLabel: label,
    suggestedLabel: label, original, suggestion, binding: null })),
});
const seed = { schema: 'quenching-settings-copy-review', version: 1, sourceDate: '2026-10-26', groups };
const template = fs.readFileSync(path.join(root, 'scripts/templates/settings-copy-editor.html'), 'utf8');
assert.equal(template.split('__SETTINGS_EDITOR_SEED__').length, 2);
const output = path.join(root, 'docs/review/settings-copy-editor.html');
const json = JSON.stringify(seed).replace(/</g, '\\u003c');
fs.writeFileSync(output, template.replace('__SETTINGS_EDITOR_SEED__', () => json), 'utf8');
console.log(`Created ${output}: 17 settings, 45 states/actions, ${prompts.length} shared prompts.`);
