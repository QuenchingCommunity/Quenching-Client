import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const nameOf = (node) => node && (ts.isStringLiteral(node) || ts.isIdentifier(node)) ? node.text : null;

const readSource = (filePath) => {
  const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Invalid catalog syntax: ${filePath}`);
  return source;
};

/** Read the actual statically imported locale files, preserving duplicate keys for validation. */
export function readI18nCatalogs(projectRoot) {
  const indexPath = path.join(projectRoot, 'src/Renderer/utils/i18n/locales/index.ts');
  const source = readSource(indexPath);
  const imports = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.name && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
  }
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(item => nameOf(item.name) === 'translations');
  if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    throw new Error('translations object not found');
  }

  const languages = new Map();
  const duplicates = [];
  for (const locale of declaration.initializer.properties) {
    if (!ts.isPropertyAssignment(locale) || !ts.isIdentifier(locale.initializer)) {
      throw new Error('Expected a static locale import');
    }
    const language = nameOf(locale.name);
    const relativePath = imports.get(locale.initializer.text);
    if (!language || !relativePath?.startsWith('./')) throw new Error('Invalid locale import');
    const filePath = path.resolve(path.dirname(indexPath), `${relativePath}.ts`);
    const localeSource = readSource(filePath);
    const messages = localeSource.statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations])
      .find(item => nameOf(item.name) === 'messages')?.initializer;
    if (!messages || !ts.isObjectLiteralExpression(messages)) throw new Error(`messages object not found: ${filePath}`);
    const entries = new Map();
    for (const item of messages.properties) {
      if (!ts.isPropertyAssignment(item)) throw new Error(`Invalid translation entry: ${filePath}`);
      const key = nameOf(item.name);
      const value = item.initializer;
      if (!key || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
        throw new Error(`Expected a literal translation: ${filePath}`);
      }
      if (entries.has(key)) duplicates.push(`${language}: ${key}`);
      entries.set(key, value.text);
    }
    if (languages.has(language)) throw new Error(`Duplicate locale: ${language}`);
    languages.set(language, entries);
  }
  if (languages.size === 0) throw new Error('No locale catalogs found');
  return { languages, duplicates };
}
