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

module.exports = config;
