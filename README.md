<p align="center">
  <img src="assets/banner.svg" alt="jpath">
</p>

<p align="center">
  <a href="#四问摘要">30 秒看懂</a> · <a href="#使用">用法</a> · <a href="#cli-参考">命令参考</a> · <a href="#安全与约束">安全边界</a> · <a href="#开发与测试">开发</a>
</p>

# jpath

> 零依赖 JSON 路径查询 + 树打印 + 拍平过滤 CLI —— jq 的轻量替代，点路径零 DSL。

[![npm](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

`jpath` 让你用**类 JS 属性访问的点路径**（如 `user.name`、`users[0].email`）从 JSON / JSONL / stdin 里取字段、打印彩色结构树、把整份 JSON 拍平成 `path = value` 行再用 grep 过滤、甚至把过滤后的结果**重组回 JSON**。纯 Node 标准库，单文件，**零 npm 依赖**，跨平台（Windows / macOS / Linux）。

---

## 四问摘要

- **是什么**：一个命令行工具，专门处理「从 JSON 里取东西、看结构、按条件过滤、再拼回去」这类高频小事。支持路径查询、彩色树打印、gron 式拍平、grep 过滤、ungron 重组、结构统计。
- **为什么**：`jq` 功能极强但 DSL 学习曲线陡，很多人 80% 的时间只想要「取某个字段」；`gron` 虽好但是 Go 编译的二进制、不在 Node 生态里；`fx`/`jid` 是交互式 REPL/TUI，不适合管道。脚本里取个 JSON 字段还要写一大坨 `node -e` 很烦。`jpath` 用**点路径（零 DSL）**+ **单文件零依赖**，装上即走、随 Node 分发。
- **怎么做**：零安装 `git clone` 后 `node jpath/index.js`；`cat a.json | jpath - user.name` 取字段；`jpath a.json --tree` 看结构；`jpath a.json --flatten --grep email` 过滤；`... | jpath --ungron` 拼回去；`jpath a.json --stats` 看规模。（下文 `jpath` 均指本项目，**不要用 `npm i -g jpath`**，见下方警告）
- **差异化（vs 同类）**：
  - vs `jq`：jq 语法重、需专门学；jpath 用点路径，零 DSL，且自带彩色树打印与 ungron 重组。
  - vs `gron`：gron 是 Go 二进制；jpath 是零依赖 Node 单文件，直接进你的 Node 工具链 / CI。
  - vs `fx` / `jid`：它们是交互式 REPL / TUI；jpath 是纯管道 CLI，适合脚本与 `|` 串联。
  - 三者能力（取字段 + 树 + 拍平重组）在 jpath 一个工具里同时成立，且零依赖。

---

## ⚠️ 先看这里：本项目尚未发布到 npm，`npm i -g jpath` 会装错东西

npm 上的 `jpath` 是**另一个作者的包**（`artjock/jpath`，XPath 风格查询，v0.0.x），
**不是本项目**。实测 `npm view jpath` 结果如下：

```
name = 'jpath'
maintainers = 'artjock <artjock@gmail.com>'
repository = git://github.com/artjock/jpath.git
```

所以 `npm i -g jpath` 和 `npx jpath` 装到的是别人的程序，且会占用同名命令 `jpath`，
让你误以为在用本项目。**请用下面的方式运行。**

```bash
# 方式一：零安装直接跑（推荐）
git clone https://github.com/huanweide/jpath.git
node jpath/index.js --help

# 方式二：全局安装本项目（npm 从 GitHub 直装，绕开重名包）
npm install -g github:huanweide/jpath
```

要求 Node >= 18（仅用标准库，无原生模块、无编译）。

> 原文档写「Node >= 14」是错的：`node --test` 内置测试运行器自 Node 18 才引入，
> 而 `npm test` 依赖它。package.json 的 `engines` 已同步改为 `>=18`。

> 若你之后在 npm 上发布本项目，请先确认 `jpath` 这个名字的归属与商标风险，
> 或改用一个未被占用的包名，并在本节同步更新。

---

## 使用

### 1. 路径查询（零 DSL 点路径）

```bash
# 从文件取字段
jpath package.json version
jpath package.json bin.jpath

# 从管道 / stdin 取字段（`-` 可省略）
curl -s https://api.github.com/users/huanweide | jpath - login
curl -s https://api.github.com/users/huanweide | jpath login
cat data.json | jpath - user.name

# 数组索引、带引号的特殊键
jpath data.json 'users[0].email'
jpath data.json 'a["key.with.dot"]'

# 原始输出（字符串去引号）/ 强制 JSON
jpath data.json user.name --raw
jpath data.json user --json

# 路径不存在时给回退值（适合脚本）
jpath config.json redis.url --default "127.0.0.1:6379"
```

### 2. 彩色树打印（探索阅读大 JSON）

```bash
jpath big.json --tree
jpath big.json --tree --max-depth 2     # 只看前两层
```

### 3. 拍平 + grep 过滤（gron 式）

```bash
# 拍平成 "path = value" 行
jpath data.json --flatten

# 按路径或值过滤（子串，或 /regex/）
jpath data.json --flatten --grep email
jpath data.json --flatten --grep "/@gmail\\.com$/"

# 把过滤结果写文件，之后重组回 JSON
jpath data.json --flatten --grep ERROR > errors.txt
jpath errors.txt --ungron > errors.json

# 也可以在同一次调用里完成「拍平 + 过滤 + 重组」
# （--grep 匹配的是拍平后的 "path = value" 行，不是原始 JSON 文本）
jpath data.json --grep ERROR --ungron > errors.json
```

### 4. 统计结构规模

```bash
jpath data.json --stats
# 叶子值总数 / 最大深度 / 对象数 / 数组数 / 值类型分布
```

### 5. JSONL 支持

```bash
# 逐行 JSON，对每行取同一路径
jpath logs.jsonl 'level'          # 输出每行 level
jpath logs.jsonl --flatten --grep ERROR
```

---

## CLI 参考

| 选项 | 含义 |
|------|------|
| `<file>` | JSON 文件路径；`-` 或省略表示从 stdin 读 |
| `<path>` | 点路径查询（查询模式） |
| `--tree` | 彩色树形打印结构 |
| `--flatten` | 拍平为 `path = value` 行 |
| `--grep PATTERN` | 拍平后按路径/值过滤（子串或 `/regex/`） |
| `--ungron` | 从拍平文本重组 JSON（接在 grep 之后） |
| `--stats` | 输出结构统计 |
| `-c, --color` | 强制彩色（默认 tty 自动） |
| `--no-color` | 关闭彩色 |
| `-r, --raw` | 原始值输出（字符串去引号） |
| `-j, --json` | 强制 JSON 输出 |
| `-i, --indent N` | JSON 缩进（默认 2） |
| `--max-depth N` | 树打印深度限制 |
| `--default VAL` | 路径不存在时的回退值 |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

退出码：`0` 成功；`1` 运行错误（解析失败 / 路径缺失且无 --default / 超 50MB）；`2` 参数错误（未知选项 / 缺参数 / `--max-depth`、`--indent` 不是非负整数 / 缺少输入）。

参数写错时**不会静默继续**：`jpath data.json --max-depth abc` 会退 2，而不是默默把 `abc` 变成 `NaN`、让整棵树消失。

---

## 安全与约束

- **零依赖**：仅用 Node 标准库（`fs` / `path`），无第三方包、无原生编译、无网络请求、无 `eval`。
- **输入上限 50MB**：超大文件直接拒绝，避免 OOM（脚本场景下的防御性默认）。
- **无密钥 / 无外部调用**：纯本地处理，可放心进 CI 与自动化前置检查。

---

## 开发与测试

```bash
node --check index.js       # 语法检查
npm test                    # node --test 跑单测（26 项）
npm run smoke               # CLI 冒烟：真实 spawn 进程，验退出码契约与 stdout 完整性
npm run verify              # test + smoke
```

为什么单测之外还要冒烟：`node --test` 只验证导出的函数，**完全不碰进程级行为**——
改退出码逻辑时单测仍全绿，只有真正 `spawnSync` 跑进程才拦得住。

---

## 作者

由 **ReTr · 樊斯瑞** 维护 · [GitHub 主页](https://github.com/huanweide)

---

## CI 门禁用法

jpath 不是「健康分」类体检工具（这句模板文案是从家族其它项目复制来的，jpath 没有健康分）。
它在流水线里的正确用法是**取值断言**——从 JSON 里取一个字段，判定它等于预期值：

```bash
# 1) 字段必须存在且等于预期值（退出码即断言结果）
[ "$(jpath package.json version)" = "1.0.0" ] || { echo "版本号不符"; exit 1; }

# 2) 字段不存在时必须失败，且 --default 能兜底（适合可选依赖探测）
jpath pkg.json peerDependencies.eslint --default "无" 

# 3) 结构统计：JSON 深度异常时提前告警
jpath big.json --stats | grep -q 'maxDepth' || exit 1

# 4) 区分「用错参数」与「跑挂了」：前者退 2，后者退 1
jpath big.json --tree --max-depth abc || exit $?   # -> 2（参数错误）
jpath big.json --tree                              # -> 1（若输入不存在）
```

本仓库自身的 CI（`.github/workflows/verify.yml`）跑的是：Node 18/20/22 × ubuntu/windows
的单测 + CLI 冒烟 + 零依赖自证 + README 与实现一致性检查。

## 赞助支持

如果这个项目帮到了你，欢迎 [点 Star](https://github.com/huanweide/jpath) 支持；也可微信扫码自愿赞助（收款码见 `sponsor/wechat-qr.png`，作者本人带 Tri 水印的码，纯静态图片、不含任何密钥）。

## 许可证

详见 [LICENSE](LICENSE)。
