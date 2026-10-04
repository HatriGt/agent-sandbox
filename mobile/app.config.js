// Adds Firebase config to the Android build when google-services.json is present (CI writes it from
// the GOOGLE_SERVICES_JSON secret). Without it, Android can't mint a push token and push stays off.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const file = path.join(__dirname, "google-services.json");
  if (!fs.existsSync(file)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: "./google-services.json" } };
};
