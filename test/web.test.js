import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Gate } from "../src/gate.js";
import { createMcpServer } from "../src/mcp.js";
import { MockPayPal } from "../src/paypal.js";
import { MemoryStore } from "../src/store.js";
import { createWebServer } from "../src/web.js";

const config = {
  baseUrl: "https://shop.test",
  merchantName: "Test Shop",
  mcpAllowedOrigins: ["https://agent.test"],
  paypal: { mock: true },
  policy: { maxOrderCents: 2000, dailyLimitCents: 6000, quoteTtlMs: 900_000 },
  paymentEnvironment: "mock",
};
const store = new MemoryStore();
const mockPayPal = new MockPayPal({ store, baseUrl: config.baseUrl });
const gate = new Gate({ paypal: mockPayPal, store, policy: config.policy, baseUrl: config.baseUrl, merchantName: config.merchantName });
const web = createWebServer({ gate, config, mockPayPal, newMcpServer: () => createMcpServer({ gate, config }) });
let url;

before(() => new Promise((resolve) => web.listen(0, () => ((url = `http://127.0.0.1:${web.address().port}/mcp`), resolve()))));
after(() => web.close());

const listTools = (headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

test("a call with no Origin header, as agents and servers send, is served", async () => {
  const response = await listTools();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /create_quote/);
});

test("a browser page from an unlisted origin is refused", async () => {
  const response = await listTools({ Origin: "https://evil.test" });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("a listed origin and the gate's own origin are allowed and echoed back", async () => {
  for (const origin of ["https://agent.test", "https://shop.test"]) {
    const response = await listTools({ Origin: origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    await response.text();
  }
});

test("preflight succeeds only for allowed origins", async () => {
  const preflight = (origin) => fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
  const allowed = await preflight("https://agent.test");
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://agent.test");
  assert.equal((await preflight("https://evil.test")).status, 403);
});
