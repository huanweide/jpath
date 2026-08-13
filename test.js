'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const jp = require('./index.js');
const CLI = path.join(__dirname, 'index.js');

const noopColor = (() => {
  const c = (s) => s;
  return { key: c, idx: c, scalar: c, bracket: c, gray: c, err: c, bold: c, magenta: c, blue: c };
})();

const SAMPLE = {
  user: { name: 'Tri', age: 20, 'key.with.dot': 'ok' },
  hobbies: ['code', 'music'],
  active: true,
  score: null,
};

// ---------- 单元：路径解析 ----------
test('parsePath 支持点路径/斜杠/数组索引/带引号键', () => {
  assert.deepStrictEqual(jp.parsePath('a.b.c').map((s) => [s.type, s.v]),
    [['key', 'a'], ['key', 'b'], ['key', 'c']]);
  assert.deepStrictEqual(jp.parsePath('a/b').map((s) => [s.type, s.v]),
    [['key', 'a'], ['key', 'b']]);
  assert.deepStrictEqual(jp.parsePath('a[0].b').map((s) => [s.type, s.v]),
    [['key', 'a'], ['index', 0], ['key', 'b']]);
  assert.deepStrictEqual(jp.parsePath('a["key.with.dot"]').map((s) => [s.type, s.v]),
    [['key', 'a'], ['key', 'key.with.dot']]);
  assert.deepStrictEqual(jp.parsePath("a['k-e y']").map((s) => [s.type, s.v]),
    [['key', 'a'], ['key', 'k-e y']]);
});

test('resolve 命中/缺失/数组越界', () => {
  assert.strictEqual(jp.resolve(SAMPLE, jp.parsePath('user.name')), 'Tri');
  assert.strictEqual(jp.resolve(SAMPLE, jp.parsePath('hobbies[1]')), 'music');
  assert.strictEqual(jp.resolve(SAMPLE, jp.parsePath('user.missing')), undefined);
  assert.strictEqual(jp.resolve(SAMPLE, jp.parsePath('hobbies[9]')), undefined);
  assert.strictEqual(jp.resolve(SAMPLE, jp.parsePath('user["key.with.dot"]')), 'ok');
});

// ---------- 单元：拍平 / ungron 往返 ----------
test('flatten 生成 gron 式路径', () => {
  const out = jp.flatten(SAMPLE, '', []);
  assert.ok(out.includes('.user.name = "Tri"'));
  assert.ok(out.includes('.hobbies[0] = "code"'));
  assert.ok(out.includes('.active = true'));
  assert.ok(out.includes('.score = null'));
});

test('ungron 能从拍平文本重组出等价 JSON', () => {
  const flat = jp.flatten(SAMPLE, '', []);
  const back = jp.ungron(flat);
  assert.deepStrictEqual(back, SAMPLE);
});

test('ungron 支持根数组', () => {
  const flat = ['.[0].name = "a"', '.[1].name = "b"'];
  assert.deepStrictEqual(jp.ungron(flat), [{ name: 'a' }, { name: 'b' }]);
});

test('ungron 根类型冲突抛错', () => {
  assert.throws(() => jp.ungron(['.a = 1', '.[0] = 2']), /根结构类型冲突/);
});

// ---------- 单元：树打印 / 统计 ----------
test('renderTree 包含关键与标量', () => {
  const t = jp.renderTree(SAMPLE, { maxDepth: Infinity }, noopColor);
  assert.ok(t.includes('name'));
  assert.ok(t.includes('"Tri"'));
  assert.ok(t.includes('code'));
});

test('renderTree maxDepth 截断', () => {
  const t = jp.renderTree(SAMPLE, { maxDepth: 0 }, noopColor);
  assert.ok(t.includes('…'));
});

test('stats 计数正确', () => {
  const s = jp.stats(SAMPLE);
  // user{name,age,key.with.dot} + hobbies[code,music] + active + score = 7 个标量叶子
  assert.strictEqual(s.leaves, 7);
  assert.ok(s.maxDepth >= 2);
  assert.strictEqual(s.arrCount, 1);
  assert.strictEqual(s.objCount, 2); // 顶层对象 + user 对象
});

// ---------- 单元：参数解析 / 查询格式化 ----------
test('parseArgs 解析模式与彩色', () => {
  const o1 = jp.parseArgs(['data.json', 'user.name', '--tree']);
  assert.strictEqual(o1.mode, 'tree');
  assert.strictEqual(o1.path, 'user.name');
  assert.strictEqual(o1.file, 'data.json');
  const o2 = jp.parseArgs(['-', '--grep', 'email', '--no-color']);
  assert.strictEqual(o2.mode, 'flatten');
  assert.strictEqual(o2.grep, 'email');
  assert.strictEqual(o2.color, false);
  const o3 = jp.parseArgs(['x', 'p', '--max-depth', '3']);
  assert.strictEqual(o3.maxDepth, 3);
});

test('parseArgs 未知选项抛错', () => {
  assert.throws(() => jp.parseArgs(['--bogus']), /未知选项/);
});

test('formatQuery raw/json/默认/缺失', () => {
  const opts = { raw: false, json: false, indent: 2, hasDefault: false };
  assert.strictEqual(jp.formatQuery('hi', opts, noopColor), '"hi"');
  assert.strictEqual(jp.formatQuery('hi', { ...opts, raw: true }, noopColor), 'hi');
  assert.strictEqual(jp.formatQuery({ a: 1 }, opts, noopColor), '{\n  "a": 1\n}');
  assert.strictEqual(jp.formatQuery(undefined, { ...opts, hasDefault: true, default: 'x' }, noopColor), 'x');
  assert.throws(() => jp.formatQuery(undefined, opts, noopColor), /路径不存在/);
});

test('parseJsonInput 支持整段 JSON 与 JSONL', () => {
  const a = jp.parseJsonInput('{"a":1}');
  assert.deepStrictEqual(a.data, { a: 1 });
  assert.strictEqual(a.jsonl, false);
  const b = jp.parseJsonInput('{"a":1}\n{"a":2}\n');
  assert.deepStrictEqual(b.data, [{ a: 1 }, { a: 2 }]);
  assert.strictEqual(b.jsonl, true);
});

// ---------- 集成：真实跑 CLI ----------
function run(args, input) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: input || '',
    encoding: 'utf8',
  });
  return res;
}

test('CLI: 查询路径输出值', () => {
  const r = run(['-', 'user.name'], JSON.stringify(SAMPLE));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '"Tri"');
});

test('CLI: --raw 去引号', () => {
  const r = run(['-', 'user.name', '--raw'], JSON.stringify(SAMPLE));
  assert.strictEqual(r.stdout.trim(), 'Tri');
});

test('CLI: --tree 输出结构', () => {
  const r = run(['-', '--tree', '--no-color'], JSON.stringify(SAMPLE));
  assert.ok(r.stdout.includes('name'));
  assert.ok(r.stdout.includes('hobbies'));
});

test('CLI: --flatten --grep 过滤', () => {
  const r = run(['-', '--flatten', '--grep', 'code', '--no-color'], JSON.stringify(SAMPLE));
  assert.ok(r.stdout.includes('code'));
  assert.ok(!r.stdout.includes('music'));
});

test('CLI: --ungron 重组与往返一致', () => {
  const flat = jp.flatten(SAMPLE, '', []).join('\n');
  const r = run(['--ungron', '-'], flat + '\n');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), SAMPLE);
});

test('CLI: --stats 报告', () => {
  const r = run(['-', '--stats', '--no-color'], JSON.stringify(SAMPLE));
  assert.ok(r.stdout.includes('叶子值总数'));
  assert.ok(r.stdout.includes('最大深度'));
});

test('CLI: 路径缺失 exit 1', () => {
  const r = run(['-', 'user.nope'], JSON.stringify(SAMPLE));
  assert.strictEqual(r.status, 1);
});

test('CLI: --default 回退', () => {
  const r = run(['-', 'user.nope', '--default', 'fallback'], JSON.stringify(SAMPLE));
  assert.strictEqual(r.stdout.trim(), 'fallback');
});

test('CLI: 未知选项 exit 2', () => {
  const r = run(['--bogus']);
  assert.strictEqual(r.status, 2);
});

test('CLI: --help / --version', () => {
  assert.ok(run(['--help']).stdout.includes('jpath v'));
  assert.strictEqual(run(['--version']).stdout.trim(), 'jpath v' + jp.VERSION);
});

test('CLI: JSONL 逐行查询', () => {
  const r = run(['-', 'a'], '{"a":1}\n{"a":2}\n');
  assert.strictEqual(r.stdout.trim(), '1\n2');
});

test('CLI: 大文件拒绝（>50MB）+ 防 OOM', () => {
  const big = '{ "x": "' + 'a'.repeat(60 * 1024 * 1024) + '" }';
  const r = run(['-', 'x'], big);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('50MB'));
});

test('CLI: 读取真实文件', () => {
  const f = path.join(__dirname, '._tmp_cli_test.json');
  fs.writeFileSync(f, JSON.stringify(SAMPLE));
  try {
    const r = run([f, 'user.age', '--raw']);
    assert.strictEqual(r.stdout.trim(), '20');
  } finally {
    fs.unlinkSync(f);
  }
});
