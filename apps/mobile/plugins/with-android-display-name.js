const { AndroidConfig, withStringsXml } = require('expo/config-plugins');

module.exports = function withAndroidDisplayName(config) {
  const displayName = config.ios.infoPlist.CFBundleDisplayName;
  return withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: 'app_name' }, _: displayName }],
      mod.modResults,
    );
    return mod;
  });
};
