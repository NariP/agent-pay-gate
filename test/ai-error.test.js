import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgent } from "../src/agent.js";
import { AI_ERROR_MESSAGE, classifyAiFailure } from "../src/ai-error.js";

test("an exhausted balance is told apart from other failures", () => {
  assert.equal(classifyAiFailure(402, ""), "AI_CREDITS_EXHAUSTED");
  assert.equal(classifyAiFailure(403, '{"error":{"code":"AccountOverdueError","message":"account has an overdue balance"}}'), "AI_CREDITS_EXHAUSTED");
  assert.equal(classifyAiFailure(429, '{"error":{"message":"You exceeded your current quota"}}'), "AI_CREDITS_EXHAUSTED");
  assert.equal(classifyAiFailure(429, '{"error":{"message":"Too many requests"}}'), "AI_RATE_LIMITED");
  assert.equal(classifyAiFailure(401, '{"error":{"message":"Invalid API key"}}'), "AI_KEY_REJECTED");
  assert.equal(classifyAiFailure(500, "upstream error"), "AI_UNAVAILABLE");
});

test("every code has a message that points somewhere useful", () => {
  for (const code of ["AI_CREDITS_EXHAUSTED", "AI_KEY_REJECTED", "AI_RATE_LIMITED", "AI_UNAVAILABLE"]) {
    assert.ok(AI_ERROR_MESSAGE[code].length > 20);
  }
  assert.match(AI_ERROR_MESSAGE.AI_CREDITS_EXHAUSTED, /\/mcp/);
});

test("the agent surfaces the code and does not leak the provider's response", async () => {
  const agent = createAgent({
    apiKey: "k", baseUrl: "http://model.test/v1", model: "m", tools: [], merchantName: "Test Shop",
    fetchImpl: async () => new Response('{"error":{"code":"AccountOverdueError","message":"secret-account-id-123 is overdue"}}', { status: 403 }),
  });
  await assert.rejects(agent([], "order something"), (error) => error.code === "AI_CREDITS_EXHAUSTED" && !error.message.includes("secret-account-id"));
});
