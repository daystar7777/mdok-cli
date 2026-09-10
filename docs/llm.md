# LLM integration

Design stance: **the model is a utility, not the product**. Markdown files stay
plain and portable; AI output is always reviewable text, never lock-in.

## 1. BYOK + provider shape

- Any OpenAI-compatible `/chat/completions` endpoint (`baseURL` + key + model).
  Key resolution: `MDOK_API_KEY` → `OPENAI_API_KEY` → config file. Keys are
  never logged, never leave the device except to the configured endpoint.
- No built-in keys, no proxy, no telemetry. Local endpoints (Ollama-style
  `http://localhost:11434/v1`) work the same way.
- Out of scope: Anthropic-native Messages API, usage metering, model routing.

## 2. Streaming (`chatCompletionStream`)

- SSE `data:` parsing with chunk-edge buffering (partial JSON is re-buffered,
  not dropped), `[DONE]` handling, 120 s abort timeout.
- UI appends deltas to `answer` state; the existing debounced preview pipeline
  renders progress. Stale streams are fenced by run-id; `Esc` aborts via
  `AbortController` (distinguishes `AbortError` → "cancelled").
- `ask` CLI command stays non-streaming (pipes want whole answers).

## 3. Ask

- Prompt = system instruction + active file + up to 4 other open tabs
  (truncated to 2 KB each, labeled by path) + question. Answers in the
  question's language. Rendered in the preview pane with an "editing resumes
  live preview" banner; any edit drops the answer.
- Missing key → message pointing at `mdok config --key`, not a dead end.

## 4. Rewrite (inline AI)

- Requires a non-empty selection (mouse drag or Shift+arrows; else a message
  saying exactly that). Prompt demands *only* rewritten markdown, no fences.
- Result shows as a red/green line diff (`diffLines`: LCS with a dumb-replace
  fallback past 40k cells, tested). `Enter`/`y` applies (splice into buffer),
  `Esc`/`n` rejects. No auto-apply, ever.

## 5. Prompt hygiene

- Temperatures fixed low (0.3). No system-prompt user editing yet (candidate:
  `AGENTS.md`/rules injection — see roadmap).
- Cost control is the user's (BYOK + model choice). We never retry silently;
  errors surface verbatim with the failing step named.

## Open questions (reviewers)

1. Multi-tab context (4×2 KB) is a heuristic — proper project context
   (`AGENTS.md`, rules, skill files) vs. simplicity?
2. Should rewrite stream tokens into the diff view, or is batch-then-review
   the right call for trust?
3. Any prompt-injection handling needed for untrusted file content, given the
   model only *reads* files and the user reviews all writes?
