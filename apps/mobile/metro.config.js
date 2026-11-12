// Metro lit aussi les contrats, la logique et la carte partagés avec le Web.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, '../../shared');
config.watchFolders = [...(config.watchFolders ?? []), shared];
// Un fichier de ../../shared résout ses éventuels modules d’exécution depuis l’application mobile.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.resolve(__dirname, 'node_modules')];

// Les composants partagés utilisent la même instance de React que l’arbre Expo.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const origin = context.originModulePath.startsWith(shared + path.sep) && /^(react(?:\/|$)|leaflet(?:\/|$))/.test(name)
    ? { ...context, originModulePath: __filename }
    : context;
  return (resolveRequest ?? context.resolveRequest)(origin, name, platform);
};

module.exports = config;
