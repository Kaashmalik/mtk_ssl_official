// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Support pnpm monorepo symlinks
config.watchFolders = [monorepoRoot];

// Resolve modules from monorepo root and project root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Enable symlink resolution (required for pnpm)
config.resolver.unstable_enableSymlinks = true;

module.exports = config;

