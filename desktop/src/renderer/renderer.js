/* global Terminal, FitAddon */
(function () {
  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 0, // the TUI owns the screen; no scrollback needed
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById("term"));
  fit.fit();

  const sendSize = () => {
    try {
      window.mdok.resize(term.cols, term.rows);
    } catch {
      // main not ready yet
    }
  };
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      fit.fit();
      sendSize();
    });
  });

  term.onData((data) => window.mdok.input(data));
  window.mdok.onData((data) => term.write(data));
  window.mdok.ready();
  // Fit once fonts settle, then report the real size.
  setTimeout(() => {
    fit.fit();
    sendSize();
  }, 150);

  const picker = document.getElementById("filepicker");
  window.mdok.onMenuOpen(() => picker.click());
  picker.addEventListener("change", () => {
    const f = picker.files && picker.files[0];
    if (f && f.path) window.mdok.openPicked(f.path);
    picker.value = "";
  });
})();
