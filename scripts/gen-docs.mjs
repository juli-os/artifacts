// docs-as-code: copy README.md verbatim to docs/index.md.
// Pure node, zero dependencies. Idempotent: identical content is not rewritten.
//
// Also generates docs/gen/architecture.md: a directory-level module dependency
// graph (mermaid flowchart) aggregated from measured relative imports across
// src/**/*.ts. Deterministic by construction — sorted traversal, sorted output,
// no timestamps. Idempotent: identical content is not rewritten.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---- docs/index.md: README verbatim copy --------------------------------------
{
  const src = join(root, 'README.md');
  const dest = join(root, 'docs', 'index.md');

  const readme = await readFile(src, 'utf8');
  let current = null;
  try {
    current = await readFile(dest, 'utf8');
  } catch {
    // first run — dest does not exist yet
  }

  if (current !== readme) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, readme);
  }
}

// ---- docs/gen/architecture.md: measured module dependency graph ---------------
const srcDir = join(root, 'src');
const FACADE = ''; // src root files (index.ts facade) form their own node
const IMPORT_RE = /from\s+'(\.[^']+)'/g; // relative imports (measured edges)
const EXTERNAL_RE = /from\s+'(@juli-os\/[^']+)'/g; // sibling-layer imports (dashed)

// Plain code-unit order (not localeCompare) so CI fences reproduce byte-exact output.
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const scanTs = (dir) => {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => byStr(a.name, b.name));
  for (const ent of entries) {
    if (ent.isDirectory()) out.push(...scanTs(join(dir, ent.name)));
    else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(join(dir, ent.name));
  }
  return out;
};

const relFiles = scanTs(srcDir)
  .map((f) => relative(srcDir, f).split(sep).join('/'))
  .sort(byStr);
const fileSet = new Set(relFiles);
const dirOf = (r) => {
  const i = r.lastIndexOf('/');
  return i === -1 ? '.' : r.slice(0, i);
};

// Node = first-level dir under src/ (platform/, contracts/, ...). If first level
// holds a single dir (layered layout), descend until at least two dir nodes exist.
const prefixAt = (d, n) => d.split('/').slice(0, n).join('/');
const fileDirs = [...new Set(relFiles.map(dirOf).filter((d) => d !== '.'))];
let depth = 1;
while (new Set(fileDirs.map((d) => prefixAt(d, depth))).size < 2 && depth < 4) depth += 1;

const nodeKeyOf = (r) => {
  const d = dirOf(r);
  return d === '.' ? FACADE : prefixAt(d, depth);
};

// Resolve a relative import specifier against its importer, appending `.ts` or
// `/index.ts`; unresolvable targets (outside src/) are skipped.
const resolveImport = (fromRel, spec) => {
  const base = resolve(srcDir, dirOf(fromRel), spec);
  const candidates = spec.endsWith('.ts') ? [base] : [`${base}.ts`, join(base, 'index.ts')];
  for (const c of candidates) {
    const r = relative(srcDir, c).split(sep).join('/');
    if (fileSet.has(r)) return r;
  }
  return null;
};

// Aggregate directory-level edges: key "from\tto" -> measured import count.
// Same-directory edges are dropped (internal detail, invisible at this level).
const edges = new Map();
const externalEdges = new Map();
for (const r of relFiles) {
  const text = readFileSync(join(srcDir, r), 'utf8');
  const fromKey = nodeKeyOf(r);
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(r, m[1]);
    if (target === null) continue;
    const toKey = nodeKeyOf(target);
    if (fromKey === toKey) continue;
    const k = `${fromKey}\t${toKey}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
  for (const m of text.matchAll(EXTERNAL_RE)) {
    const k = `${fromKey}\t${m[1]}`;
    externalEdges.set(k, (externalEdges.get(k) ?? 0) + 1);
  }
}

// Nodes: one per dir key + the facade; labels quoted in mermaid output.
const nodeKeys = [...new Set(relFiles.map(nodeKeyOf))].sort((a, b) => {
  if (a === FACADE) return -1;
  if (b === FACADE) return 1;
  return byStr(a, b);
});
const labelOf = (k) => (k === FACADE ? 'facade（index.ts）' : k);
const idOf = new Map(nodeKeys.map((k, i) => [k, `n${i}`]));

const edgeList = [...edges.entries()]
  .map(([k, n]) => {
    const [from, to] = k.split('\t');
    return { from, to, n };
  })
  .sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
const externalList = [...externalEdges.entries()]
  .map(([k, n]) => {
    const [from, pkg] = k.split('\t');
    return { from, pkg, n };
  })
  .sort((a, b) => byStr(a.from, b.from) || byStr(a.pkg, b.pkg));
const pkgs = [...new Set(externalList.map((e) => e.pkg))].sort(byStr);
const extIdOf = new Map(pkgs.map((p, i) => [p, `e${i}`]));

// First contiguous column-0 `//` run within the file head = its responsibility note.
const headerRun = (rel) => {
  const lines = readFileSync(join(srcDir, rel), 'utf8').split(/\r?\n/);
  const run = [];
  for (const line of lines.slice(0, 15)) {
    if (line.startsWith('//')) run.push(line.replace(/^\/\/\s?/, ''));
    else if (run.length > 0) break;
    // code before the header comment (e.g. a leading import) — keep looking
  }
  return run.length > 0 ? run : null;
};

// Collapse the spaces that line-joining injects between CJK characters
// ("行不可变—— 仅" -> "行不可变——仅"); ASCII-adjacent spacing is kept.
const CJK = '\\u3000-\\u30ff\\u4e00-\\u9fff\\uff00-\\uffef\\u2014\\u2026';
const cjkJoin = new RegExp(`(?<=[${CJK}]) (?=[${CJK}])`, 'g');

const firstSentence = (text) => {
  const t = text.replace(/\s+/g, ' ').trim().replace(cjkJoin, '');
  let end = -1;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    const next = t[i + 1];
    if (ch === '。' || ch === '；' || ch === '？' || ch === '！') { end = i + 1; break; }
    if (ch === '.' && i >= 12 && (next === undefined || next === ' ')) { end = i + 1; break; }
  }
  const s = end === -1 ? t : t.slice(0, end);
  return s.length > 150 ? `${s.slice(0, 150)}…` : s;
};

const cell = (s) => s.replace(/\|/g, '\\|');
const rows = [];
for (const k of nodeKeys) {
  const rep = relFiles.find((f) => nodeKeyOf(f) === k); // sorted-first file = representative
  const run = rep === undefined ? null : headerRun(rep);
  const duty = run === null ? `见 ${rep}` : firstSentence(run.join(' '));
  rows.push(`| \`${cell(labelOf(k))}\` | ${cell(duty)} |`);
}

const diagram = ['flowchart TD'];
for (const k of nodeKeys) diagram.push(`    ${idOf.get(k)}["${labelOf(k)}"]`);
for (const e of edgeList) diagram.push(`    ${idOf.get(e.from)} -->|${e.n}| ${idOf.get(e.to)}`);
if (externalList.length > 0) {
  diagram.push('    classDef external stroke-dasharray: 5 5');
  for (const p of pkgs) diagram.push(`    ${extIdOf.get(p)}["${p}"]:::external`);
  for (const e of externalList) diagram.push(`    ${idOf.get(e.from)} -.->|${e.n}| ${extIdOf.get(e.pkg)}`);
}

const page = [
  '<!-- generated by scripts/gen-docs.mjs — DO NOT EDIT -->',
  '> 本页由生成器产出（npm run docs:gen）：模块依赖由 src/ 相对 import 实测聚合。',
  '',
  '# 架构（模块依赖实测）',
  '',
  `共 ${nodeKeys.length} 个节点、${edgeList.length} 条目录级有向边（边上数字 = 实测相对 import 条数；同目录内部依赖不单列${externalList.length > 0 ? '；@juli-os/* 外部依赖以虚线呈现' : ''}）。`,
  '',
  '```mermaid',
  ...diagram,
  '```',
  '',
  '## 模块职责',
  '',
  '| 模块 | 职责（摘自代表文件头注释） |',
  '| --- | --- |',
  ...rows,
  '',
].join('\n');

{
  const dest = join(root, 'docs', 'gen', 'architecture.md');
  let current = null;
  try {
    current = await readFile(dest, 'utf8');
  } catch {
    // first run — dest does not exist yet
  }
  if (current !== page) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, page);
  }
}
