// Metro lit aussi la source commune au Web et au mobile (version affichée, frontière publique) :
// ../../shared ne contient que des fichiers sans dépendance. Rien d’autre du dépôt n’est surveillé.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../shared')];
// Un fichier de ../../shared résout ses éventuels modules d’exécution depuis l’application mobile.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.resolve(__dirname, 'node_modules')];

module.exports = config;
