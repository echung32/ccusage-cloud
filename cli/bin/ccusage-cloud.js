#!/usr/bin/env node
// Import and invoke `run` explicitly: when launched via this bin shim, the
// module's own `import.meta.url === process.argv[1]` self-run guard is false
// (argv[1] is this launcher, not dist/index.js), so we must call run() here.
import { run } from '../dist/index.js';
run(process.argv.slice(2)).then((code) => process.exit(code));
