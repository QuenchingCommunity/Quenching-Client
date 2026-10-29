import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readI18nCatalogs } from './lib/read-i18n-catalogs.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const translationsPath = path.join(projectRoot, 'src/Renderer/utils/i18n.ts');
const literalOf = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const { languages, duplicates } = readI18nCatalogs(projectRoot);

const used = new Set();
const walkFiles = (folder) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath);
    else if (/\.tsx?$/.test(entry.name) && fullPath !== translationsPath) {
      const file = ts.createSourceFile(fullPath, fs.readFileSync(fullPath, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isIdentifier(node.expression) && node.expression.text === 't') {
          const key = literalOf(node.arguments[0]);
          if (key !== null) used.add(key);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
};
walkFiles(path.join(projectRoot, 'src/Renderer'));

const zh = languages.get('zh-CN');
const en = languages.get('en-US');
if (!zh || !en) throw new Error('Chinese and English catalogs are required');
const missingUsed = [...used].filter((key) => !zh.has(key) || !en.has(key)).sort();
const allKeys = new Set([...zh.keys(), ...en.keys()]);
const missing = [...languages].map(([locale, entries]) => [locale, [...allKeys].filter((key) => !entries.has(key))]);
const placeholders = (value) => [...value.matchAll(/\{\{[\w.]+\}\}|\{[\w.]+\}/g)].map((match) => match[0]).sort().join(',');
const mismatchedPlaceholders = [...zh.keys()].filter((key) => en.has(key) && placeholders(zh.get(key)) !== placeholders(en.get(key)));
const localePlaceholderMismatches = [...languages].filter(([locale]) => locale !== 'zh-CN').flatMap(([locale, entries]) =>
  [...zh.keys()].filter((key) => entries.has(key) && placeholders(zh.get(key)) !== placeholders(entries.get(key))).map((key) => `${locale}: ${key}`)
);

console.log(`Languages: ${[...languages].map(([locale, entries]) => `${locale}=${entries.size}`).join(', ')}`);
console.log(`Renderer literal translation keys: ${used.size}`);
console.log(`Missing used keys in zh-CN or en-US: ${missingUsed.length}`, missingUsed.slice(0, 40));
console.log(`Duplicate catalog keys: ${duplicates.length}`, duplicates.slice(0, 40));
console.log(`zh-CN / en-US placeholder mismatches: ${mismatchedPlaceholders.length}`, mismatchedPlaceholders.slice(0, 40));
console.log(`All locale placeholder mismatches: ${localePlaceholderMismatches.length}`, localePlaceholderMismatches.slice(0, 40));
console.log(`Missing catalog keys by locale: ${missing.map(([locale, keys]) => `${locale}=${keys.length}`).join(', ')}`);
if (process.env.SHOW_MISSING_I18N) console.log('Missing keys:', missing.find(([locale]) => locale === 'fr-FR')?.[1]);
const sameAsEnglish = [...languages].filter(([locale]) => !['zh-CN', 'en-US'].includes(locale)).map(([locale, entries]) => [locale, [...entries].filter(([key, value]) => en.get(key) === value && /[a-z]{3}/i.test(value)).map(([key]) => key)]);
console.log(`Values identical to English by locale: ${sameAsEnglish.map(([locale, keys]) => `${locale}=${keys.length}`).join(', ')}`);
if (process.env.SHOW_MISSING_I18N) console.log('Same as English:', sameAsEnglish.find(([locale]) => locale === 'fr-FR')?.[1].slice(0, 80));
console.log(`Used values identical to English by locale: ${sameAsEnglish.map(([locale, keys]) => `${locale}=${keys.filter((key) => used.has(key)).length}`).join(', ')}`);
if (process.env.SHOW_USED_ENGLISH) console.log('Used values identical to English (fr-FR):', sameAsEnglish.find(([locale]) => locale === 'fr-FR')?.[1].filter((key) => used.has(key)));
if (missingUsed.length || duplicates.length || localePlaceholderMismatches.length || missing.some(([, keys]) => keys.length)) process.exitCode = 1;
