import { z } from "zod";

const MAX_ROUNDS = 6;

const systemPrompt = (merchantName) => `You are a shopping assistant that orders from ${merchantName} on behalf of the user.
You act only through the store's tools. You cannot pay: only the user can approve a payment, in PayPal.

How to work:
- Look up products with list_products before ordering, and match what the user asked for to a SKU.
- When the user wants to buy, call create_quote, then request_payment, in the same turn. Do not ask for confirmation first; the user confirms on the approval page.
- Pass the user's own words as "intent" in create_quote, unchanged.
- After request_payment, tell the user the items and total and that they need to approve. The approval link is shown to them as a button, so do not print the URL.
- Never say an order is paid unless check_payment returned status PAID. When the user says they approved, call check_payment.
- If the store refuses an order, say why in one sentence. Only suggest an alternative that would pass: an item that alone costs more than the per-order limit cannot be ordered by an agent at all, so tell the user they have to buy it themselves.
- "Also order X" after an order was already requested means a new, separate order for X only.

Style: short, plain sentences. No emoji, no markdown. Reply in the language the user writes in.`;

/**
 * A small tool-calling agent. It stands in for whatever AI agent a shopper would bring,
 * and it gets the same four tools any agent gets over MCP, nothing more.
 * Works with any OpenAI-compatible chat completions endpoint that supports tools.
 */
export function createAgent({ apiKey, baseUrl, model, tools, merchantName, timeoutMs = 30000, fetchImpl = fetch }) {
  if (!apiKey || !baseUrl || !model) return null;
  const byteplus = /bytepluses\.com|volces\.com/.test(baseUrl);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.map((tool) => {
    const { $schema, ...parameters } = z.toJSONSchema(tool.schema);
    return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
  });

  const complete = async (messages) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        ...(byteplus ? { thinking: { type: "disabled" } } : {}),
        messages: [{ role: "system", content: systemPrompt(merchantName) }, ...messages],
        tools: toolSpecs,
      }),
    });
    if (!response.ok) throw new Error(`Agent model returned ${response.status}`);
    const message = (await response.json()).choices?.[0]?.message;
    if (!message) throw new Error("Agent model returned no message");
    return message;
  };

  /**
   * Runs one user turn. `history` is the prior conversation in chat-completions format.
   * Calls onEvent for each tool call, tool result and the final reply, and returns the new history.
   */
  return async function runTurn(history, userText, onEvent = () => {}) {
    const messages = [...history, { role: "user", content: userText }];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const message = await complete(messages);
      const calls = message.tool_calls ?? [];
      messages.push({ role: "assistant", content: message.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });

      if (calls.length === 0) {
        onEvent({ type: "reply", text: (message.content ?? "").trim() });
        return messages;
      }

      for (const call of calls) {
        const tool = byName.get(call.function?.name);
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        onEvent({ type: "tool_call", name: call.function?.name, input: args });
        const result = tool ? await tool.call(args) : { ok: false, data: { error: "UNKNOWN_TOOL", message: `No tool named ${call.function?.name}` } };
        onEvent({ type: "tool_result", name: call.function?.name, ok: result.ok, data: result.data });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) });
      }
    }

    onEvent({ type: "reply", text: "I could not finish that. Please try again." });
    return messages;
  };
}
