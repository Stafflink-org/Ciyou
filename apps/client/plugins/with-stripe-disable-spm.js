const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withStripeDisableSPM(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      const directive = '$StripeDisableSPM = true';
      const contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes(directive)) {
        fs.writeFileSync(podfilePath, `${directive}\n${contents}`);
      }

      return config;
    },
  ]);
};
