# Markdown compatibility and external tools

Version: 0.1.6. External integrations are experimental; real conversion fidelity is not certified.

Version 0.1.7 additions: local math highlighting/diagnostics, restricted
KaTeX/MathJax validation, delimiter conversion and structural/Git comparison.
See [math tools and exact limits](math-tools.md). These do not add typeset math
to the TUI or change the built-in HTML renderer.

Markdown has dialects/extensions, not one universal app-version format. VS Code is an editor, not a Markdown dialect; preview extensions may interpret documents differently. mdok does not promise identical rendering or lossless conversion between all applications.

| Feature | Built-in TUI / HTML | Optional Pandoc export |
| --- | --- | --- |
| Headings, lists, links, fenced code | Marked-based rendering | Selected reader |
| Pipe tables, alignment | GFM-style support; terminal width limits display | GFM/Pandoc; complex layout can be lost |
| Grid/multiline tables, citations, attributes | Not promised | Reader-specific; citation processing is not exposed |
| `$…$`, `$$…$$` | Editable source, no typeset math; built-in HTML has no math renderer | Pandoc profile: MathML HTML / XeLaTeX PDF |
| Arbitrary TeX packages/macros/projects | Not a TeX IDE | Not promised; raw TeX passthrough disabled |
| DOCX/EPUB/LaTeX/PDF | Not built-in rendering | External tools required |

## TUI

`Ctrl+O`, `f`: existing File items 1–7 are unchanged.

- **8 VS Code**: saved file at current cursor using `code --goto`. Save dirty buffers first. This is not a VS Code extension or live collaborative editing. Existing watcher checks external changes; dirty buffers are warned, never automatically merged.
- **9 Pandoc**: item 1 cycles `gfm`, `commonmark`, `pandoc`; items 2–6 export DOCX, EPUB, LaTeX, HTML (MathML), PDF. Profile affects export only, not TUI preview.
- Export freezes the current buffer including unsaved text. Destination: `<basename>.export.<extension>`. Existing files/symlinks are never overwritten; use another output path through CLI if needed.

The `gfm` and `commonmark` profiles pass those Pandoc readers without adding extensions. CommonMark does not promise tables/math. Select **pandoc** for dollar math: it uses `markdown-raw_tex-raw_html-yaml_metadata_block`. Raw passthrough and YAML metadata are intentionally disabled; this is restricted Pandoc compatibility.

## CLI

```sh
mdok convert note.md --trusted --profile pandoc --format latex -o note.tex
mdok convert note.md --trusted --profile pandoc --format html -o note-math.html
mdok convert note.md --trusted --profile gfm --format docx -o note.docx
mdok convert note.md --trusted --profile pandoc --format pdf -o note.pdf
```

Existing `mdok export` remains the built-in HTML exporter. MathML display depends on the viewing browser; no browser/PDF viewer is automatically launched. This integration requests no math CDN.

## Dependencies, safety and limits

`pandoc`, PDF engine `xelatex`, and VS Code's `code` CLI must be installed separately and on PATH. mdok does not install them. Missing tools/packages/fonts and conversion errors are reported. External-tool diagnostics can remain in their own language.

Use trusted documents only. The integration uses argv-based `execFile`, a 120-second timeout, Pandoc `--sandbox` and XeLaTeX `-no-shell-escape`. These are **not a complete sandbox for TeX/PDF engines**: untrusted documents require OS-level isolation not provided here. No custom filters/templates/extra arguments are exposed. Resource restrictions may prevent external images from loading. Korean PDF fonts/packages are not configurable here yet; Korean PDF fidelity is not promised.

Conversion is local, without source uploads. Exports are plaintext copies. In SSH sessions the tool runs on the remote host, so `code` is not guaranteed to open local VS Code.

Tests cover argument profiles, cursor coordinates, shell-safe filenames, buffer snapshots, destination non-overwrite/symlink protection, failed processes and cleanup. PTY tests cover menu/profile interactions. VS Code CLI 1.137.0 is installed and responds to --version, but GUI launch is not verified. This host lacks Pandoc and XeLaTeX, so real DOCX/EPUB/PDF fidelity remains unverified. Retain source documents and inspect converted tables/math. The integration is experimental, not a claim of certified compatibility.

References: [Pandoc manual](https://pandoc.org/MANUAL.html), [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line).

## 사용자 문의 답변 예시 (0.1.5 공개 당시 기록)

말씀하신 부분이 맞습니다. Markdown은 기본 문법 외에 앱이나 확장 기능이 지원하는 문법이 달라서, 특히 표와 수식은 같은 파일이라도 다르게 보일 수 있습니다. VS Code도 설치된 확장에 따라 차이가 날 수 있고요.

현재 공개 버전은 기본 Markdown과 GFM 스타일의 표를 중심으로 지원합니다. LaTeX 수식은 소스로 작성·보존할 수 있지만, TUI 안에서 수식을 조판해 보여주는 기능은 아직 지원하지 않습니다. LaTeX 전체 지원과는 구분해서 안내드리는 것이 맞겠습니다.

이 차이를 명확하게 하기 위해 지원 문법과 제한을 문서화하고, 개발 버전에는 GFM/CommonMark/제한된 Pandoc Markdown을 선택하는 내보내기와 VS Code 연결을 추가했습니다. 수식이 있는 문서는 Pandoc을 통한 HTML·LaTeX·PDF 출력으로 연결하는 방향입니다. 다만 외부 도구 설치가 필요하고 실제 변환 품질 검증은 남아 있어, 모든 앱과 완전 호환된다고 말씀드리지는 않겠습니다. 문제가 되는 표나 수식 예시를 주시면 회귀 테스트에 반영하겠습니다.
