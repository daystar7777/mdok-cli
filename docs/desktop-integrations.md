# mdok desktop connections (macOS preview)

## CLI

```sh
mdok desktop README.md
mdok desktop README.md --app /absolute/path/mdok.app
```

`mdok FILE` keeps its existing TUI behavior. `desktop` without a file launches the app.
App discovery checks `/Applications/mdok.app` then `~/Applications/mdok.app`.
The desktop must be a build that supports external-file receiving; an older build
may launch without opening the file. Development build path:
`desktop/src-tauri/target/release/bundle/macos/mdok.app`.

Local .md/.markdown files up to 1MiB only. No URLs, symlink files or remote schemes.
Launching uses an argument array, not shell interpolation. Success is **open requested**,
not confirmation of document display: the user may cancel the desktop's unsaved-changes dialog.
The OS open-file event is queued until the renderer is ready. Requests are processed
serially through the existing flush/save guard. One active document remains.
The queue is bounded to 16 pending unique paths; excess requests are not accepted.
No line jump, deep-link scheme or remote download is provided in this release.

## Local MCP

```sh
mdok mcp --root /absolute/allowed/documents --app /absolute/path/mdok.app
```

STDIO transport; stdout is reserved for MCP JSON-RPC. The only tool is
`open_in_mdok({"path":"/absolute/allowed/documents/example.md"})`.
Configure explicit trusted root directories. Canonical paths must remain inside
one of those roots; traversal and symlinked-parent escapes are refused. Do not use
the entire home directory as a root. There is no read/write/shell tool and no file
content is returned to the model. File paths can still appear in the client's tool logs.
Local filesystem changes can race path validation; this is not a filesystem sandbox
against another process running as the same OS user.

Keep tool approval enabled. Only request opening in response to user intent.
Remote MCP running in a cloud/container cannot launch the user's local app.

### Claude Desktop / Kimi Code / Antigravity

Add this **server entry**, preserving all existing settings. For clients whose
configuration uses `mcpServers`, put it under that key:

```json
{
  "mcpServers": {
    "mdok": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mdok/dist/index.js", "mcp", "--root", "/absolute/allowed/documents", "--app", "/absolute/path/mdok.app"]
    }
  }
}
```

Use the actual installed executable paths (GUI apps may not inherit terminal PATH).
Claude Desktop uses its local MCP configuration, not a cloud connector. Kimi Code
uses its MCP configuration manager; Antigravity uses its custom MCP configuration.
Version-specific locations should be checked in the linked official docs. This
release does not install a Claude `.mcpb` package or mutate any client configuration.

### OpenCode

```json
{
  "mcp": {
    "mdok": {
      "type": "local",
      "command": ["/absolute/path/to/node", "/absolute/path/to/mdok/dist/index.js", "mcp", "--root", "/absolute/allowed/documents", "--app", "/absolute/path/mdok.app"],
      "enabled": true
    }
  }
}
```

### CodeBuddy CLI

```sh
codebuddy mcp add --scope user mdok -- /absolute/path/to/node /absolute/path/to/mdok/dist/index.js mcp --root /absolute/allowed/documents --app /absolute/path/mdok.app
```

For CodeBuddy IDE use its MCP settings and the equivalent local STDIO command.

## VS Code

The extension in `integrations/vscode` contributes real Explorer/editor menus.
Install its VSIX using **Extensions: Install from VSIX…**, then configure the app
path in User Settings if needed. The extension rejects remote workspaces rather than
passing a server path to a local application. Unsaved buffers require Save and Open.
MCP installation alone does not add file-context menu items to other products.

## Validation scope

Automated tests cover path boundaries, Unicode/space/shell metacharacters, size,
symlinks, a real SDK client/server STDIO handshake, invalid tool requests, mocked
VS Code invocation and dirty/remote/trust handling. Desktop renderer tests cover
flushing edits before external open, cancellation preservation and single-reader
replacement. Native compilation/file-association packaging is checked separately.
These are not end-to-end certification of every named client. Installing into
each user's client and testing its approval/UI behavior remain separate steps.

Sources: [Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[Kimi](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html),
[OpenCode](https://opencode.ai/docs/mcp-servers),
[Antigravity](https://antigravity.google/docs/mcp),
[CodeBuddy](https://www.codebuddy.ai/docs/cli/mcp),
[VS Code menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus).
