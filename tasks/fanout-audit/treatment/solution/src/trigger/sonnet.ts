/** Call Sonnet. Console keys use x-api-key; Claude Code OAuth tokens use Bearer. */
export async function generateSonnet(prompt: string): Promise<string> {
  const token = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || "";
  if (!token) throw new Error("missing ANTHROPIC_API_KEY");

  const oat = token.startsWith("sk-ant-oat");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (oat) {
    headers.authorization = `Bearer ${token}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = token;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    content?: { type: string; text?: string }[];
  };
  if (!res.ok) {
    throw new Error(`sonnet ${res.status} ${json.error?.message ?? JSON.stringify(json).slice(0, 200)}`);
  }
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text) throw new Error("sonnet returned empty text");
  return text;
}
