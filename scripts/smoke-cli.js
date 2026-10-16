#!/usr/bin/env node
// spawn 级冒烟：真实跑进程，验证退出码契约与 stdout 完整性。
// node --test 只测导出函数、不碰 process.exitCode；这一层才拦得住参数契约回归。
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jpath-smoke-'));
const JSON_FILE = path.join(tmp, 'd.json');
fs.writeFileSync(JSON_FILE, JSON.stringify({
  user: { name: 'Ada', tags: ['x', 'y'] },
  version: '1.0.0',
  n: null,
  arr: [1, 2, 3],
}));
const DEEP = path.join(tmp, 'deep.json');
fs.writeFileSync(DEEP, JSON.stringify({ a: { b: { c: { d: 1 } } } }));
const BAD = path.join(tmp, 'bad.json');
fs.writeFileSync(BAD, '{bad');
const BIG_EMPTY = path.join(tmp, 'x');

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { console.error('  FAIL ' + name + (detail ? ' -> ' + detail : '')); fails++; }
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input: input === undefined ? '' : input,
    encoding: 'utf8',
  });
}

console.log('# 用法错误必须退 2（原实现对以下全部静默 exit 0）');
for (const [desc, args] of [
  ['--max-depth abc', [JSON_FILE, '--tree', '--max-depth', 'abc']],
  ['--max-depth 缺值', [JSON_FILE, '--tree', '--max-depth']],
  ['--max-depth 负数', [JSON_FILE, '--tree', '--max-depth', '-3']],
  ['--max-depth 小数', [JSON_FILE, '--tree', '--max-depth', '1.5']],
  ['--max-depth=abc', [JSON_FILE, '--tree', '--max-depth=abc']],
  ['--indent abc', [JSON_FILE, 'user', '--json', '--indent', 'abc']],
  ['--indent 缺值', [JSON_FILE, 'user', '--json', '--indent']],
  ['-i abc', [JSON_FILE, 'user', '--json', '-i', 'abc']],
  ['未知短选项 -x', [JSON_FILE, 'user', '-x']],
  ['未知长选项 --bogus', [JSON_FILE, '--bogus']],
  ['--grep 缺值', [JSON_FILE, '--flatten', '--grep']],
  ['--default 缺值', [JSON_FILE, 'a.b', '--default']],
  ['查询模式缺 path', [JSON_FILE]],
]) {
  const r = run(args);
  check(desc + ' -> rc=2', r.status === 2, 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
}

console.log('# 运行错误必须退 1');
for (const [desc, args] of [
  ['JSON 解析失败', [BAD, 'user']],
  ['路径不存在且无 --default', [JSON_FILE, 'a.b.c.d']],
  ['文件不存在', [path.join(tmp, 'nope.json'), 'user']],
  ['坏正则', [JSON_FILE, '--flatten', '--grep', '/[/']],
]) {
  const r = run(args);
  check(desc + ' -> rc=1', r.status === 1, 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
}

console.log('# 正常路径 rc=0 且输出正确');
{
  const r = run([JSON_FILE, 'user.name', '--raw']);
  check('raw 取值', r.status === 0 && r.stdout.trim() === 'Ada', JSON.stringify(r.stdout));
}
{
  const r = run([JSON_FILE, 'version', '--raw']);
  check('顶层标量', r.status === 0 && r.stdout.trim() === '1.0.0');
}
{
  const r = run([JSON_FILE, 'a.b.c', '--default', 'FB']);
  check('--default 兜底', r.status === 0 && r.stdout.trim() === 'FB');
}
{
  const r = run([JSON_FILE, 'user', '--json']);
  let ok = false, v = null;
  try { v = JSON.parse(r.stdout); ok = true; } catch (e) { /* 截断 */ }
  check('--json 输出完整合法 JSON', ok && v.name === 'Ada', 'stdout=' + JSON.stringify(r.stdout.slice(0, 120)));
}
{
  const r = run([JSON_FILE, 'user', '--json', '--indent', '4']);
  check('--indent 4 生效', r.status === 0 && /\n {4}"name"/.test(r.stdout), JSON.stringify(r.stdout.slice(0, 80)));
}
{
  const r = run([DEEP, '--tree', '--max-depth', '1']);
  check('--max-depth 1 截断为 …', r.status === 0 && /…/.test(r.stdout) && !/d:/.test(r.stdout), JSON.stringify(r.stdout));
}
{
  const r = run([DEEP, '--tree', '--max-depth', '3']);
  check('--max-depth 3 放到底', r.status === 0 && /d: 1/.test(r.stdout));
}
{
  const r = run([DEEP, '--tree']);
  check('无 --max-depth 时不截断', r.status === 0 && /d: 1/.test(r.stdout));
}
{
  const flat = run([JSON_FILE, '--flatten']);
  check('--flatten 输出 path = value', flat.status === 0 && /user\.name = "Ada"/.test(flat.stdout), JSON.stringify(flat.stdout));
}
{
  const g = run([JSON_FILE, '--flatten', '--grep', 'Ada']);
  check('--grep 过滤', g.status === 0 && /Ada/.test(g.stdout) && !/version/.test(g.stdout));
}
{
  const un = run([JSON_FILE, '--flatten', '--grep', 'Ada', '--ungron']);
  let ok = false, v = null;
  try { v = JSON.parse(un.stdout); ok = true; } catch (e) { }
  check('--flatten | --ungron 能重组', ok && v.user && v.user.name === 'Ada', JSON.stringify(un.stdout));
}
{
  // 只给 --grep --ungron（不显式 --flatten）：grep 的「自动切 flatten」不得覆盖 ungron
  const un = run([JSON_FILE, '--grep', 'Ada', '--ungron']);
  let ok = false, v = null;
  try { v = JSON.parse(un.stdout); ok = true; } catch (e) { }
  check('--grep --ungron（无 --flatten）仍重组而非打印 undefined',
    ok && v.user && v.user.name === 'Ada' && un.stdout.trim() !== 'undefined', JSON.stringify(un.stdout));
}
{
  // 回归防线：ungron 遇到无法重组的输入必须报错，不能静默输出 undefined
  const un = run([JSON_FILE, '--grep', 'ZZZ_NO_MATCH', '--ungron']);
  check('过滤无命中时不输出 undefined', !/undefined/.test(un.stdout), JSON.stringify(un.stdout));
}
{
  const r = run([JSON_FILE, '--stats']);
  check('--stats 含关键字段', r.status === 0 && /叶子值总数/.test(r.stdout) && /最大深度/.test(r.stdout));
}
{
  const r = run(['-', 'user.name', '--raw'], '{"user":{"name":"Ada"}}');
  check('stdin 连字符输入', r.status === 0 && r.stdout.trim() === 'Ada', JSON.stringify(r.stdout) + r.stderr);
}
{
  const r = run(['user.name', '--raw'], '{"user":{"name":"Ada"}}');
  check('省略文件名时读 stdin', r.status === 0 && r.stdout.trim() === 'Ada', JSON.stringify(r.stdout) + r.stderr);
}
{
  // 无文件且 stdin 无内容：应退 2（用法错误）而不是含糊的运行错误
  const r = run(['--tree']);
  check('缺输入 -> rc=2 且提示明确', r.status === 2 && /(缺少输入|stdin)/.test(r.stderr), 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
}
{
  // --tree 模式单参数仍按文件/stdin 处理，不被误当路径
  const r = run(['--tree'], '{"user":{"name":"Ada"}}');
  check('--tree 从 stdin 树打印', r.status === 0 && /name/.test(r.stdout), r.stderr);
}
{
  const r = run(['--help']);
  check('--help rc=0 且列选项', r.status === 0 && /--max-depth/.test(r.stdout) && /--default/.test(r.stdout));
}
{
  const r = run(['--version']);
  check('--version rc=0 且含版本号', r.status === 0 && /jpath v/.test(r.stdout));
}
{
  const r = run([JSON_FILE, 'arr']);
  check('数组整体输出', r.status === 0 && /1/.test(r.stdout));
}

console.log('# 源码级防线：禁止 process.exit()（会截断 stdout）');
{
  const src = fs.readFileSync(CLI, 'utf8');
  const offenders = [];
  src.split('\n').forEach((line, i) => {
    if (/[^.\w]process\.exit\s*\(/.test(line)) offenders.push((i + 1) + ': ' + line.trim());
  });
  check('index.js 中无 process.exit()', offenders.length === 0, offenders.join(' | '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? '\nALL_OK' : `\nFAILED: ${fails}`);
process.exitCode = fails === 0 ? 0 : 1;