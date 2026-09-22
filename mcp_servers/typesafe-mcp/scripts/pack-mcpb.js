#!/usr/bin/env node

/**
 * Canonical, hardened MCPB pack script.
 *
 * Drop into scripts/pack-mcpb.js of any node-based MCP server. The script
 * reads the entry point from manifest.json so it works regardless of
 * tsc/tsup and regardless of whether the entry is dist/index.js,
 * dist/entry.js, etc.
 *
 * Guards (every step asserts; pack aborts loudly on any failure so a
 * broken .mcpb that crashes on launch in Claude Desktop cannot be
 * produced):
 *   1. npm install if node_modules is missing
 *   2. The configured build script exists and runs
 *   3. The manifest's entry_point file exists in ROOT/dist after build
 *   4. The staged tree has the entry file
 *   5. Every declared production dependency is staged in node_modules
 *   6. A staging-local .gitignore (empty) and .mcpbignore are written so
 *      `mcpb pack` does NOT fall back to a project .gitignore that
 *      excludes dist/ or node_modules/
 *   7. The produced .mcpb contains the entry file and the first prod dep
 */

import { execSync } from 'child_process';
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  realpathSync,
} from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const STAGING = resolve(ROOT, '.mcpb-staging');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`pack-mcpb: ${msg}`);
}

function readEntryFromManifest() {
  const manifestPath = join(ROOT, 'manifest.json');
  assert(existsSync(manifestPath), `manifest.json missing at ${manifestPath}`);
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = m?.server?.entry_point;
  assert(
    typeof entry === 'string' && entry.length > 0,
    'manifest.json must declare server.entry_point'
  );
  return { manifest: m, entryRel: entry };
}

try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const { manifest, entryRel } = readEntryFromManifest();

  // 1. Ensure dependencies are installed (tsc/tsup live in devDeps)
  console.log('\n=== Ensuring dependencies are installed ===');
  const nmExists =
    existsSync(join(ROOT, 'node_modules')) &&
    readdirSync(join(ROOT, 'node_modules')).length > 0;
  if (!nmExists) {
    run('npm install --no-audit --no-fund', { cwd: ROOT });
  } else {
    console.log('  node_modules present — skipping npm install');
  }

  // 2. Build the project
  console.log('\n=== Building project ===');
  assert(
    pkg?.scripts?.build,
    'package.json must define a "build" script.'
  );
  if (existsSync(join(ROOT, 'dist'))) rmSync(join(ROOT, 'dist'), { recursive: true });
  run('npm run build', { cwd: ROOT });
  assert(
    existsSync(join(ROOT, entryRel)),
    `build did not produce ${entryRel}. Check tsc/tsup config.`
  );

  // 3. Clean and create staging directory
  console.log('\n=== Preparing staging directory ===');
  if (existsSync(STAGING)) rmSync(STAGING, { recursive: true });
  mkdirSync(STAGING, { recursive: true });

  // 4. Copy production files (sync manifest version from package.json)
  console.log('\n=== Copying production files ===');
  cpSync(join(ROOT, 'dist'), join(STAGING, 'dist'), { recursive: true });
  assert(
    existsSync(join(STAGING, entryRel)),
    `staged tree missing ${entryRel} after copy.`
  );
  manifest.version = pkg.version;
  writeFileSync(
    join(STAGING, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  for (const f of ['README.md', 'LICENSE']) {
    if (existsSync(join(ROOT, f))) {
      copyFileSync(join(ROOT, f), join(STAGING, f));
    }
  }

  // 5. Create a minimal package.json with only production deps.
  //    Preserve "type" so Node treats dist/*.js as ESM/CJS as built.
  const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: pkg.main,
    bin: pkg.bin,
    dependencies: pkg.dependencies,
  };
  writeFileSync(
    join(STAGING, 'package.json'),
    JSON.stringify(prodPkg, null, 2)
  );

  // 6. Copy production dependencies (resolves file: vendor links too).
  //    `npm ls` returns non-zero whenever any warning appears (unmet,
  //    extraneous, peer mismatch, etc.) even though stdout is still
  //    correct. Capture stdout regardless of exit code.
  console.log('\n=== Copying production dependencies ===');
  let prodPathsRaw = '';
  try {
    prodPathsRaw = execSync('npm ls --omit=dev --parseable --all', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    prodPathsRaw = err.stdout ? err.stdout.toString() : '';
  }
  // Split npm's --parseable output into two worlds:
  //   * paths under ROOT — npm already deduplicated those, keep them all;
  //   * external paths, which exist only because a file:-linked vendor lib
  //     (e.g. node_modules/node-panos -> ../../mcp_node/node-panos) drags its
  //     OWN node_modules into `npm ls` output. Those hold the vendor's dev
  //     toolchain (typescript, vitest, vite, rollup, esbuild, lightningcss…)
  //     sitting right next to its genuine runtime deps.
  //
  //    The old heuristic kept an external path when the substring
  //    "node_modules" appeared EXACTLY ONCE, on the theory that this describes
  //    "the vendor package root". It does not, and the test was inverted in
  //    practice: a vendor root such as mcp_node/node-panos contains
  //    "node_modules" ZERO times (it is staged through the in-ROOT symlink
  //    path instead), while every one of that vendor's own devDependencies —
  //    mcp_node/node-panos/node_modules/typescript — contains it exactly once.
  //    So the filter admitted precisely the paths it meant to reject, which is
  //    what inflated panos-mcp.mcpb to 30MB / 3022 files.
  //
  //    Dropping every external path is equally wrong: node-panos's runtime dep
  //    fast-xml-parser (and its own dep strnum) is NOT hoisted into
  //    ROOT/node_modules and lives only inside the vendor's node_modules, so a
  //    blanket reject yields a small bundle that dies at launch with
  //    "Cannot find module 'fast-xml-parser'".
  //
  //    Correct rule: compute each vendor's PRODUCTION closure from package.json
  //    "dependencies", transitively, and keep an external path only when it is
  //    the resolved directory of a package in that closure.
  const rootPaths = [];
  const externalPaths = [];
  for (const line of prodPathsRaw.split('\n')) {
    const p = line.trim();
    if (!p.includes('node_modules')) continue;
    (p.startsWith(ROOT + '/') ? rootPaths : externalPaths).push(p);
  }

  // Resolve a package by name the way Node would from `fromDir`: the vendor's
  // own node_modules first, then the server root's (hoisted) node_modules.
  function resolvePkgDir(name, fromDir) {
    const candidates = [
      join(fromDir, 'node_modules', name),
      join(ROOT, 'node_modules', name),
    ];
    for (const dir of candidates) {
      if (existsSync(join(dir, 'package.json'))) return dir;
    }
    return null;
  }

  // Transitive "dependencies" closure of a vendor root as name -> real dir.
  // devDependencies are deliberately never followed: that is the whole point.
  function prodClosure(vendorRoot) {
    const closure = new Map();
    let queue;
    try {
      const vpkg = JSON.parse(
        readFileSync(join(vendorRoot, 'package.json'), 'utf8')
      );
      queue = Object.keys(vpkg.dependencies || {});
    } catch {
      return closure;
    }
    while (queue.length > 0) {
      const name = queue.shift();
      if (closure.has(name)) continue;
      const dir = resolvePkgDir(name, vendorRoot);
      if (!dir) continue;
      closure.set(name, realpathSync(dir));
      try {
        const dpkg = JSON.parse(
          readFileSync(join(dir, 'package.json'), 'utf8')
        );
        queue.push(...Object.keys(dpkg.dependencies || {}));
      } catch {}
    }
    return closure;
  }

  // Union the closures of every vendor referenced by an external path. The
  // vendor root is the path prefix ahead of its FIRST node_modules segment —
  // and that segment may be an iCloud twin ("node_modules.nosync.noindex"),
  // so the split has to match those names too. Splitting on the literal
  // "/node_modules/" alone mistakes e.g.
  //   mcp_node/node-spanning/node_modules.nosync.noindex/eslint
  // for a vendor root and would pull eslint's own closure (ajv 6, minimatch 3…)
  // into the bundle — the exact AJV 6-vs-8 collision this script already fixed
  // once. Packages that exist ONLY inside a .nosync twin are never staged:
  // Node's resolver does not read those directories, so they cannot be
  // runtime deps, and resolvePkgDir() deliberately looks only at real
  // node_modules directories.
  const NM_SEGMENT = /\/node_modules(?:\.nosync(?:\.noindex)?)?\//;
  const vendorClosure = new Map();
  const allowedExternalDirs = new Set();
  for (const vendorRoot of new Set(
    externalPaths.map((p) => p.split(NM_SEGMENT)[0])
  )) {
    for (const [name, dir] of prodClosure(vendorRoot)) {
      vendorClosure.set(name, dir);
      allowedExternalDirs.add(dir);
    }
  }

  const prodPaths = [
    ...rootPaths,
    ...externalPaths.filter((p) => {
      try {
        return allowedExternalDirs.has(realpathSync(p));
      } catch {
        return false;
      }
    }),
  ];
  console.log(`  ${prodPaths.length} production packages`);
  for (const absPath of prodPaths) {
    // Compute relative path against ROOT so file:../../vendor links land
    // under STAGING/node_modules/<name>/ correctly.
    let relPath;
    if (absPath.startsWith(ROOT + '/')) {
      relPath = absPath.slice(ROOT.length + 1);
    } else {
      // Vendor lives outside ROOT (file: link). Re-key it under
      // STAGING/node_modules/<package-name>/.
      let depName;
      try {
        const dpkg = JSON.parse(
          readFileSync(join(absPath, 'package.json'), 'utf8')
        );
        depName = dpkg.name;
      } catch {
        continue;
      }
      relPath = `node_modules/${depName}`;
    }
    const destPath = join(STAGING, relPath);
    if (existsSync(absPath)) {
      mkdirSync(join(destPath, '..'), { recursive: true });
      // npm represents a file:-linked vendor lib (e.g. node_modules/node-vanta
      // -> ../../mcp_node/node-vanta) as a SYMLINK. cpSync without dereference
      // recreates the symlink, and `mcpb pack` then dereferences it and archives
      // the whole target - including the lib's dev toolchain. Copy the REAL dir
      // and filter out two things that only bloat the bundle:
      //   1. any nested node_modules/ (the lib's own dev/peer deps; its runtime
      //      deps are hoisted to ROOT/node_modules and staged via their own paths)
      //   2. any iCloud "node_modules.nosync.noindex" twin (Node's resolver never
      //      reads a .nosync* directory). This twin was the dominant cause of the
      //      50-100MB connector .mcpb files; the other variants' regexes missed it.
      const realSrc = realpathSync(absPath);
      cpSync(realSrc, destPath, {
        recursive: true,
        dereference: true,
        filter: (src) => {
          const rel = src.slice(realSrc.length).replace(/\\/g, '/');
          return !/\/node_modules(\.nosync(\.noindex)?)?(\/|$)/.test(rel);
        },
      });
    }
  }
  for (const dep of Object.keys(pkg.dependencies || {})) {
    assert(
      existsSync(join(STAGING, 'node_modules', dep)),
      `production dependency "${dep}" not staged. Run npm install at ROOT and retry.`
    );
  }
  // Same guard for the file:-linked vendors' own runtime deps. The loop above
  // only sees THIS server's direct pkg.dependencies, so it is blind to
  // node-panos -> fast-xml-parser -> strnum. That blind spot is exactly why a
  // broken external filter could ship: the bundle stayed "verified" while its
  // vendor lib had no XML parser to require at runtime.
  for (const name of vendorClosure.keys()) {
    assert(
      existsSync(join(STAGING, 'node_modules', name)),
      `vendor production dependency "${name}" not staged — the file:-linked vendor needs it at runtime.`
    );
  }

  // 7. Trim staged dependencies
  // Belt-and-suspenders: drop any iCloud node_modules twins that slipped in.
  run(
    'find . -type d -name "*.nosync.noindex" -prune -exec rm -rf {} + 2>/dev/null || true',
    { cwd: STAGING }
  );
  run(
    'find . -type d -name "*.nosync" -prune -exec rm -rf {} + 2>/dev/null || true',
    { cwd: STAGING }
  );
  run('find dist -name "*.map" -delete 2>/dev/null || true', { cwd: STAGING });
  run(
    'find node_modules -type d \\( -name test -o -name tests -o -name __tests__ -o -name examples -o -name example -o -name .github \\) -exec rm -rf {} + 2>/dev/null || true',
    { cwd: STAGING }
  );
  run(
    'find node_modules -type f \\( -name "*.map" -o -name "CHANGELOG*" -o -name "HISTORY*" -o -name "CONTRIBUTING*" -o -name ".eslintrc*" -o -name ".prettierrc*" -o -name "tsconfig.json" -o -name "tsup.config*" -o -name "vitest.config*" \\) -delete 2>/dev/null || true',
    { cwd: STAGING }
  );

  // 8. Write a staging-local .mcpbignore AND empty .gitignore so
  //    `mcpb pack` does NOT walk up and use a project .gitignore that
  //    excludes dist/ or node_modules/.
  const mcpbIgnore = [
    'node_modules/.cache',
    'node_modules/.bin',
    '*.nosync.noindex',
    '*.nosync',
    'node_modules/*/test/',
    'node_modules/*/tests/',
    'node_modules/*/__tests__/',
    'node_modules/*/docs/',
    'node_modules/*/.github/',
    'node_modules/*/example/',
    'node_modules/*/examples/',
    'node_modules/*/CHANGELOG*',
    'node_modules/*/HISTORY*',
    'node_modules/*/CONTRIBUTING*',
    'node_modules/*/AUTHORS*',
    'node_modules/*/.eslint*',
    'node_modules/*/.prettier*',
    'node_modules/*/tsconfig.json',
    '*.map',
    '*.tgz',
    '*.mcpb',
    '',
  ].join('\n');
  writeFileSync(join(STAGING, '.mcpbignore'), mcpbIgnore);
  writeFileSync(join(STAGING, '.gitignore'), '');

  // 9. Pack the bundle
  console.log('\n=== Packing MCPB bundle ===');
  const bundleName = pkg.name.replace(/^@.*\//, '');
  const bundlePath = join(ROOT, `${bundleName}.mcpb`);
  if (existsSync(bundlePath)) rmSync(bundlePath);
  run(`npx --yes @anthropic-ai/mcpb pack "${STAGING}" "${bundlePath}"`, {
    cwd: ROOT,
  });
  assert(existsSync(bundlePath), `mcpb pack did not produce ${bundlePath}.`);

  // 10. Verify the produced bundle actually contains the entry file and
  //     a production dependency. Use targeted `unzip -l <bundle> <path>`
  //     rather than listing the entire archive (large bundles overflow
  //     execSync's default 1 MB stdout buffer with ENOBUFS).
  console.log('\n=== Verifying bundle ===');
  function bundleHas(relPath) {
    try {
      execSync(`unzip -l "${bundlePath}" "${relPath}"`, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }
  assert(
    bundleHas(entryRel),
    `bundle is missing ${entryRel}. Likely .gitignore filtered dist/.`
  );
  const firstDep = Object.keys(pkg.dependencies || {})[0];
  if (firstDep) {
    assert(
      bundleHas(`node_modules/${firstDep}/package.json`),
      `bundle is missing node_modules/${firstDep}/.`
    );
  }
  // Get file count from `unzip -Z -1` end summary (single line), not full listing
  let fileCount = 'unknown';
  try {
    const tail = execSync(
      `unzip -l "${bundlePath}" | tail -n 1`,
      { encoding: 'utf8' }
    ).trim();
    const m = tail.match(/(\d+)\s+file/);
    if (m) fileCount = m[1];
  } catch {}
  console.log(`  verified ${entryRel} and node_modules present in bundle`);

  // 11. Cleanup — use force+retries to survive transient fs races on macOS.
  console.log('\n=== Cleanup ===');
  rmSync(STAGING, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });

  console.log('\n=== Done! ===');
  const stats = statSync(bundlePath);
  console.log(
    `Bundle: ${bundleName}.mcpb (${(stats.size / 1024 / 1024).toFixed(1)}MB, ${
      fileCount
    } files)`
  );
} catch (error) {
  console.error('Pack failed:', error.message);
  if (existsSync(STAGING)) {
    try {
      rmSync(STAGING, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch (e) {
      console.error('  also failed to clean staging:', e.message);
    }
  }
  process.exit(1);
}
