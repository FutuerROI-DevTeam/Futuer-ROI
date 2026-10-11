import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const under = (parent, child) => { const p = relative(parent, child); return p === '' || (!p.startsWith(`..${sep}`) && p !== '..' && !isAbsolute(p)); };

export async function inventory(directory) {
  const boundary = await realpath(directory);
  const files = [];
  const ancestors = new Set();
  async function visit(path) {
    const target = await realpath(path);
    if (!under(boundary, target)) throw new Error('Bundle link escapes the function');
    const info = await stat(path);
    if (info.isDirectory()) {
      if (ancestors.has(target)) throw new Error('Bundle link cycle');
      ancestors.add(target);
      try { for (const name of (await readdir(path)).sort()) await visit(join(path, name)); }
      finally { ancestors.delete(target); }
    } else {
      const name = relative(boundary, path).split(sep).join('/');
      if (/(^|\/)\.env(?:\.|$)|(^|\/)\.local(?:\/|$)|(^|\/)\.npmrc$/.test(name)) throw new Error('Local configuration in bundle');
      const bytes = await readFile(path);
      files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await visit(boundary);
  return files;
}

export async function copyBuildDirectory(source, destination) {
  if (await realpath(source) !== resolve(source)) throw new Error('Refuse a linked build directory');
  // dereference後は元のリンク境界が失われるため、コピー元を先に検査する。
  await inventory(source);
  await cp(source, destination, { recursive: true, dereference: true });
}

export async function verifyWebAssets(webDirectory) {
  const boundary = await realpath(webDirectory);
  let references = 0;
  for (const file of await inventory(boundary)) {
    if (!/\.(?:html|css)$/.test(file.path)) continue;
    const text = await readFile(join(boundary, file.path), 'utf8');
    const pattern = file.path.endsWith('.css') ? /url\(\s*["']?([^"')\s]+)["']?\s*\)/g : /(?:src|href)=["']([^"']+)["']/g;
    for (const match of text.matchAll(pattern)) {
      const url = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      const path = decodeURIComponent(url.split(/[?#]/)[0]);
      if (!path) continue;
      const target = resolve(path.startsWith('/') ? boundary : dirname(join(boundary, file.path)), path.replace(/^\//, ''));
      if (!under(boundary, target) || !(await stat(target)).isFile()) throw new Error(`Missing/escaping Web asset: ${file.path}`);
      references++;
    }
  }
  return references;
}

export async function buildBundle() {
  const workspace = await realpath(root);
  const vercel = join(workspace, '.vercel');
  await mkdir(vercel, { recursive: true });
  if (await realpath(vercel) !== vercel) throw new Error('Refuse a linked .vercel directory');
  const output = join(vercel, 'output');
  const prior = await lstat(output).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (prior?.isSymbolicLink() || !under(workspace, output)) throw new Error('Refuse unsafe output target');
  // この専用生成先だけを更新する。project.jsonや通常checkout/DBは対象にしない。
  await rm(output, { recursive: true, force: true });
  const fn = join(output, 'functions', 'server.func');
  await mkdir(fn, { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/prediction/package.json']) {
    await mkdir(dirname(join(fn, name)), { recursive: true });
    await cp(join(workspace, name), join(fn, name));
  }
  for (const name of ['apps/api/dist', 'apps/web/dist', 'packages/prediction/dist']) {
    await copyBuildDirectory(join(workspace, name), join(fn, name));
  }
  // lock固定のAPI runtimeだけを取得。scriptsは実行せず、既存cacheを優先する。CLI login/deployを呼ばない。
  if (!process.env.npm_execpath) throw new Error('Use npm run build:vercel');
  const installed = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--workspace=@futureroi/api',
    '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: fn, stdio: 'inherit' });
  if (installed.error || installed.status !== 0) throw new Error('Runtime dependency install failed');
  const assetReferences = await verifyWebAssets(join(fn, 'apps/web/dist'));
  const files = await inventory(fn);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes > 250 * 1024 * 1024) throw new Error('Function exceeds standard 250 MiB bundle limit');
  // workspace祖先の依存で欠落を隠さないよう、Functionだけを外部Tempへ移してentryを解決する。
  const temporaryRoot = await realpath(tmpdir());
  const isolated = await mkdtemp(join(temporaryRoot, 'futureroi-vercel-import-'));
  try {
    await cp(fn, isolated, { recursive: true, dereference: true });
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
      "await import('@futureroi/prediction'); const m=await import('./apps/api/dist/vercel.js'); if(typeof m.default!=='function')throw Error('entry export');"],
      { cwd: isolated, stdio: 'inherit', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
    if (imported.error || imported.status !== 0) throw new Error('Self-contained runtime import failed');
  } finally {
    if (!under(temporaryRoot, isolated)) throw new Error('Refuse unsafe temporary cleanup');
    await rm(isolated, { recursive: true, force: true });
  }
  await writeFile(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs24.x', handler: 'apps/api/dist/vercel.js',
    launcherType: 'Nodejs', shouldAddHelpers: false }, null, 2) + '\n');
  // 全pathを既存Fastifyへ渡す。SPA fallback/asset/API判定・Cache-Controlを重複実装しない。
  await writeFile(join(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/server' }] }, null, 2) + '\n');
  const fonts = files.filter(file => /apps\/web\/dist\/.*\.woff2?$/.test(file.path)).length;
  await writeFile(join(output, 'bundle-manifest.json'), JSON.stringify({ node: process.version, bytes,
    fileCount: files.length, assetReferences, fonts, files }, null, 2) + '\n');
  console.log(JSON.stringify({ output: '.vercel/output', bytes, fileCount: files.length, assetReferences, fonts }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildBundle();
