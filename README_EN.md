<p align="center">
  <img src="assets/banner.svg" alt="jpath">
</p>

<p align="center">
  <a href="#thirty-second-summary">30-second overview</a> · <a href="#usage">Usage</a> · <a href="#cli-reference">CLI reference</a> · <a href="#security-and-constraints">Security</a> · <a href="#develop-and-test">Develop</a>
</p>

**中文** · [README.md](./README.md)

# jpath

> Zero-dependency JSON path query + tree print + flatten/filter CLI — a lightweight alternative to jq, with dot-path and zero DSL.

[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

`jpath` lets you use **JS-like property-access dot paths** (e.g. `user.name`, `users[0].email`) to pull fields from JSON / JSONL / stdin, print a colorful structure tree, flatten the whole JSON into `path = value` lines for grep filtering, even **reassemble the filtered result back into JSON**. Pure Node standard library, single file, **zero npm dependencies**, cross-platform (Windows / macOS / Linux).

---

## Thirty-second summary

- **What**: a command-line tool dedicated to the high-frequency small tasks of "get something from JSON, see its structure, filter by condition, put it back". Supports path query, colorful tree print, gron-style flatten, grep filter, ungron reassembly, and structure stats.
- **Why**: `jq` is extremely powerful but has a steep DSL learning curve — most people want "grab a field" 80% of the time; `gron` is nice but a Go-compiled binary outside the Node ecosystem; `fx`/`jid` are interactive REPL/TUI, unfit for pipes. Writing a big chunk of `node -e` just to grab a JSON field in a script is annoying. `jpath` uses **dot paths (zero DSL)** + **single-file zero-dependency**, install-and-go, distributed with Node.
- **How**: zero-install `git clone` then `node jpath/index.js`; `cat a.json | jpath - user.name` to grab a field; `jpath a.json --tree` to see structure; `jpath a.json --flatten --grep email` to filter; `... | jpath --ungron` to reassemble; `jpath a.json --stats` for size. (Below, `jpath` means this project — **do not `npm i -g jpath`**, see the warning below.)
- **Differentiation (vs peers)**:
  - vs `jq`: jq's syntax is heavy and must be learned specially; jpath uses dot paths, zero DSL, and ships colorful tree print + ungron reassembly.
  - vs `gron`: gron is a Go binary; jpath is a zero-dependency Node single file, dropping straight into your Node toolchain / CI.
  - vs `fx` / `jid`: they're interactive REPL / TUI; jpath is a pure pipeline CLI, fit for scripts and `|` chaining.
  - All three capabilities (grab field + tree + flatten/reassemble) hold simultaneously in jpath, and it's zero-dependency.

---

## ⚠️ Read this first: this project is not published on npm — `npm i -g jpath` installs the wrong thing

The `jpath` on npm is **a different author's package** (`artjock/jpath`, XPath-style query, v0.0.x), **not this project**. Confirmed `npm view jpath` result:

```
name = 'jpath'
maintainers = 'artjock'
repository = git://github.com/artjock/jpath.git
```

So `npm i -g jpath` and `npx jpath` install someone else's program and occupy the same `jpath` command name, making you think you're using this project. **Use the method below.**

```bash
# Method 1: zero-install, run directly (recommended)
git clone https://github.com/huanweide/jpath.git
node jpath/index.js --help

# Method 2: install this project globally (npm installs from GitHub, bypassing the name clash)
npm install -g github:huanweide/jpath
```

Requires Node >= 18 (standard library only, no native modules, no compilation).

> The old doc saying "Node >= 14" was wrong: the built-in `node --test` runner was only introduced in Node 18, and `npm test` depends on it. `package.json`'s `engines` has been updated to `>=18` accordingly.

> If you later publish this project to npm, first confirm the ownership / trademark risk of the `jpath` name, or use an unoccupied package name and update this section accordingly.

---

## Who should use this

- Anyone who frequently grabs fields from JSON in shell scripts / CI without learning `jq`'s DSL.
- Node/JS projects that want a JSON tool that lives in the same toolchain (no extra binary).
- Pipelines that need gron-style flatten + grep + ungron reassembly.

## Who should not use this

- If you need the full power of `jq` (complex transformations, streaming, math) — jpath is deliberately lighter.
- If you prefer an interactive TUI — use `fx` / `jid`.

## Usage

### 1. Path query (zero-DSL dot path)

```bash
# Grab a field from a file
jpath package.json version
jpath package.json bin.jpath

# Grab from a pipe / stdin (`-` is optional)
curl -s https://api.github.com/users/huanweide | jpath - login
curl -s https://api.github.com/users/huanweide | jpath login
cat data.json | jpath - user.name

# Array index, quoted special keys
jpath data.json 'users[0].email'
jpath data.json 'a["key.with.dot"]'

# Raw output (string without quotes) / force JSON
jpath data.json user.name --raw
jpath data.json user --json

# Fallback value when path doesn't exist (script-friendly)
jpath config.json redis.url --default "127.0.0.1:6379"
```

### 2. Colorful tree print (explore a large JSON)

```bash
jpath big.json --tree
jpath big.json --tree --max-depth 2     # only the first two levels
```

### 3. Flatten + grep filter (gron-style)

```bash
# Flatten into "path = value" lines
jpath data.json --flatten

# Filter by path or value (substring, or /regex/)
jpath data.json --flatten --grep email
jpath data.json --flatten --grep "/@gmail\\.com$/"

# Write the filtered result to a file, then reassemble to JSON
jpath data.json --flatten --grep ERROR > errors.txt
jpath errors.txt --ungron > errors.json

# Or do "flatten + filter + reassemble" in one call
# (--grep matches the flattened "path = value" line, not the raw JSON text)
jpath data.json --grep ERROR --ungron > errors.json
```

### 4. Structure stats

```bash
jpath data.json --stats
# total leaf values / max depth / object count / array count / value-type distribution
```

### 5. JSONL support

```bash
# Line-by-line JSON, same path for each line
jpath logs.jsonl 'level'          # outputs each line's level
jpath logs.jsonl --flatten --grep ERROR
```

---

## CLI reference

| Option | Meaning |
|------|------|
| `<file>` | JSON file path; `-` or omitted means read from stdin |
| `<path>` | dot-path query (query mode) |
| `--tree` | colorful tree print of structure |
| `--flatten` | flatten into `path = value` lines |
| `--grep PATTERN` | filter flattened lines by path/value (substring or `/regex/`) |
| `--ungron` | reassemble JSON from flattened text (after grep) |
| `--stats` | output structure statistics |
| `-c, --color` | force color (default auto on tty) |
| `--no-color` | disable color |
| `-r, --raw` | raw value output (string without quotes) |
| `-j, --json` | force JSON output |
| `-i, --indent N` | JSON indent (default 2) |
| `--max-depth N` | tree print depth limit |
| `--default VAL` | fallback value when path doesn't exist |
| `-h, --help` | help |
| `--version` | version |

Exit codes: `0` success; `1` runtime error (parse failure / missing path with no `--default` / over 50MB); `2` parameter error (unknown option / missing argument / `--max-depth`, `--indent` not a non-negative integer / missing input).

When a parameter is wrong it **won't silently continue**: `jpath data.json --max-depth abc` exits 2, rather than quietly turning `abc` into `NaN` and making the whole tree disappear.

---

## Security and constraints

- **Zero dependencies**: only Node standard library (`fs` / `path`), no third-party packages, no native compilation, no network requests, no `eval`.
- **50MB input cap**: oversized files are rejected outright to avoid OOM (a defensive default for script scenarios).
- **No secrets / no external calls**: pure local processing, safe to drop into CI and automation pre-checks.

---

## Develop and test

```bash
node --check index.js       # syntax check
npm test                    # node --test unit tests (26)
npm run smoke               # CLI smoke: real spawn process, verifies exit-code contract and stdout integrity
npm run verify              # test + smoke
```

Why smoke tests on top of unit tests: `node --test` only verifies exported functions, **never touching process-level behavior** — when you change exit-code logic, unit tests stay green, and only a real `spawnSync` process catches it.

---

## Author

Maintained by **huanweide** · [GitHub](https://github.com/huanweide)

---

## CI gate usage

jpath is not a "health score" checkup tool (this template line was copied from other family projects — jpath has no health score). Its correct use in a pipeline is **value assertion** — grab a field from JSON and assert it equals an expected value:

```bash
# 1) Field must exist and equal the expected value (exit code is the assertion result)
[ "$(jpath package.json version)" = "1.0.0" ] || { echo "version mismatch"; exit 1; }

# 2) Field must fail when absent, and --default can fall back (good for optional-dep probing)
jpath pkg.json peerDependencies.eslint --default "none"

# 3) Structure stats: warn early when JSON depth is abnormal
jpath big.json --stats | grep -q 'maxDepth' || exit 1

# 4) Distinguish "wrong argument" from "crashed": former exits 2, latter exits 1
jpath big.json --tree --max-depth abc || exit $?   # -> 2 (parameter error)
jpath big.json --tree                              # -> 1 (if input doesn't exist)
```

This repo's own CI (`.github/workflows/verify.yml`) runs: Node 18/20/22 × ubuntu/windows unit tests + CLI smoke + zero-dependency self-proof + README/implementation consistency check.

## License

See [LICENSE](LICENSE).
