import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = resolve(projectRoot, 'node_modules/typescript/bin/tsc');
const seedConfig = resolve(projectRoot, 'prisma/tsconfig.seed.json');
const compiledSeed = resolve(projectRoot, 'dist-seed/prisma/seed.js');

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

runNode([compiler, '--project', seedConfig], 'Seed compilation');
runNode([compiledSeed], 'Seed execution');
