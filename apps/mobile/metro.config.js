// Metro config for an npm-workspaces monorepo (per Expo's monorepo guide):
// watch the whole repo so edits to @setflow/* packages hot-reload, and
// resolve modules from both the app's and the root's node_modules.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// The monorepo holds two React copies (the web app's at the root, this
// app's SDK-matched one nested here). Force every react* import - wherever
// it originates - to resolve from THIS app so the bundle never mixes them
// (mixing = "Invalid hook call" at runtime).
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned =
    moduleName === "react" ||
    moduleName === "react-dom" ||
    moduleName === "react-native" ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-dom/") ||
    moduleName.startsWith("react-native/");
  const ctx = pinned
    ? { ...context, originModulePath: path.join(projectRoot, "index.ts") }
    : context;
  const resolve = defaultResolveRequest ?? ctx.resolveRequest;
  return resolve(ctx, moduleName, platform);
};

module.exports = config;

