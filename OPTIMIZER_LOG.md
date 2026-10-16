# 优化器工作日志 — jpath

## Round 1 · 2026-10-16

**存活评估**：保留。jq / fx / jid / gron 各有明确位置，jpath 的「点路径零 DSL + 单文件零依赖 + 管道友好」不构成碾压关系。

**方向**：单点深度特化 —— 消除静默错数据。

### P0 · 安全事故：包名撞车

npm 上的 `jpath` 是 **artjock 的包**（XPath for JSON, v0.0.20），不是本项目。
README 却教用户 `npm i -g jpath` 和 `npx jpath` —— 用户会装到别人的程序，
并且**占用同名命令 `jpath`**，之后每次调用都以为在用本项目。

修：README 顶部加 ⚠️ 警告 + 贴出 `npm view jpath` 的真实输出作为证据，
给出 clone 直跑与 `npm i -g github:huanweide/jpath` 两条可用路径；
CI 加门禁：README 的 bash 代码块内不得再出现 `npm i -g jpath` / `npx jpath`。

### P0 · 静默给错数据（3 个）

| 场景 | 原行为 | 后果 |
|---|---|---|
| `--grep X --ungron` | 打印 `undefined`，rc=0 | 输出不是 JSON 却成功退出 |
| ungron 过滤无命中 | 打印 `undefined`，rc=0 | 同上 |
| `--max-depth abc` | 整棵树不截断，rc=0 | 用户以为限了深度，实则完全没限 |

第三条的机理值得记：`Number('abc')` = NaN，而渲染层的 `depth >= opts.maxDepth`
在 NaN 下**恒为 false**，于是截断条件永不成立。数值参数不做校验，
NaN 会一路静默传播到业务判断里 —— 这类「NaN 静默传播」是解析型工具的经典陷阱。

### P0 · 参数契约缺失

`--indent abc` / `-i abc` / `--max-depth 负数` / `--max-depth 小数` / 选项缺取值 /
未知短选项 `-x` —— 原实现全部静默 exit 0。补 `need()` / `needInt()` / `intOrThrow()`
与 `UsageError`，一律退 2。

### P1 · 输入缺失

`jpath --tree`（无文件、CI 里无 stdin）原本报「未提供输入文件」并退 1 ——
措辞含糊，且归类错误（这是用法问题不是运行问题）。改为退 2 并明确告诉用户怎么喂数据。

### P1 · 文档宣称但未实现

README 一直写「`-` 或省略表示从 stdin 读」，但 `jpath user.name` 会把 `user.name`
当成文件名然后 ENOENT。现在按模式区分实现了这个行为（`--tree` 等模式下单参数仍是文件）。

### 验证

- 单测 26 → **33 项全绿**
- 冒烟 **44 项 ALL_OK**
- 变异测试 M1–M8 **全部被拦截**
- README 两道门禁本地注入实测可抓回归

### 自身失误（3 处，都是假结论）

1. 变异测试的替换串缩进写错，`assert old in s` 失败后没停，index.js 根本没被改，
   却输出「0 FAIL」——看起来像「变异存活」，实际是变异没发生。
2. M5 的用例只覆盖显式 `--flatten` 的写法，漏了 `--grep --ungron` 这条分支，
   变异一度存活。补分支覆盖后才拦住。
3. `readInput` 里 `fileArg` 默认是 `null` 不是 `undefined`，我用 `=== undefined` 判断，
   导致 stdin 分支失效。靠 `console.log(parseArgs(...))` dump 出 `"file":null` 才定位。

共同教训：**断言失败要当场抛，不要让流程继续往前走**。测试脚本里的假绿比测试失败危险得多。
