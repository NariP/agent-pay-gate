import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewer, parseVerdict } from "../src/review.js";

const quote = {
  intent: "two bags of the Ethiopian",
  items: [{ name: "Ethiopia Yirgacheffe, 200g", quantity: 20, lineCents: 28000 }],
  totalCents: 28000,
};

test("no reviewer is built without a key", () => {
  assert.equal(createReviewer({ apiKey: "", baseUrl: "http://x", model: "m" }), null);
});

test("the reviewer sends request and cart, and returns the model's verdict", async () => {
  let sent;
  const reviewer = createReviewer({
    apiKey: "k",
    baseUrl: "http://model.test/v1/",
    model: "m",
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Sure: {"verdict":"mismatch","reason":"Asked for 2, cart has 20."}' } }] }));
    },
  });

  const result = await reviewer(quote);
  assert.equal(sent.url, "http://model.test/v1/chat/completions");
  assert.match(sent.body.messages[1].content, /two bags of the Ethiopian[\s\S]*quantity 20: Ethiopia Yirgacheffe/);
  assert.deepEqual(result, { verdict: "mismatch", reason: "Asked for 2, cart has 20.", model: "m" });
});

test("an order without the original request is reported as unclear without calling the model", async () => {
  const reviewer = createReviewer({ apiKey: "k", baseUrl: "http://x", model: "m", fetchImpl: async () => assert.fail("should not call") });
  assert.equal((await reviewer({ ...quote, intent: "" })).verdict, "unclear");
});

test("verdicts outside the allowed set are rejected", () => {
  assert.throws(() => parseVerdict('{"verdict":"approve","reason":"x"}'), /Unexpected review verdict/);
  assert.throws(() => parseVerdict("no json here"), /did not return JSON/);
});
