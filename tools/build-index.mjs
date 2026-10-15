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
 * 校验项（均为链接可用性的技术要求，不做内容/许可门槛）：
 *   1. 每个模型目录必须有 *.model3.json 入口
 *   2. model3.json 里引用的文件必须真实存在
 *   3. 单文件不得超过 jsDelivr 的 20MB 上限
 *   4. 全仓库模型总体积不得超过 jsDelivr 的 150MB 上限
 *   5. --check 模式下，index.json 必须与 models/ 当前状态一致
 *
 * meta.json 为可选元数据；缺失时自动用目录名等默认值生成条目，不做任何许可/来源限制。
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
const errors = [];

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
const warn = (msg) => { warnings.push(msg); console.log(`  ! ${msg}`); };
const fail = (msg) => { errors.push(msg); console.log(`  x ${msg}`); };

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
  const errorsBefore = errors.length;
  const absDir = path.join(MODELS_DIR, dirName);
  const relDir = path.posix.join('models', dirName);
  const entries = await readdir(absDir, { withFileTypes: true });

  // ---- 1. 入口文件 ----
  const model3Name = entries
    .filter((e) => e.isFile() && e.name.endsWith('.model3.json'))
    .map((e) => e.name)
    .sort()[0];

  if (!model3Name) {
    fail(`${relDir}: 找不到 *.model3.json 入口文件`);
    return null;
  }

  let model3;
  try {
    model3 = JSON.parse(await readFile(path.join(absDir, model3Name), 'utf8'));
  } catch (err) {
    fail(`${relDir}/${model3Name}: JSON 解析失败 — ${err.message}`);
    return null;
  }
  const refs = model3.FileReferences ?? {};

  // ---- 2. meta.json（可选元数据，不做许可 / 来源门槛）----
  const metaPath = path.join(absDir, META_FILE);
  let meta = {};
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch (err) {
      fail(`${relDir}/${META_FILE}: JSON 解析失败 — ${err.message}`);
      return null;
    }
  }

  // ---- 3. 引用的文件是否存在 + 体积限额 ----
  const referenced = collectRefs(refs);
  for (const rel of referenced) {
    if (!existsSync(path.join(absDir, rel))) {
      fail(`${relDir}: ${model3Name} 引用的 ${rel} 不存在`);
    }
  }

  const allFiles = await walk(absDir);
  let bytes = 0;
  for (const abs of allFiles) {
    const size = (await stat(abs)).size;
    bytes += size;
    if (size > MAX_FILE_BYTES) {
      fail(`${relDir}/${path.relative(absDir, abs)}: ${mb(size)} 超过 jsDelivr 单文件上限 ${mb(MAX_FILE_BYTES)}，直链会失效`);
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

  // 本模型只要出过任何一个错误，就不写入索引 —— index.json 里给出的链接必须全部可用
  if (errors.length > errorsBefore) return null;

  const entryPath = path.posix.join(relDir, model3Name);

  return {
    id: dirName,
    name: meta.name ?? dirName,
    cubismVersion,
    author: meta.author ?? null,
    license: meta.license ?? null,
    licenseUrl: meta.licenseUrl ?? null,
    source: meta.source ?? null,
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
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  console.log(`扫描 models/ — ${dirNames.length} 个目录\n`);

  const models = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const dirName of dirNames) {
    console.log(`[${dirName}]`);
    const entry = await buildModelEntry(dirName);
    if (entry) {
      if (cdnBase) {
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
    }
    console.log('');
  }

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
      fail('index.json 与 models/ 当前状态不一致，请运行 node tools/build-index.mjs 重新生成');
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
  if (errors.length) {
    console.error(`${errors.length} 个错误，${warnings.length} 个警告`);
    process.exit(1);
  }
  if (warnings.length) console.log(`${warnings.length} 个警告，无错误`);
  else console.log('全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
