const ts = require('typescript');
module.exports = function productionCatalog(source) {
  if (this.resourcePath?.endsWith('.css')) return source.replace(/^.*\.home-offline-test-button[^\n]*\n?/gm, '');
  const file = ts.createSourceFile(this.resourcePath || 'locale.ts', source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = property.name && (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)) ? property.name.text : '';
        if (name.startsWith('main.offlineTest.')) {
          let end = property.end;
          if (source[end] === ',') end++;
          edits.push([property.getFullStart(), end]);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const [start, end] of edits.sort((a,b) => b[0]-a[0])) source = source.slice(0,start)+source.slice(end);
  return source;
};
