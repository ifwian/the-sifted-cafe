// Runs every *.test.js file in a folder with Node's built-in test runner.
//   node scripts/run-tests.js tests/unit
// (We list the files ourselves because passing a folder name to "node --test"
// behaves differently between Node versions.)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/run-tests.js <folder>');
  process.exit(2);
}

const folder = path.resolve(__dirname, '..', dir);
const files = fs.existsSync(folder)
  ? fs.readdirSync(folder).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(folder, f))
  : [];

if (files.length === 0) {
  console.error(`No *.test.js files found in ${dir}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
