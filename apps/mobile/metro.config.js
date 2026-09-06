/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Metro has to be told about the monorepo explicitly: npm hoists most packages
// to the workspace root, and `@freshfold/core` is consumed as TypeScript source
// from outside this app's directory. Without the watch folder, edits to shared
// domain code would not trigger a rebuild.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Note: `disableHierarchicalLookup` is deliberately left off. npm cannot hoist
// every version — react-native-reanimated needs semver 7 while semver 6 wins
// the root slot, so its copy stays nested in its own node_modules. Turning off
// hierarchical lookup makes those nested copies unreachable and the bundle
// fails to resolve them.

module.exports = config;
