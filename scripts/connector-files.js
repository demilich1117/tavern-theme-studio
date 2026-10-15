// One source of truth for the ZIP and the local one-click installer.
export const connectorFiles = Object.fromEntries([
  ['manifest.json', 'connector/manifest.json'],
  ...['index', 'bridge', 'diagnostics', 'theme-isolation', 'fixture-host', 'host-adapter', 'annotations', 'decoration-editor', 'canvas-editor', 'canvas-navigation', 'blueprint-editor', 'responsive', 'picking', 'native-theme'].map(name => [`connector/${name}.js`, `connector/${name}.js`]),
  ['connector/responsive.html','connector/responsive.html'],
  ['connector/assets/meow-peek.webp', 'public/assets/brand/meow-peek.webp'],
  ...['core', 'variables', 'fixture', 'assets', 'tickets', 'migrations', 'decorations', 'layouts', 'editing', 'canvas', 'blueprint', 'workspace', 'version', 'message-parts', 'object-tree'].map(name => [`shared/${name}.js`, `shared/${name}.js`]),
  ...['fixture-user.svg', 'fixture-guide.svg', 'fixture-landscape.svg', 'fixture-note.txt'].map(name => [`connector/assets/${name}`, `connector/assets/${name}`]),
  ['LICENSE', 'LICENSE'], ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
]);
