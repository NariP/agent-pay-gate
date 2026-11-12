import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GateError } from "./gate.js";
import { format } from "./money.js";
import { shopPage } from "./shop.js";
import { ROOT } from "./config.js";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const STATUS_LABEL = {
  QUOTED: "Quoted",
  AWAITING_APPROVAL: "Waiting for your approval",
  PAID: "Paid",
  EXPIRED: "Expired",
  BLOCKED: "Blocked",
};

// Times are shown in UTC and labelled, since the server and the buyer are rarely in the same zone.
const time = (ms) => `${new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

const page = (title, body, { refresh } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}
<title>${esc(title)}</title>
<style>
  :root { --ink:#16181d; --muted:#6a707c; --line:#e3e5ea; --bg:#f5f4f0; --card:#fff; --go:#0a53d6; --ok:#0f7a43; --stop:#b3261e; --wait:#9a6400; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; padding:28px 18px 60px; }
  h1 { font-size:24px; line-height:1.25; margin:0 0 6px; }
  h2 { font-size:15px; margin:26px 0 8px; color:var(--muted); font-weight:600; }
  p { margin:0 0 12px; }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-top:16px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:9px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  td:last-child { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  tr.total td { border-bottom:0; font-size:20px; font-weight:700; padding-top:14px; }
  .btn { display:block; width:100%; margin-top:18px; padding:15px; border:0; border-radius:12px; background:var(--go); color:#fff; font-size:17px; font-weight:600; text-align:center; text-decoration:none; cursor:pointer; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:13px; font-weight:600; background:#eef0f4; }
  .pill.PAID { background:#e2f4ea; color:var(--ok); }
  .pill.AWAITING_APPROVAL, .pill.QUOTED { background:#fdf1d8; color:var(--wait); }
  .pill.BLOCKED, .pill.EXPIRED { background:#fbe6e4; color:var(--stop); }
  .quote { font-style:italic; }
  .check { margin-top:14px; padding:12px 14px; border-radius:10px; font-size:15px; }
  .check b { display:block; margin-bottom:2px; }
  .check.match { background:#e2f4ea; color:#0b5c33; }
  .check.mismatch { background:#fbe6e4; color:#8c1d18; border:1px solid #f0b8b3; }
  .check.unclear { background:#fdf1d8; color:#6e4800; }
  ul.log { list-style:none; margin:0; padding:0; font-size:14px; }
  ul.log li { padding:6px 0; border-bottom:1px solid var(--line); }
  ul.log li:last-child { border-bottom:0; }
  a { color:var(--go); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

const itemRows = (quote) =>
  quote.items
    .map((item) => `<tr><td>${esc(item.name)}<div class="muted">${item.quantity} × ${format(item.unitCents)}</div></td><td>${format(item.lineCents)}</td></tr>`)
    .join("") + `<tr class="total"><td>Total</td><td>${format(quote.totalCents)}</td></tr>`;

const eventLog = (quote) =>
  `<ul class="log">${quote.events.map((event) => `<li><span class="muted">${time(event.at)}</span><br>${esc(event.detail)}</li>`).join("")}</ul>`;

const pill = (quote) => `<span class="pill ${quote.status}">${STATUS_LABEL[quote.status] ?? quote.status}</span>`;

const CHECK_TITLE = {
  match: "AI check: the order matches your request",
  mismatch: "AI check: this does not look like what you asked for",
  unclear: "AI check: could not tell if this matches your request",
};

const checkBox = (quote) =>
  quote.review ? `<div class="check ${quote.review.verdict}"><b>${CHECK_TITLE[quote.review.verdict]}</b>${esc(quote.review.reason)}</div>` : "";

const reviewPage = (quote, { merchantName, policy, mock }) => {
  const intent = quote.intent ? `<h2>What the agent says you asked for</h2><p class="quote">“${esc(quote.intent)}”</p>` : "";
  const action =
    quote.status === "AWAITING_APPROVAL"
      ? `<a class="btn" href="${esc(quote.paypalApproveUrl)}">Review and pay with PayPal${mock ? " (mock)" : ""}</a>
         <p class="muted" style="margin-top:10px">Nothing is charged until you approve in PayPal. This request expires ${time(quote.expiresAt)}.</p>`
      : `<p style="margin-top:16px">${pill(quote)}</p>${quote.blockedReason ? `<p>${esc(quote.blockedReason)}</p>` : ""}`;
  return page(
    `Approve order ${quote.id}`,
    `<p class="muted">${esc(merchantName)} · order ${esc(quote.id)}</p>
     <h1>An AI agent wants to place this order for you</h1>
     <p class="muted">The agent cannot pay. Check the items and the total, then approve only if this is what you wanted.</p>
     <div class="card"><table>${itemRows(quote)}</table>${intent}${checkBox(quote)}${action}</div>
     <h2>Limits set by the merchant for agent orders</h2>
     <p class="muted">Up to ${format(policy.maxOrderCents)} per order and ${format(policy.dailyLimitCents)} per 24 hours. The amount is locked: if it changes after this page, the payment is refused.</p>
     <h2>History</h2><div class="card">${eventLog(quote)}</div>`,
    { refresh: quote.status === "AWAITING_APPROVAL" ? 20 : undefined },
  );
};

const resultPage = (quote, merchantName) => {
  const headline = {
    PAID: "Payment approved and captured",
    BLOCKED: "Payment refused by the gate",
    EXPIRED: "This request expired",
    AWAITING_APPROVAL: "Not approved yet",
  }[quote.status] ?? "Order status";
  const next = quote.status === "PAID" ? "You can go back to your agent. It will see the order as paid." : esc(quote.blockedReason ?? "Nothing was charged.");
  return page(
    headline,
    `<p class="muted">${esc(merchantName)} · order ${esc(quote.id)}</p>
     <h1>${headline}</h1><p>${next} <a href="/">Back to the store</a></p>
     <div class="card"><p>${pill(quote)}</p><table>${itemRows(quote)}</table></div>
     <h2>History</h2><div class="card">${eventLog(quote)}</div>`,
  );
};

const dashboard = (quotes, merchantName) =>
  page(
    `${merchantName} agent orders`,
    `<h1>Agent-placed orders</h1>
     <p class="muted">${esc(merchantName)} · every order an agent built, and what happened to it. <a href="/">Back to the store</a></p>
     ${quotes.length === 0 ? `<div class="card"><p class="muted">No orders yet.</p></div>` : ""}
     ${quotes
       .map(
         (quote) => `<div class="card">
           <p>${pill(quote)} <a href="/pay/${esc(quote.id)}">${esc(quote.id)}</a> <span class="muted">· ${time(quote.createdAt)}</span></p>
           <table>${itemRows(quote)}</table></div>`,
       )
       .join("")}`,
    { refresh: 10 },
  );

const mockPayPalPage = (order, quote) =>
  page(
    "Mock PayPal",
    `<p class="muted">Mock PayPal · stands in for the PayPal approval screen when no sandbox keys are set</p>
     <h1>Pay ${esc(order.amount.currency_code)} ${esc(order.amount.value)}</h1>
     <div class="card"><table>${itemRows(quote)}</table>
       <form method="post" action="/mock-paypal/${esc(order.id)}"><button class="btn">Approve payment</button></form>
       <a class="muted" href="/cancel?quote=${esc(quote.id)}" style="display:block;text-align:center;margin-top:12px">Cancel</a>
     </div>`,
  );

const readJson = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
};

const ROLES = new Set(["user", "assistant", "tool"]);

export function createWebServer({ gate, config, mockPayPal, newMcpServer, agent }) {
  // Keeps the demo agent from being used as a free chatbot: a cap per visitor and one for the whole day.
  const turns = { byVisitor: new Map(), day: { start: Date.now(), count: 0 } };
  const allowTurn = (visitor) => {
    const now = Date.now(), limits = config.agent ?? { turnsPerTenMinutes: 20, turnsPerDay: 600 };
    if (now - turns.day.start > 86_400_000) turns.day = { start: now, count: 0 };
    const recent = (turns.byVisitor.get(visitor) ?? []).filter((at) => now - at < 600_000);
    if (recent.length >= limits.turnsPerTenMinutes || turns.day.count >= limits.turnsPerDay) return false;
    recent.push(now);
    turns.byVisitor.set(visitor, recent);
    turns.day.count += 1;
    if (turns.byVisitor.size > 5000) turns.byVisitor.clear();
    return true;
  };

  const handleChat = async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message }));
    };
    if (req.method !== "POST") return fail(405, "Use POST.");
    if (!agent) return fail(503, "The demo agent is not configured on this server. Connect your own agent to /mcp instead.");
    const visitor = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    if (!allowTurn(visitor)) return fail(429, "The demo agent has had a lot of requests. Please try again in a few minutes.");

    const body = (await readJson(req)) ?? {};
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 400) : "";
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return fail(400, "Say what you would like to order.");
    if (history.length > 60 || !history.every((m) => m && ROLES.has(m.role))) return fail(400, "This chat is too long. Start a new chat.");

    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
    try {
      emit({ type: "history", messages: await agent(history, message, emit) });
    } catch (error) {
      emit({ type: "error", message: "The agent could not answer just now. Please try again." });
    }
    res.end();
  };

  // Remote MCP endpoint. Stateless: each request gets its own server and transport.
  const allowedOrigins = new Set([new URL(config.baseUrl).origin, ...(config.mcpAllowedOrigins ?? [])]);
  const jsonError = (res, status, message, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
  };

  const handleMcp = async (req, res) => {
    // Browsers always send Origin on cross-site calls. Only listed origins may use the endpoint,
    // so a web page the user happens to visit cannot drive the gate. Agents and servers that
    // send no Origin header are not browsers and are not affected by this check.
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) return jsonError(res, 403, "Origin not allowed");
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }
    if (req.method !== "POST") {
      return jsonError(res, 405, "Method not allowed", { Allow: "POST, OPTIONS" });
    }
    const server = newMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  };

  const send = (res, status, html) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, config.baseUrl);
    const [, first, second] = url.pathname.split("/");

    if (url.pathname === "/mcp" && newMcpServer) return handleMcp(req, res);
    if (url.pathname === "/healthz") return send(res, 200, "ok");

    if (url.pathname === "/api/chat") return handleChat(req, res);
    if (first === "img" && /^[A-Z0-9-]+\.jpg$/.test(second ?? "")) {
      const image = await readFile(join(ROOT, "assets", "products", second)).catch(() => null);
      if (!image) return send(res, 404, page("Not found", "<h1>Not found</h1>"));
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
      return res.end(image);
    }
    if (url.pathname === "/") return send(res, 200, shopPage({ merchantName: config.merchantName, policy: config.policy, agentOn: Boolean(agent) }));
    if (url.pathname === "/orders") return send(res, 200, dashboard(gate.list(), config.merchantName));

    if (first === "pay" && second) {
      return send(res, 200, reviewPage(gate.get(second), { merchantName: config.merchantName, policy: config.policy, mock: config.paypal.mock }));
    }

    if (first === "return") {
      // PayPal sends the buyer here after approval. Capture happens on the server, never in the agent.
      return send(res, 200, resultPage(await gate.settle(url.searchParams.get("quote")), config.merchantName));
    }

    if (first === "cancel") {
      const quote = gate.get(url.searchParams.get("quote"));
      return send(res, 200, page("Cancelled", `<h1>You did not approve this order</h1><p>Nothing was charged. Order ${esc(quote.id)} stays unpaid until it expires.</p><p><a href="/pay/${esc(quote.id)}">Back to the order</a></p>`));
    }

    if (first === "mock-paypal" && second && mockPayPal) {
      const order = await mockPayPal.getOrder(second);
      if (req.method === "POST") {
        mockPayPal.approve(second);
        res.writeHead(303, { Location: `/return?quote=${order.customId}` });
        return res.end();
      }
      return send(res, 200, mockPayPalPage(order, gate.get(order.customId)));
    }

    send(res, 404, page("Not found", "<h1>Not found</h1>"));
  };

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof GateError ? 404 : 500;
      send(res, status, page("Something went wrong", `<h1>Something went wrong</h1><p>${esc(error.message)}</p>`));
    });
  });
}
