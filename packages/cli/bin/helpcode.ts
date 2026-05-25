#!/usr/bin/env node
/**
 * Entry shim for the published `helpcode` command.
 */

import { run } from '../src/index.js';

run(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(err);
    process.exit(1);
  },
);
