import { Injectable } from "@nestjs/common";

interface ResponsesPayload {
  output_text?: unknown;
  output?: readonly {
    type?: unknown;
    content?: readonly { type?: unknown; text?: unknown }[];
  }[];
}

@Injectable()
export class OpenAiAdvisoryService {
  get enabled(): boolean {
    return (
      process.env.ABP_EXTERNAL_AI_ENABLED === "true" &&
      (process.env.OPENAI_API_KEY ?? "").trim().length > 0
    );
  }

  async generate(
    context: string,
  ): Promise<{ text: string; responseId: string | null }> {
    if (!this.enabled) throw new Error("EXTERNAL_AI_DISABLED");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 8_000);
    try {
      const baseUrl = (
        process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
      ).replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-5.2",
          store: false,
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text: "You provide commercial research assistance only. Never make an authoritative business decision, invent facts, or expose identifiers. Return a concise advisory with observations, risks, and a suggested next review step.",
                },
              ],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: context }],
            },
          ],
          text: { verbosity: "low" },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`EXTERNAL_AI_HTTP_${response.status}`);
      const payload = (await response.json()) as ResponsesPayload;
      const text = extractText(payload).trim();
      if (!text) throw new Error("EXTERNAL_AI_EMPTY_RESPONSE");
      const responseId =
        typeof (payload as { id?: unknown }).id === "string"
          ? (payload as { id: string }).id
          : null;
      return { text, responseId };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractText(payload: ResponsesPayload): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter(
      (item) => item.type === "output_text" && typeof item.text === "string",
    )
    .map((item) => item.text as string)
    .join("\n");
}
