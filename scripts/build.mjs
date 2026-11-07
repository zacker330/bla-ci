import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createPackage, extractFile, getRawHeader, listPackage } from '@electron/asar';
import { packager } from '@electron/packager';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);
const blaCLI = path.join(path.dirname(require.resolve('bla-agents')), 'cli.js');
const dependencies = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies;
const application = JSON.parse(readFileSync(path.join(root, 'app/package.json'), 'utf8'));
const appFiles = ['package.json', 'main.cjs', 'preload.cjs', 'quote.cjs', 'renderer.js', 'index.html', 'style.css'];
const seed = 'bla-ci-demo-v1';
const intensity = 'bankrupt';
const started = performance.now();
const timingsMs = {};

function writeJSON(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

function relative(filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

function runBla(name, args) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [blaCLI, ...args, '--json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000
  });
  writeFileSync(path.join(dist, 'reports', `${name}.json`), result.stdout ?? '');
  writeFileSync(path.join(dist, 'reports', `${name}.stderr.log`), result.stderr ?? '');
  if (result.error || result.status !== 0) {
    throw new Error(`BLA ${name} failed (exit ${result.status}): ${result.error?.message ?? result.stderr}. See dist/reports/${name}.json`);
  }
  timingsMs[name] = Math.round(performance.now() - start);
  return JSON.parse(result.stdout);
}

function describeAsar(filename) {
  const { headerString } = getRawHeader(filename);
  return {
    path: relative(filename),
    bytes: statSync(filename).size,
    headerBytes: Buffer.byteLength(headerString),
    entries: listPackage(filename).length,
    sha256: sha256(filename)
  };
}

function executablePath(directory) {
  if (process.platform === 'darwin') return path.join(directory, 'BlaCiDemo.app/Contents/MacOS/BlaCiDemo');
  return path.join(directory, process.platform === 'win32' ? 'BlaCiDemo.exe' : 'BlaCiDemo');
}

function packagedAsarPath(directory) {
  const resources = process.platform === 'darwin' ? 'BlaCiDemo.app/Contents/Resources' : 'resources';
  return path.join(directory, resources, 'app.asar');
}

rmSync(dist, { recursive: true, force: true });
for (const directory of ['staging/app', 'asar/original', 'asar/hardened', 'reports', 'artifacts']) {
  mkdirSync(path.join(dist, directory), { recursive: true });
}

const staged = path.join(dist, 'staging/app');
for (const filename of appFiles) cpSync(path.join(root, 'app', filename), path.join(staged, filename));
const original = path.join(dist, 'asar/original/app.asar');
const hardened = path.join(dist, 'asar/hardened/app.asar');
await createPackage(staged, original);
const originalDigest = sha256(original);

runBla('audit-before', ['audit', original]);
runBla('protect', ['protect', original, '-o', hardened, '--intensity', intensity, '--seed', seed]);
const verification = runBla('verify', ['verify', hardened, original]);
assert.equal(verification.overallPassed, true, 'BLA verification must pass');
assert.equal(sha256(original), originalDigest, 'The original ASAR must stay unchanged');

const asars = { original: describeAsar(original), hardened: describeAsar(hardened) };
assert.notEqual(asars.original.sha256, asars.hardened.sha256);
assert.ok(asars.hardened.headerBytes > 16 * 1024 * 1024, 'Expected the pinned bankrupt ASAR header amplification');
for (const filename of appFiles) {
  const protectedContent = extractFile(hardened, filename);
  if (/\.(cjs|js)$/.test(filename)) {
    assert.notDeepEqual(protectedContent, extractFile(original, filename), `${filename} should be transformed`);
  } else {
    assert.deepEqual(protectedContent, extractFile(original, filename), `${filename} should be preserved`);
  }
}

const variants = {};
for (const [name, asar] of Object.entries({ original, hardened })) {
  const start = performance.now();
  const [directory] = await packager({
    dir: staged,
    prebuiltAsar: asar,
    out: path.join(dist, 'packages', name),
    name: 'BlaCiDemo',
    appBundleId: 'codes.showme.bla-ci-demo',
    appVersion: application.version,
    electronVersion: dependencies.electron,
    platform: process.platform,
    arch: process.arch,
    overwrite: true,
    quiet: true
  });
  const executable = executablePath(directory);
  const packagedAsar = packagedAsarPath(directory);
  assert.ok(statSync(executable).isFile(), 'Packaged executable must exist');
  assert.equal(sha256(packagedAsar), sha256(asar), `${name} package must contain the intended ASAR`);
  variants[name] = { directory: relative(directory), executable: relative(executable), asar: relative(packagedAsar), sha256: sha256(packagedAsar) };
  timingsMs[`package-${name}`] = Math.round(performance.now() - start);
}

const archive = path.join(dist, 'artifacts', `bla-ci-demo-${process.platform}-${process.arch}.tar.gz`);
const protectedDirectory = path.resolve(root, variants.hardened.directory);
const tar = spawnSync('tar', ['-czf', archive, '-C', path.dirname(protectedDirectory), path.basename(protectedDirectory)], { encoding: 'utf8', timeout: 120000 });
if (tar.error || tar.status !== 0) throw new Error(`App archiving failed: ${tar.error?.message ?? tar.stderr}`);

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const manifest = {
  schema: 'bla-ci-build/v1',
  createdAt: new Date().toISOString(),
  revision: process.env.GITHUB_SHA ?? (revision.status === 0 ? revision.stdout.trim() : 'working-tree'),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  dependencies,
  intensity,
  seed,
  asars,
  variants,
  archive: { path: relative(archive), bytes: statSync(archive).size, sha256: sha256(archive) },
  timingsMs: { ...timingsMs, total: Math.round(performance.now() - started) },
  evidence: 'BLA verify is a static simulation. Application behavior is checked separately by test:e2e.'
};
writeJSON(path.join(dist, 'build.json'), manifest);
writeFileSync(`${archive}.sha256`, `${manifest.archive.sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ asars, archive: manifest.archive, timingsMs: manifest.timingsMs }, null, 2));
