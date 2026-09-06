/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Same monorepo wiring as the rider app: npm hoists most packages to the
// workspace root, and `@freshfold/core` is consumed as TypeScript source from
// outside this app's directory, so Metro needs the watch folder to pick up
// edits to shared domain code.

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

// `disableHierarchicalLookup` stays off for the reason documented in the rider
// app's config: npm cannot hoist every version, and nested copies have to stay
// reachable.

module.exports = config;
