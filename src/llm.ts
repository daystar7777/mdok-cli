export interface ChatOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  system?: string;
}

export interface StreamOptions extends ChatOptions {
  signal?: AbortSignal;
}

function chatBody(userContent: string, opts: ChatOptions, stream: boolean): string {
  return JSON.stringify({
    model: opts.model,
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    ...(stream ? { stream: true } : {}),
  });
}

function endpoint(baseURL: string): string {
  return baseURL.replace(/\/$/, "") + "/chat/completions";
}

export async function chatCompletion(
  userContent: string,
  opts: ChatOptions,
): Promise<string> {
  const res = await fetch(endpoint(opts.baseURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: chatBody(userContent, opts, false),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM returned empty response");
  return content;
}

/** OpenAI-compatible SSE streaming. onToken fires per delta; resolves full text. */
export async function chatCompletionStream(
  userContent: string,
  opts: StreamOptions,
  onToken: (delta: string) => void,
): Promise<string> {
  const res = await fetch(endpoint(opts.baseURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: chatBody(userContent, opts, true),
    signal: opts.signal ?? AbortSignal.timeout(120000),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          if (!full.trim()) throw new Error("LLM returned empty response");
          return full;
        }
        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        try { parsed = JSON.parse(data); }
        catch { throw new Error("LLM returned malformed stream JSON"); }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!full.trim()) throw new Error("LLM returned empty response");
  return full;
}

export function buildPrompt(markdown: string, question: string): string {
  return [
    "You are mdok, a helpful assistant that analyzes a single Markdown file.",
    "Answer concisely in the same language as the question.",
    "Cite headings or code blocks when relevant.",
    "",
    "--- MARKDOWN START ---",
    markdown,
    "--- MARKDOWN END ---",
    "",
    `Question: ${question}`,
  ].join("\n");
}
