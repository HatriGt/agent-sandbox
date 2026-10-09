module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Must stay last: react-native-worklets (reanimated 4) rewrites worklet closures.
    plugins: ["react-native-worklets/plugin"],
  };
};
