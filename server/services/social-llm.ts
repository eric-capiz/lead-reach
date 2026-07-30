/**
 * Groq client for social discovery (JSON request and response).
 */

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 45_000;

export function isSocialLlmEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

export async function requestGroqJson<T>(
  system: string,
  user: string,
): Promise<{ data: T; model: string } | null> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: groqModel(),
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) return null;

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const data = JSON.parse(raw) as T;
    return { data, model: groqModel() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
