# mdok — Markdown OK

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

`.md` 文件的终端 TUI 编辑器:侧边栏浏览器 + 源码 + 实时预览、主题、
标签页、查找/替换、lint、shell 运行,以及 BYOK LLM (提问 + 改写)。

## 安装

```sh
npm install -g @daystar7777/mdok
```

> `mdok: command not found`? shell 看不到 npm 全局 bin 目录。
> 安装程序会给出正确的 `export PATH=…`。
> 手动检查: `npm prefix -g`,确认 `<prefix>/bin` 在 `PATH` 中。

从源码 (需要 Node.js 22+):

```sh
npm install
npm run build
npm link  # 或: node dist/index.js
```

## 用法

```sh
mdok README.md      # 打开 (同时恢复会话中的其他标签页)
mdok                # 恢复上次会话
mdok view README.md # 非交互式美化输出 (管道、脚本用)
mdok README.md | less

# 就打开的文件向 LLM 提问 (BYOK, 流式)
export MDOK_API_KEY=sk-...
mdok ask README.md -q "用三行总结本文档"

# lint + export (TUI 内也可以)
mdok lint README.md
mdok export README.md -o out.html

# 配置 (TUI 内按 ^O c 也都能改)
mdok config --url https://api.openai.com/v1 --model gpt-4o-mini
mdok config --key sk-... --theme ocean --git on --lang ko
```

配置保存在 `~/.mdok.json` (`MDOK_API_KEY`、`MDOK_BASE_URL`、`MDOK_MODEL`、
`MDOK_LANG` 环境变量优先)。会话 (打开的标签页、光标、未保存 buffer) 在
`~/.mdok-session.json`。

## 语言和主题

- UI 语言:简体中文 / English / 한국어。在设置中切换 (`^O c` → language)、
  `mdok config --lang ko` 或 `MDOK_LANG=ko`。适用于 TUI 和 CLI 消息。
- 主题:`forest · ocean · sunset · mono · rose`,按 `^O t` 循环 (会记住)。
  可通过 `~/.mdok-themes.json` 自定义:
  ```json
  { "themes": [{ "name": "mine", "focus": "cyan", "selBg": "blue",
    "selFg": "white", "findBg": "yellow", "findFg": "black",
    "findCurBg": "red", "findCurFg": "white", "accent": "cyan" }] }
  ```
- CJK 文本 (한글/漢字/emoji) 按显示宽度计算,编辑时光标、选区、
  鼠标点击不会错位。

## TUI 按键

| 按键 | 动作 |
|---|---|
| `Ctrl+O`, `Tab` / `e` / `p` | 切换面板 · 跳到源码/预览 |
| `Ctrl+O`, `1`–`9` / `w` | 切换标签页 / 关闭标签页 |
| `Ctrl+O`, `v` | 循环 分栏 / 源码 / 预览 |
| `Ctrl+O`, `b` | 开关侧边栏 (最近 · 大纲 · 工作目录) |
| `Ctrl+O`, `f` | 文件菜单 (保存 · 新建 · 打开… · 运行… · 导出 HTML · 关闭标签页) |
| `Ctrl+O`, `a` | 就打开的文件问 LLM,流式输出到预览 (`Esc` 取消) |
| `Ctrl+O`, `r` | AI 改写选区,看 diff 接受/丢弃 |
| `Ctrl+O`, `/` | 查找;`Tab` = 替换栏、`Enter` = 查找/替换、`n`/`N` 下一个/上一个 |
| `Ctrl+O`, `!` | 运行 shell 命令,结果显示在编辑器内 |
| `Ctrl+O`, `L` / `F` | 问题列表 / 整理 buffer |
| `Ctrl+O`, `\|` | 整理光标处的 pipe 表格 |
| `Ctrl+O`, `t` / `l` | 循环主题 (会记住) / 行号 |
| `Ctrl+O`, `V` | vim 模式 (hjkl/i/a/A/o/x/0/$/G,`Esc` = normal) |
| `Ctrl+O`, `m` 或 `F10` (Alt+M 也行) | 聚焦菜单栏 |
| `←`/`→`, `Enter`, `Esc` (菜单栏) | 移动 · 执行 · 取消 |
| `Ctrl+O`, `g` | git 同步面板 (push / pull --rebase / commit / 自动开关) |
| `Ctrl+O`, `c` / `?` | 设置 / 帮助 |
| `Ctrl+O`, `s` 或 `Ctrl+S` | 保存 |
| `Ctrl+O`, `q` 或 `Ctrl+Q` | 退出 (有修改时按两次) |
| `Shift`+方向键 | 选择文本 |
| `Tab` (源码中) | 插入两个空格 |

顶栏按钮 (`[>]` `[Split]` `[Ask]` `[Find]` `[File]` `[Shell]` `[Set]` `[?]` `[X]`、
带 `[+]` 的标签栏) 可点击,与以上按键一一对应。侧边栏和 shell 输出默认关闭
(`^O b`、`[Shell]` 按钮)。

(注意:`Ctrl+M` 不能用 —— 终端会把它当 Enter 上报。用 `F10`/`^O m`。)

## 鼠标

点击放置光标 / 切换标签页 / 按按钮,拖拽选择 (输入即替换),
滚轮滚动指针下的面板。支持 SGR 终端 (iTerm2、WezTerm、Ghostty、VSCode 等) 和
传统 X10 终端 (macOS 自带终端:点击可用,滚轮不可用 —— Apple 限制)。

tmux:需要在 `~/.tmux.conf` 加 `set -g mouse on`。替代方案:拖拽时按住 `Shift`
即终端原生选择。

## 同步 (文件 + git)

- mdok 原子写入 (临时文件 + rename),iCloud / Dropbox / Syncthing
  永远不会上传写一半的文件。把笔记放在同步文件夹就行。
- 在 git 仓库内 (关闭:`mdok config --git off` 或 `^O c`):
  保存 3 秒后自动提交 (`mdok: <文件>`),`^O g` push、pull
  (`--rebase --autostash`)、手动提交,状态栏显示 `git:<分支>⇡⇣` +
  冲突警告。首次 push 自动设置 upstream。冲突只提示,在 git 中解决。

## 路线图

- [x] TUI — 侧边栏 + 源码 + 实时预览,标签页,主题,会话恢复
- [x] `view` — 终端美化渲染
- [x] `ask` — 流式单文件/多文件问答 (BYOK,兼容 OpenAI)
- [x] 查找/替换、lint、整理、表格整理、HTML 导出、git 徽标、监视
- [x] 内联 AI 改写 + diff、vim 模式、shell 运行、最近文件
- [ ] `mdok ask` 其他供应商 (Anthropic 原生 API)
- [ ] 本地 Ollama 预设 (`--url http://localhost:11434/v1`)
