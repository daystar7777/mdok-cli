# Open in mdok

Adds **mdok: Open in Desktop / 데스크톱으로 열기** to the command palette,
Markdown editor title and local Markdown Explorer context menu.

Requires macOS and mdok desktop with external-file receiving support.
Install `mdok.app` in `/Applications` or `~/Applications`, or set the absolute
`mdok.appPath` in **User Settings**. No npm CLI installation is required by this extension.

Dirty documents prompt to save first; cancelling does nothing. The desktop may
also ask whether to save its own active document. Only one active desktop document
is used. This extension requests opening; it cannot confirm acceptance of the desktop dialog.

Remote SSH/containers, browser VS Code, untitled files and untrusted workspaces
are not supported. Download remote content locally first. macOS Markdown file
association is optional and is not changed by this extension.

Development: `node --test test.cjs`. Package using `@vscode/vsce package`.
No claim of compatibility with VS Code forks until tested in those products.
