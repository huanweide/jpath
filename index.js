#!/usr/bin/env node
'use strict';
/*
 * jpath —— 零依赖 JSON 路径查询 + 树打印 + 拍平过滤 CLI
 * 复活自 Jay 落选萃取（乔布斯/零 DSL 导航），砍掉 TUI 依赖，
 * 保留「零 DSL 路径 + 探索阅读」单一切口：点路径查询 + 彩色树 + gron 式拍平。
 * 纯 Node 标准库，无任何 npm 依赖；跨平台（Windows/macOS/Linux）。
 */

const fs = require('fs');
const path = require('path');

const VERSION = (() => {
  try {
    return require('./package.json').version || '1.0.0';
  } catch (_) {
    return '1.0.0';
  }
})();

// 读上限保护（pagext/chaineye 同款教训：超大文件 OOM 防护）
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

// ---------- 颜色 ----------
const useColorDefault = () => Boolean(process.stdout.isTTY);
const ESC = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m',
  magenta: '\x1b[35m', gray: '\x1b[90m', red: '\x1b[31m', blue: '\x1b[34m',
};
function makeColor(on) {
  if (!on) {
    const no = (s) => s;
    return { key: no, idx: no, scalar: no, bracket: no, gray: no, err: no, bold: no, magenta: no, blue: no };
  }
  return {
    key: (s) => ESC.cyan + s + ESC.reset,
    idx: (s) => ESC.yellow + s + ESC.reset,
    scalar: (s) => ESC.green + s + ESC.reset,
    bracket: (s) => ESC.gray + s + ESC.reset,
    gray: (s) => ESC.gray + s + ESC.reset,
    err: (s) => ESC.red + s + ESC.reset,
    bold: (s) => ESC.bold + s + ESC.reset,
    magenta: (s) => ESC.magenta + s + ESC.reset,
    blue: (s) => ESC.blue + s + ESC.reset,
  };
}

// ---------- 路径解析 ----------
// 支持：a.b.c  /  a/b/c  /  a[0].b  /  a["key.with.dot"].c  /  a['k-e y']
function parsePath(p) {
  const segs = [];
  const re = /\[(\d+)\]|\["([^"]*)"\]|\['([^']*)'\]|([^.\[\]/]+)/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    if (m[1] !== undefined) segs.push({ type: 'index', v: Number(m[1]) });
    else if (m[2] !== undefined) segs.push({ type: 'key', v: m[2] });
    else if (m[3] !== undefined) segs.push({ type: 'key', v: m[3] });
    else if (m[4] !== undefined) segs.push({ type: 'key', v: m[4] });
  }
  return segs;
}

function resolve(root, segs) {
  let cur = root;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (s.type === 'index') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[s.v];
    } else {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = cur[s.v];
    }
  }
  return cur;
}

// ---------- 拍平（gron 式） ----------
function flatten(node, base, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, base + '[' + i + ']', out));
  } else if (node !== null && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.length === 0 && base === '') {
      out.push(' = ' + JSON.stringify(node)); // 空对象根
      return out;
    }
    for (const k of keys) {
      const seg = /^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + k + '"]';
      flatten(node[k], base + seg, out);
    }
  } else {
    out.push((base === '' ? '' : base) + ' = ' + JSON.stringify(node));
  }
  return out;
}

// ---------- ungron（从拍平文本重组 JSON） ----------
function parseGrepPattern(pat) {
  if (pat.startsWith('/') && pat.endsWith('/') && pat.length >= 2) {
    return new RegExp(pat.slice(1, -1));
  }
  return { test: (s) => s.toLowerCase().includes(pat.toLowerCase()) };
}

function setAt(target, segs, value) {
  let cur = target;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    if (last) {
      cur[s.v] = value;
      return;
    }
    const next = segs[i + 1];
    const wantArr = next.type === 'index';
    if (cur[s.v] === undefined || cur[s.v] === null) {
      cur[s.v] = wantArr ? [] : {};
    }
    cur = cur[s.v];
  }
}

// 空结果必须显式报错。JSON.stringify(undefined) === undefined（不是字符串），
// 直接写出会得到「undefined」字面量 + 退出码 0，属于最典型的静默错数据。
function stringifyUngron(root, indent) {
  const s = JSON.stringify(root, null, indent);
  if (s === undefined) {
    throw new Error('重组结果为空：过滤后没有任何匹配的 path = value 行');
  }
  return s;
}

function ungron(lines) {
  let root = null;
  let rootType = null;
  let built = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const p = m[1].trim();
    let val;
    try {
      val = JSON.parse(m[2]);
    } catch (_) {
      continue; // 跳过无法解析的值
    }
    const segs = parsePath(p);
    if (segs.length === 0) continue;
    if (rootType === null) {
      rootType = segs[0].type === 'index' ? 'array' : 'object';
      root = rootType === 'array' ? [] : {};
      built = root;
    } else {
      const t = segs[0].type === 'index' ? 'array' : 'object';
      if (t !== rootType) {
        throw new Error('ungron: 根结构类型冲突（同时出现数组与对象根）');
      }
    }
    setAt(built, segs, val);
  }
  if (root === null) return undefined;
  return root;
}

// ---------- 树打印 ----------
function renderTree(node, opts, color) {
  const lines = [];
  function walk(val, prefix, keyLabel, isLast, depth) {
    if (val !== null && typeof val === 'object' && Number.isFinite(opts.maxDepth) && depth >= opts.maxDepth) {
      lines.push(prefix + (isLast ? '└─ ' : '├─ ') + keyLabel + (keyLabel ? ': ' : '') + color.gray('…'));
      return;
    }
    if (Array.isArray(val)) {
      lines.push(prefix + (isLast ? '└─ ' : '├─ ') + keyLabel + (keyLabel ? ': ' : '') + color.gray('array[' + val.length + ']'));
      const cp = prefix + (isLast ? '   ' : '│  ');
      val.forEach((v, i) => walk(v, cp, color.idx('[' + i + ']'), i === val.length - 1, depth + 1));
    } else if (val !== null && typeof val === 'object') {
      const keys = Object.keys(val);
      lines.push(prefix + (isLast ? '└─ ' : '├─ ') + keyLabel + (keyLabel ? ': ' : '') + color.gray('object{' + keys.length + '}'));
      const cp = prefix + (isLast ? '   ' : '│  ');
      keys.forEach((k, i) => walk(val[k], cp, color.key(k), i === keys.length - 1, depth + 1));
    } else {
      lines.push(prefix + (isLast ? '└─ ' : '├─ ') + keyLabel + (keyLabel ? ': ' : '') + colorScalar(val, color));
    }
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, '', color.idx('[' + i + ']'), i === node.length - 1, 0));
  } else if (node !== null && typeof node === 'object') {
    const keys = Object.keys(node);
    keys.forEach((k, i) => walk(node[k], '', color.key(k), i === keys.length - 1, 0));
  } else {
    lines.push(colorScalar(node, color));
  }
  return lines.join('\n');
}

function colorScalar(v, color) {
  if (typeof v === 'string') return color.scalar(JSON.stringify(v));
  if (typeof v === 'number') return color.magenta(String(v));
  if (typeof v === 'boolean') return color.blue(String(v));
  if (v === null) return color.gray('null');
  return color.gray(String(v));
}

// ---------- 统计 ----------
function stats(node) {
  let leaves = 0, maxDepth = 0, objCount = 0, arrCount = 0;
  const types = {};
  function walk(v, d) {
    if (d > maxDepth) maxDepth = d;
    if (Array.isArray(v)) {
      arrCount++;
      v.forEach((x) => walk(x, d + 1));
    } else if (v !== null && typeof v === 'object') {
      objCount++;
      for (const k of Object.keys(v)) walk(v[k], d + 1);
    } else {
      leaves++;
      const t = v === null ? 'null' : typeof v;
      types[t] = (types[t] || 0) + 1;
    }
  }
  walk(node, 0);
  return { leaves, maxDepth, objCount, arrCount, types };
}

// ---------- 输入读取 ----------
function readInput(fileArg, opts) {
  let raw;
  const fromStdin = fileArg == null || fileArg === '-';
  if (fromStdin) {
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch (_) {
      raw = '';
    }
    if (raw.length > MAX_INPUT_BYTES) {
      throw new Error('输入超过 50MB 上限，已拒绝（防 OOM）');
    }
  } else if (fileArg) {
    const fp = path.resolve(process.cwd(), fileArg);
    const st = fs.statSync(fp);
    if (st.size > MAX_INPUT_BYTES) {
      throw new Error('输入超过 50MB 上限，已拒绝（防 OOM）');
    }
    raw = fs.readFileSync(fp, 'utf8');
  } else {
    // 没给文件、stdin 也没内容（CI / 计划任务里常见）→ 这是用法错误，退 2 而不是运行错误。
    // 原实现抛普通 Error 退 1，报的还是「未提供输入文件」这种含糊措辞。
    throw new UsageError('缺少输入：请给出 JSON 文件路径，或用 - 指定从 stdin 读取');
  }
  if (!raw.trim() && fromStdin) {
    throw new UsageError('stdin 没有读到任何内容：请提供 JSON 文件路径，或用管道喂入数据');
  }
  return raw;
}

function parseJsonInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('输入为空');
  // 先尝试整段 JSON
  try {
    return { data: JSON.parse(trimmed), jsonl: false };
  } catch (_) {
    // 退化为 JSONL：逐行解析
    const rows = [];
    const lines = trimmed.split(/\r?\n/);
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t));
      } catch (e) {
        throw new Error('JSON 解析失败（既非合法 JSON，也非合法 JSONL）：' + e.message);
      }
    }
    if (rows.length === 0) throw new Error('输入无有效 JSON 行');
    return { data: rows, jsonl: true };
  }
}

// ---------- 参数解析 ----------
/** 参数用法错误：应退 2（区别于运行期错误退 1） */
class UsageError extends Error {}

/** `--opt=值` 形式的数值校验 */
function intOrThrow(name, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new UsageError(`${name} 需要非负整数，收到：${raw}`);
  }
  return n;
}

/**
 * 模式切换：后写的 --ungron/--flatten 必须能覆盖先写的 --tree/--stats。
 * 原实现直接赋 opts.mode，导致 `--flatten --grep --ungron` 被 grep 逻辑改回
 * flatten，最终对拍平文本走查询路径 → 打印 undefined 且退出码 0（静默错数据）。
 */
function setMode(opts, m) {
  opts.mode = m;
  if (m === 'ungron') opts.ungronRequested = true;
}

function parseArgs(argv) {
  const opts = {
    mode: 'query',
    color: useColorDefault(),
    raw: false,
    json: false,
    indent: 2,
    maxDepth: 0,
    grep: null,
    path: null,
    file: null,
    help: false,
    version: false,
    default: undefined,
    hasDefault: false,
  };
  const positionals = [];
  let i = -1;
  // 取下一个值：缺失时报错。负数不是选项（要留给数值校验去报更准确的错）。
  const need = (name) => {
    const v = argv[i + 1];
    if (v === undefined || (typeof v === 'string' && v.startsWith('-') && !/^-?\d/.test(v) && v !== '-')) {
      throw new UsageError(`选项 ${name} 缺少取值`);
    }
    i++;
    return v;
  };
  // 数值参数：必须是有限非负整数，否则报错（--max-depth abc 曾让整棵树静默消失）
  const needInt = (name) => {
    const raw = need(name);
    return intOrThrow(name, raw);
  };
  for (i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '--version' || a === '-v') { opts.version = true; continue; }
    if (a === '--no-color') { opts.color = false; continue; }
    if (a === '-c' || a === '--color') { opts.color = true; continue; }
    if (a === '-r' || a === '--raw') { opts.raw = true; continue; }
    if (a === '-j' || a === '--json') { opts.json = true; continue; }
    if (a === '-i') { opts.indent = needInt('-i'); continue; }
    if (a === '--tree') { setMode(opts, 'tree'); continue; }
    if (a === '--flatten') { setMode(opts, 'flatten'); continue; }
    if (a === '--stats') { setMode(opts, 'stats'); continue; }
    if (a === '--ungron') { setMode(opts, 'ungron'); continue; }
    if (a === '--max-depth') { opts.maxDepth = needInt('--max-depth'); continue; }
    if (a === '--indent') { opts.indent = needInt('--indent'); continue; }
    if (a === '--grep') { opts.grep = need('--grep'); continue; }
    if (a === '--default') { opts.default = need('--default'); opts.hasDefault = true; continue; }
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const k = a.slice(0, eq), v = a.slice(eq + 1);
      if (k === '--max-depth') { opts.maxDepth = intOrThrow(k, v); continue; }
      if (k === '--indent') { opts.indent = intOrThrow(k, v); continue; }
      if (k === '--grep') { opts.grep = v; continue; }
      if (k === '--default') { opts.default = v; opts.hasDefault = true; continue; }
    }
    if (a.startsWith('-') && a !== '-') {
      throw new UsageError('未知选项：' + a + '（用 --help 查看用法）');
    }
    positionals.push(a);
  }
  // 位置参数：第一个是文件（或 -），第二个是路径。
  // 支持省略文件名的写法 `cat a.json | jpath user.name`：仅在查询模式下、
  // 只有一个位置参数、它不是已存在的文件、且 stdin 有数据时，才当路径。
  // （--tree/--flatten/--stats/--ungron 这些模式单参数必定是文件，否则会误判。）
  const pathlessMode = opts.mode === 'query' && !opts.ungronRequested;
  if (pathlessMode && positionals.length === 1 && !fs.existsSync(positionals[0]) && !process.stdin.isTTY) {
    opts.file = '-';
    opts.path = positionals[0];
  } else {
    if (positionals.length >= 1) opts.file = positionals[0];
    if (positionals.length >= 2) opts.path = positionals[1];
  }
  // grep 在查询模式下自动走拍平；但用户显式要 --ungron 时必须尊重（否则会打印 undefined）
  if (opts.grep && opts.mode === 'query' && !opts.ungronRequested) opts.mode = 'flatten';
  if (opts.maxDepth === 0) opts.maxDepth = Infinity;
  return opts;
}

// ---------- 输出 ----------
function formatQuery(value, opts, color) {
  if (value === undefined) {
    if (opts.hasDefault) return opts.default;
    throw new Error('路径不存在（用 --default 提供回退值）');
  }
  if (opts.json) return JSON.stringify(value, null, opts.indent);
  if (opts.raw && typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value, null, opts.indent);
  }
  if (typeof value === 'string') return opts.raw ? value : JSON.stringify(value);
  return String(value);
}

function helpText() {
  return `jpath v${VERSION} —— 零依赖 JSON 路径查询 + 树打印 + 拍平过滤 CLI

用法：
  jpath <file|-|stdin> [path] [选项]     查询 path 对应的值（点路径，零 DSL）
  jpath <file> --tree [--max-depth N]     彩色树形打印结构（探索阅读）
  jpath <file> --flatten [--grep PAT]     gron 式拍平为「path = value」行
  jpath --ungron <file|-|stdin>           从拍平文本重组 JSON（grep 后回填）
  jpath <file> --stats                    统计叶子数/最大深度/类型分布

路径语法（零 DSL，类 JS 属性访问）：
  user.name          |  user/name  |  users[0].name
  a["key.with.dot"]  |  a['k-e y']  |  cfg.database.ports[1]

选项：
  -c, --color          强制彩色（默认 tty 自动）
  --no-color           关闭彩色
  -r, --raw            原始值输出（字符串去引号）
  -j, --json           强制 JSON 输出
  -i, --indent N       JSON 缩进（默认 2）
  --max-depth N        树打印深度限制
  --grep PATTERN       拍平后按路径/值过滤（子串，或 /regex/）
  --default VAL        路径不存在时的回退值
  -h, --help           显示本帮助
  --version            显示版本

示例：
  curl -s api/users/1 | jpath - user.name
  jpath pkg.json --tree
  jpath data.json --flatten --grep email > emails.txt
  jpath emails.txt --ungron > filtered.json
  jpath logs.jsonl --flatten --grep "ERROR" | jpath --ungron > errors.json

项目主页：https://github.com/huanweide/jpath`;
}

// ---------- 主流程 ----------
function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('参数错误：' + e.message + '\n');
    process.exitCode = 2;
    return;
  }

  const color = makeColor(opts.color);

  if (opts.version) { process.stdout.write('jpath v' + VERSION + '\n'); return; }
  if (opts.help) { process.stdout.write(helpText() + '\n'); return; }

  try {
    if (opts.mode === 'ungron') {
      const raw = readInput(opts.file, opts);
      let root;
      if (opts.grep) {
        // 同进程「拍平+过滤+重组」：输入是原始 JSON 或拍平文本都要能处理。
        // 原实现直接把原始 JSON 当拍平文本重组 → 打印 undefined 且退出码 0。
        let lines;
        const trimmed = raw.trim();
        const looksLikeGron = /^\s*[\w$.[\]"]*\s*=/m.test(trimmed);
        if (looksLikeGron) {
          lines = trimmed.split(/\r?\n/).filter(Boolean);
        } else {
          const parsed = parseJsonInput(raw);
          lines = flatten(parsed.data, '', []);
        }
        const pat = parseGrepPattern(opts.grep);
        lines = lines.filter((l) => pat.test(l));
        root = ungron(lines);
      } else {
        root = ungron(raw.split(/\r?\n/).filter(Boolean));
      }
      process.stdout.write(stringifyUngron(root, opts.indent) + '\n');
      return;
    }

    const raw = readInput(opts.file, opts);
    const { data } = parseJsonInput(raw);

    if (opts.mode === 'tree') {
      process.stdout.write(renderTree(data, opts, color) + '\n');
      return;
    }
    if (opts.mode === 'stats') {
      const s = stats(data);
      const typeStr = Object.keys(s.types).map((k) => `${k}:${s.types[k]}`).join('  ');
      const out = [
        color.bold('统计') + '：',
        '  叶子值总数 : ' + s.leaves,
        '  最大深度   : ' + s.maxDepth,
        '  对象数     : ' + s.objCount,
        '  数组数     : ' + s.arrCount,
        '  值类型分布 : ' + (typeStr || '（无）'),
      ].join('\n');
      process.stdout.write(out + '\n');
      return;
    }
    if (opts.mode === 'flatten') {
      let lines = flatten(data, '', []);
      if (opts.grep) {
        const pat = parseGrepPattern(opts.grep);
        lines = lines.filter((l) => pat.test(l));
      }
      process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return;
    }

    // 默认：路径查询
    if (!opts.path) {
      process.stderr.write('查询模式需要提供 path 参数（或改用 --tree/--flatten/--stats）。\n');
      process.exitCode = 2;
      return;
    }
    const segs = parsePath(opts.path);
    if (segs.length === 0) {
      process.stderr.write('路径为空或非法：' + opts.path + '\n');
      process.exitCode = 2;
      return;
    }
    if (Array.isArray(data)) {
      // JSONL / 数组：对每行/每项取值
      const results = data.map((row) => resolve(row, segs));
      if (results.length === 1) {
        process.stdout.write(formatQuery(results[0], opts, color) + '\n');
      } else {
        results.forEach((r) => process.stdout.write(formatQuery(r, opts, color) + '\n'));
      }
      return;
    }
    const value = resolve(data, segs);
    process.stdout.write(formatQuery(value, opts, color) + '\n');
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write('参数错误：' + e.message + '\n');
      process.exitCode = 2;
      return;
    }
    process.stderr.write(color.err('错误：' + e.message) + '\n');
    process.exitCode = 1;
  }
}

// 既可作为 CLI 直接运行，也可被单测 require 拿到内部函数
if (require.main === module) {
  main();
}

module.exports = {
  parsePath, resolve, flatten, ungron, renderTree, stats, makeColor,
  parseArgs, parseJsonInput, formatQuery, setAt, VERSION, UsageError,
};
