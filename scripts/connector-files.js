// One source of truth for the ZIP and the local one-click installer.
export const connectorFiles = Object.fromEntries([
  ['manifest.json', 'connector/manifest.json'],
  ...['index', 'bridge', 'diagnostics', 'theme-isolation', 'fixture-host', 'host-adapter', 'annotations', 'decoration-editor', 'picking', 'native-theme'].map(name => [`connector/${name}.js`, `connector/${name}.js`]),
  ...['core', 'variables', 'fixture', 'assets', 'tickets', 'migrations', 'decorations', 'layouts', 'editing', 'version'].map(name => [`shared/${name}.js`, `shared/${name}.js`]),
  ...['fixture-user.svg', 'fixture-guide.svg', 'fixture-landscape.svg', 'fixture-note.txt'].map(name => [`connector/assets/${name}`, `connector/assets/${name}`]),
  ['LICENSE', 'LICENSE'], ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
]);
