/** Why a call to the AI model failed, as a stable code the UI and logs can act on. */
export class AiError extends Error {
  constructor(code, status, detail = "") {
    super(`${code} (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.code = code;
    this.status = status;
  }
}

const OUT_OF_CREDIT = /overdue|arrear|insufficient|balance|quota|credit|billing|payment required|exceeded your current/i;

/** Maps a failed model response to one of four codes. The body is only used for matching, never shown to users. */
export function classifyAiFailure(status, bodyText = "") {
  const text = String(bodyText).slice(0, 2000);
  if (status === 402 || ((status === 403 || status === 429) && OUT_OF_CREDIT.test(text))) return "AI_CREDITS_EXHAUSTED";
  if (status === 401 || status === 403) return "AI_KEY_REJECTED";
  if (status === 429) return "AI_RATE_LIMITED";
  return "AI_UNAVAILABLE";
}

export async function aiErrorFrom(response) {
  const body = await response.text().catch(() => "");
  return new AiError(classifyAiFailure(response.status, body), response.status);
}

/** What a shopper is told. No provider details, and always a way forward. */
export const AI_ERROR_MESSAGE = {
  AI_CREDITS_EXHAUSTED: "The demo agent has run out of AI credits, so it cannot answer right now. The store itself still works: connect your own agent to /mcp to place an order.",
  AI_KEY_REJECTED: "The demo agent is not set up correctly on this server. The store itself still works: connect your own agent to /mcp to place an order.",
  AI_RATE_LIMITED: "The demo agent is getting too many requests. Please try again in a minute.",
  AI_UNAVAILABLE: "The agent could not answer just now. Please try again.",
};
