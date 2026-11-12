#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createAgent } from "./agent.js";
import { Gate } from "./gate.js";
import { createMcpServer } from "./mcp.js";
import { MockPayPal, PayPalClient } from "./paypal.js";
import { createReviewer } from "./review.js";
import { FileStore } from "./store.js";
import { createTools } from "./tools.js";
import { createWebServer } from "./web.js";

// In stdio mode stdout carries the MCP protocol, so all logging goes to stderr.
const log = (...parts) => console.error("[agent-pay-gate]", ...parts);

const store = new FileStore(config.storeFile);
const mockPayPal = config.paypal.mock ? new MockPayPal({ store, baseUrl: config.baseUrl }) : null;
const paypal = mockPayPal ?? new PayPalClient(config.paypal);
const gate = new Gate({
  paypal,
  store,
  policy: config.policy,
  baseUrl: config.baseUrl,
  merchantName: config.merchantName,
  currency: config.currency,
  reviewer: createReviewer(config.review),
});

const newMcpServer = () => createMcpServer({ gate, config, log });
const agent = createAgent({
  apiKey: config.review.apiKey,
  baseUrl: config.review.baseUrl,
  model: config.agent.model,
  tools: createTools({ gate, config, log }),
  merchantName: config.merchantName,
});
const web = createWebServer({ gate, config, mockPayPal, newMcpServer, agent });
web.on("error", (error) => {
  // Another instance already serves the approval pages from the same store; that is fine.
  if (error.code === "EADDRINUSE") log(`port ${config.port} already in use; reusing the running approval pages`);
  else log("web server error:", error.message);
});
web.listen(config.port, () =>
  log(`approval pages at ${config.baseUrl} (${config.paypal.mock ? "mock PayPal" : "PayPal sandbox"}, AI order check ${config.review.apiKey ? "on" : "off"})`),
);

// Two ways to connect an agent:
//   stdio (default)  the MCP client starts this process itself
//   --http           a long-running server; agents connect to <base URL>/mcp
if (process.argv.includes("--http")) {
  log(`MCP endpoint at ${config.baseUrl}/mcp`);
} else {
  await newMcpServer().connect(new StdioServerTransport());
  log("MCP server ready on stdio");
}
