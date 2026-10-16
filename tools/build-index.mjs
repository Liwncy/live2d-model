#!/usr/bin/env node
/**
 * build-index.mjs — 扫描 models/ 生成 index.json
 *
 * 用法：
 *   node tools/build-index.mjs           生成 / 更新 index.json
 *   node tools/build-index.mjs --check   只校验不写盘，用于 CI
 *
 * 零依赖，Node 18+。
 *
 * 行为：不做任何门槛。
 *   models/ 下每个包含文件的目录都会被写进 index.json，一切异常（缺入口、
 *   引用文件不存在、体积超限、meta.json 损坏）只作为提示打印，不阻止收录。
 *   --check 模式：只校验不写盘，用于 CI，比对 index.json 是否与当前 models/ 一致。
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT, 'models');
const INDEX_PATH = path.join(ROOT, 'index.json');
const META_FILE = 'meta.json';

/** jsDelivr 单文件上限（GitHub 端点）：20MB，超出后直链直接失效 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** jsDelivr 单个仓库默认上限：150MB */
const MAX_REPO_BYTES = 150 * 1024 * 1024;

const CHECK_ONLY = process.argv.includes('--check');

const warnings = [];

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
const warn = (msg) => { warnings.push(msg); console.log(`  ! ${msg}`); };

// ---------------------------------------------------------------------------

/** 递归列出目录下所有文件（绝对路径） */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/** 从 git remote 解析 owner/repo */
function detectRepoSlug() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    /* 没有 remote 时走兜底 */
  }
  return null;
}

/** meta.order：数字越小越靠前；缺省或非法值返回 null，生成时排到最后 */
function readOrder(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** 从 moc3 二进制头部读 Cubism 版本（魔数 MOC3 + 1 字节版本号） */
async function readMoc3Version(mocPath) {
  try {
    const fd = await readFile(mocPath);
    if (fd.length < 5) return null;
    if (fd.subarray(0, 4).toString('ascii') !== 'MOC3') return null;
    return fd[4];
  } catch {
    return null;
  }
}

/** 收集 model3.json 里引用到的所有相对路径 */
function collectRefs(refs) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.length) out.add(v); };

  add(refs.Moc);
  add(refs.Physics);
  add(refs.Pose);
  add(refs.DisplayInfo);
  add(refs.UserData);
  for (const tex of refs.Textures ?? []) add(tex);
  for (const exp of refs.Expressions ?? []) add(exp?.File);
  for (const group of Object.values(refs.Motions ?? {})) {
    for (const motion of group ?? []) add(motion?.File);
  }
  return out;
}

// ---------------------------------------------------------------------------

async function buildModelEntry(dirName) {
  const absDir = path.join(MODELS_DIR, dirName);
  const relDir = path.posix.join('models', dirName);
  const entries = await readdir(absDir, { withFileTypes: true });

  // ---- 1. 入口文件（Cubism3 的 *.model3.json 或 Cubism2 的 *.model.json；缺了照收）----
  const model3Name = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.model3.json') || e.name.endsWith('.model.json')))
    .map((e) => e.name)
    .sort()[0] ?? null;

  if (!model3Name) {
    warn(`${relDir}: 没有 *.model3.json / *.model.json 入口，仍会收录，但条目不带加载入口`);
  }

  let refs = {};
  if (model3Name) {
    try {
      const settings = JSON.parse(await readFile(path.join(absDir, model3Name), 'utf8'));
      if (settings.FileReferences) {
        refs = settings.FileReferences;                    // Cubism 3/4
      } else {
        refs = {                                           // Cubism 2
          Moc: settings.model,
          Textures: settings.textures,
          Physics: settings.physics,
          Pose: settings.pose,
          Motions: Object.fromEntries(
            Object.entries(settings.motions ?? {}).map(([k, v]) => [
              k,
              (Array.isArray(v) ? v : []).map((m) => ({ File: m?.file ?? m?.File })),
            ]),
          ),
          Expressions: (settings.expressions ?? []).map((e) => ({
            File: typeof e === 'string' ? e : e?.file ?? e?.File,
          })),
        };
      }
    } catch (err) {
      warn(`${relDir}/${model3Name}: JSON 解析失败 — ${err.message}`);
    }
  }

  // ---- 2. meta.json（可选元数据，损坏也不拦）----
  const metaPath = path.join(absDir, META_FILE);
  let meta = {};
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch (err) {
      warn(`${relDir}/${META_FILE}: JSON 解析失败 — ${err.message}`);
    }
  }

  // ---- 3. 引用文件是否存在 + 体积（只提示，不拦）----
  const referenced = collectRefs(refs);
  for (const rel of referenced) {
    if (!existsSync(path.join(absDir, rel))) {
      warn(`${relDir}: ${model3Name} 引用的 ${rel} 不存在`);
    }
  }

  const allFiles = await walk(absDir);
  let bytes = 0;
  for (const abs of allFiles) {
    const size = (await stat(abs)).size;
    bytes += size;
    if (size > MAX_FILE_BYTES) {
      warn(`${relDir}/${path.relative(absDir, abs)}: ${mb(size)} 超过 jsDelivr 单文件上限 ${mb(MAX_FILE_BYTES)}，直链可能失效`);
    }
  }

  // ---- 4. 统计 ----
  const motionFiles = new Set();
  for (const group of Object.values(refs.Motions ?? {})) {
    for (const motion of group ?? []) {
      if (motion?.File) motionFiles.add(motion.File);
    }
  }
  const expressionFiles = new Set(
    (refs.Expressions ?? []).map((e) => e?.File).filter(Boolean),
  );

  const mocPath = refs.Moc ? path.join(absDir, refs.Moc) : null;
  const cubismVersion =
    meta.cubismVersion ?? (mocPath ? await readMoc3Version(mocPath) : null) ?? null;

  const entryPath = model3Name ? path.posix.join(relDir, model3Name) : null;
  const order = readOrder(meta.order);
  if (meta.order != null && meta.order !== '' && order === null) {
    warn(`${relDir}/${META_FILE}: order 需要是数字，已忽略`);
  }

  return {
    id: dirName,
    name: meta.name ?? dirName,
    order,
    cubismVersion,
    tags: meta.tags ?? [],
    path: relDir,
    entry: entryPath,
    files: {
      total: allFiles.length,
      bytes,
      textures: (refs.Textures ?? []).length,
      motions: motionFiles.size,
      expressions: expressionFiles.size,
      physics: Boolean(refs.Physics),
      pose: Boolean(refs.Pose),
      displayInfo: Boolean(refs.DisplayInfo),
    },
  };
}

// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(MODELS_DIR)) {
    console.error(`models/ 目录不存在：${MODELS_DIR}`);
    process.exit(1);
  }

  const repoSlug = detectRepoSlug();
  const cdnBase = repoSlug
    ? `https://cdn.jsdelivr.net/gh/${repoSlug}`
    : null;

  if (!cdnBase) {
    warn('未能从 git remote 解析出 GitHub 仓库，index.json 里不会写入 CDN 直链');
  }

  const dirNames = (await readdir(MODELS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`扫描 models/ — ${dirNames.length} 个目录\n`);

  const models = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const dirName of dirNames) {
    console.log(`[${dirName}]`);
    const entry = await buildModelEntry(dirName);
    // 「有文件就收」：目录里一个文件都没有才跳过
    if (entry.files.total === 0) {
      console.log('  - 空目录，跳过\n');
      continue;
    }
    if (cdnBase && entry.entry) {
      entry.url = `${cdnBase}@main/${entry.entry}`;
    }
    models.push(entry);
    totalFiles += entry.files.total;
    totalBytes += entry.files.bytes;
    console.log(
      `  ok — ${entry.files.motions} 动作 / ${entry.files.expressions} 表情 / ` +
      `${entry.files.textures} 贴图 / ${mb(entry.files.bytes)}` +
      (entry.cubismVersion ? ` / Cubism ${entry.cubismVersion}` : ''),
    );
    console.log('');
  }

  models.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });

  if (totalBytes > MAX_REPO_BYTES) {
    warn(`模型总体积 ${mb(totalBytes)} 超过 jsDelivr 仓库上限 ${mb(MAX_REPO_BYTES)}`);
  }

  const index = {
    schemaVersion: 1,
    repository: repoSlug,
    cdn: cdnBase
      ? {
          base: cdnBase,
          pinned: `${cdnBase}@<tag|commit>`,
          cacheNote:
            '@main 分支引用缓存 12 小时，覆盖同名文件后 CDN 不会立刻更新；' +
            'tag 与 commit 为永久缓存。要发布固定版本请打 tag 后用 @tag 引用。',
        }
      : null,
    generatedAt: new Date().toISOString(),
    stats: { models: models.length, files: totalFiles, bytes: totalBytes },
    models,
  };

  if (CHECK_ONLY) {
    const next = { ...index };
    delete next.generatedAt;

    let prev = null;
    if (existsSync(INDEX_PATH)) {
      prev = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
      delete prev.generatedAt;
    }

    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      warn('index.json 与 models/ 当前状态不一致，请运行 node tools/build-index.mjs 重新生成');
    } else {
      console.log('index.json 与 models/ 一致');
    }
  } else {
    await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    console.log(
      `index.json 已更新 — ${models.length} 个模型 / ${totalFiles} 个文件 / ${mb(totalBytes)}`,
    );
  }

  console.log('');
  if (warnings.length) console.log(`${warnings.length} 条提示，未阻止任何模型收录`);
  else console.log('全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
