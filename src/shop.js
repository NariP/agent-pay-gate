import { catalog, categories } from "./catalog.js";
import { format } from "./money.js";

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const card = (p) => `<button type="button" class="item" data-name="${esc(p.name)}" data-cats="${p.pick ? "picks " : ""}${esc(p.category)}">
      <span class="photo"><img src="/img/${esc(p.sku)}.jpg" alt="" loading="lazy" onerror="this.remove()">${p.badge ? `<i class="badge ${esc(p.badge.toLowerCase())}">${esc(p.badge)}</i>` : ""}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="price">${format(p.priceCents)}</span>
    </button>`;

/** The storefront: a kiosk-style menu on the left, a chat with the demo agent on the right. */
export const shopPage = ({ merchantName, policy, agentOn }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(merchantName)}</title>
<style>
  :root { --ink:#191f28; --muted:#6b7684; --line:#e5e8eb; --bg:#f2f4f6; --card:#fff; --go:#3182f6; --ok:#0f7a43; --stop:#d22030; --chip:#f2f4f6; }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color:var(--go); }
  main { display:grid; grid-template-columns:minmax(0, 11fr) minmax(0, 10fr); gap:20px; max-width:1220px; height:100%; margin:0 auto; padding:20px 24px; }
  .panel { display:flex; flex-direction:column; min-height:0; background:var(--card); border-radius:22px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.04); }

  .bar { display:flex; align-items:center; justify-content:space-between; padding:18px 22px 6px; }
  .bar .store { font-size:19px; font-weight:700; }
  .bar .reset { display:inline-flex; align-items:center; gap:6px; background:none; border:0; padding:6px 0; color:var(--ink); font:inherit; font-size:15px; font-weight:600; cursor:pointer; }
  .bar .reset svg { width:17px; height:17px; }
  .tabs { display:flex; gap:22px; padding:6px 22px 0; border-bottom:1px solid var(--line); overflow-x:auto; }
  .tabs button { position:relative; background:none; border:0; padding:10px 0 12px; color:var(--muted); font:inherit; font-size:16px; font-weight:600; cursor:pointer; white-space:nowrap; }
  .tabs button.on { color:var(--ink); font-weight:700; }
  .tabs button.on::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:var(--ink); }
  .menu { flex:1; overflow:auto; padding:18px 22px 20px; }
  .menu h2 { font-size:15px; font-weight:600; color:#4e5968; margin:0 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:20px 16px; }
  .item { display:block; align-self:start; text-align:left; background:none; border:0; padding:0; font:inherit; color:inherit; cursor:pointer; }
  .item.hide { display:none; }
  .photo { position:relative; display:block; aspect-ratio:1; border-radius:16px; overflow:hidden; background:#ece7df; }
  .photo img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .2s ease; }
  .item:hover .photo img { transform:scale(1.03); }
  .badge { position:absolute; top:8px; left:8px; padding:2px 8px; border-radius:7px; font-style:normal; font-size:12px; font-weight:700; color:#fff; background:var(--go); }
  .badge.new { background:#f04452; }
  .name { display:block; margin-top:9px; font-size:15px; font-weight:700; line-height:1.3; }
  .price { display:block; margin-top:2px; font-size:14px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .limits { margin:22px 0 0; padding-top:14px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }

  .chat .top { padding:18px 20px 14px; border-bottom:1px solid var(--line); }
  .chat .top b { display:block; font-size:17px; }
  .chat .top span { color:var(--muted); font-size:14px; }
  .chat .top a { float:right; font-size:14px; font-weight:600; text-decoration:none; }
  #log { flex:1; overflow:auto; padding:16px 20px; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:88%; padding:10px 14px; border-radius:16px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .user { align-self:flex-end; background:var(--go); color:#fff; border-bottom-right-radius:4px; }
  .reply { align-self:flex-start; background:var(--bg); border-bottom-left-radius:4px; }
  .tool { align-self:flex-start; font:13.5px/1.45 ui-monospace, Menlo, Consolas, monospace; background:var(--chip); border-radius:10px; padding:8px 12px; max-width:92%; color:#333d4b; }
  .tool .result { color:var(--ok); }
  .tool.bad .result { color:var(--stop); }
  .tool .dim { color:#8b95a1; }
  .approve { align-self:flex-start; width:min(420px, 92%); border:1px solid var(--line); border-radius:16px; padding:14px 16px; background:#fff; }
  .approve .total { font-size:20px; font-weight:700; }
  .approve .check { font-size:14px; margin-top:6px; }
  .approve .check.match { color:var(--ok); } .approve .check.mismatch { color:var(--stop); }
  .approve a.btn { display:block; margin-top:12px; padding:13px; border-radius:12px; background:var(--go); color:#fff; font-weight:700; text-align:center; text-decoration:none; }
  .approve .fine { color:var(--muted); font-size:13px; margin-top:8px; }
  .wait { align-self:flex-start; color:var(--muted); font-size:14px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; padding:0 20px 12px; }
  .chips button { border:1px solid var(--line); background:#fff; border-radius:999px; padding:6px 12px; font:inherit; font-size:14px; cursor:pointer; }
  form { display:flex; gap:10px; padding:12px 16px 16px; border-top:1px solid var(--line); }
  form input { flex:1; min-width:0; padding:13px 14px; border:1px solid var(--line); border-radius:12px; font:inherit; background:var(--bg); }
  form input:focus { outline:2px solid var(--go); background:#fff; }
  form button { padding:0 20px; border:0; border-radius:12px; background:var(--ink); color:#fff; font:inherit; font-weight:700; cursor:pointer; }
  form button:disabled, .chips button:disabled { opacity:.45; cursor:default; }
  @media (max-width: 860px) { main { grid-template-columns:1fr; height:auto; } .panel { height:auto; } .chat { height:72vh; } .grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
</style>
</head>
<body>
<main>
  <section class="panel">
    <div class="bar">
      <span class="store">${esc(merchantName)}</span>
      <button class="reset" id="reset" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>Start over</button>
    </div>
    <nav class="tabs" id="tabs">${categories.map((c, i) => `<button type="button" data-cat="${esc(c.id)}"${i === 0 ? ' class="on"' : ""}>${esc(c.label)}</button>`).join("")}</nav>
    <div class="menu">
      <h2 id="section">${esc(categories[0].label)}</h2>
      <div class="grid" id="grid">
    ${catalog.map(card).join("\n    ")}
      </div>
      <p class="limits">Orders placed by an AI agent are limited to ${format(policy.maxOrderCents)} each and ${format(policy.dailyLimitCents)} per 24 hours. An agent can build an order and ask for payment. Only you can approve it, in PayPal.</p>
    </div>
  </section>
  <section class="panel chat">
    <div class="top"><a href="/orders">Order history</a><b>Shopping agent</b><span>A demo AI agent. It has the same four tools any agent gets from this store over MCP, and it cannot pay.</span></div>
    <div id="log"></div>
    <div class="chips" id="chips">
      <button type="button">Order two bags of the Ethiopian coffee</button>
      <button type="button">I approved the payment</button>
      <button type="button">Also order the hand grinder</button>
    </div>
    <form id="form"><input id="input" autocomplete="off" maxlength="400" placeholder="${agentOn ? "Ask the agent to order something" : "The demo agent is not configured on this server"}" ${agentOn ? "" : "disabled"}><button ${agentOn ? "" : "disabled"}>Send</button></form>
  </section>
</main>
<script>
const KEY = "apg-chat-v1";
const log = document.getElementById("log"), form = document.getElementById("form"), input = document.getElementById("input");
let state = { history: [], view: [] };
try { state = JSON.parse(sessionStorage.getItem(KEY)) || state; } catch {}
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));

const el = (cls, html) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function describe(ev) {
  const d = ev.data || {};
  if (!ev.ok) return d.message || d.error || "refused";
  if (ev.name === "list_products") return (d.products || []).length + " products. Agent limit " + (d.agent_order_limits || {}).per_order + " per order";
  if (ev.name === "create_quote") return "quote " + d.quote_id + ", total " + d.total + " (locked)";
  if (ev.name === "request_payment") return "approval link for the human" + (d.order_check ? ". AI check: " + d.order_check.verdict : "");
  if (ev.name === "check_payment") return "status " + d.status;
  return "ok";
}
const callText = (ev) => {
  const i = ev.input || {};
  if (ev.name === "create_quote") return "create_quote  " + (i.items || []).map((x) => x.quantity + " x " + x.sku).join(", ");
  if (i.quote_id) return ev.name + "  " + i.quote_id;
  return ev.name;
};

function render(ev) {
  if (ev.type === "user") return el("msg user", esc(ev.text));
  if (ev.type === "reply") return el("msg reply", esc(ev.text));
  if (ev.type === "tool_call") { const node = el("tool", "<div>" + esc(callText(ev)) + "</div>"); node.dataset.pending = "1"; return node; }
  if (ev.type === "tool_result") {
    const node = [...log.querySelectorAll('.tool[data-pending="1"]')].pop();
    if (node) { delete node.dataset.pending; if (!ev.ok) node.classList.add("bad"); node.innerHTML += '<div class="result"><span class="dim">returns </span>' + esc(describe(ev)) + "</div>"; }
    if (ev.ok && ev.name === "request_payment" && ev.data.approval_url) {
      const c = ev.data.order_check;
      el("approve", '<div>' + ev.data.items.map((x) => esc(x.quantity + " x " + x.name)).join("<br>") + '</div><div class="total">' + esc(ev.data.total) + "</div>" +
        (c ? '<div class="check ' + esc(c.verdict) + '">AI check: ' + esc(c.verdict) + ". " + esc(c.reason) + "</div>" : "") +
        '<a class="btn" href="' + esc(ev.data.approval_url) + '">Review and approve</a><div class="fine">The agent stops here. Nothing is charged until you approve in PayPal.</div>');
    }
  }
}
state.view.forEach(render);
if (!state.view.length) el("msg reply", "Hi. Tell me what to order and I will set it up. You approve the payment yourself in PayPal.");

let busy = false;
const setBusy = (on) => { busy = on; document.querySelectorAll("form button, #chips button").forEach((b) => (b.disabled = on)); };
const record = (ev) => { state.view.push(ev); render(ev); save(); };

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  setBusy(true);
  record({ type: "user", text });
  const wait = el("wait", "The agent is working…");
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history: state.history, message: text }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || "The agent is unavailable right now."); }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\\n")) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "history") { state.history = ev.messages; save(); }
        else if (ev.type === "error") record({ type: "reply", text: ev.message });
        else record(ev);
        log.appendChild(wait); log.scrollTop = log.scrollHeight;
      }
    }
  } catch (error) { record({ type: "reply", text: error.message }); }
  wait.remove(); setBusy(false); input.focus();
}

form.addEventListener("submit", (e) => { e.preventDefault(); const text = input.value; input.value = ""; send(text); });
document.getElementById("chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") send(e.target.textContent); });
document.getElementById("reset").addEventListener("click", () => { sessionStorage.removeItem(KEY); location.reload(); });

// Menu: tabs filter the grid, and tapping a product drafts an order for the agent.
const grid = document.getElementById("grid"), tabs = document.getElementById("tabs");
const showCategory = (id, label) => {
  tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.cat === id));
  grid.querySelectorAll(".item").forEach((item) => item.classList.toggle("hide", !item.dataset.cats.split(" ").includes(id)));
  document.getElementById("section").textContent = label;
};
tabs.addEventListener("click", (e) => { if (e.target.dataset.cat) showCategory(e.target.dataset.cat, e.target.textContent); });
grid.addEventListener("click", (e) => { const item = e.target.closest(".item"); if (item && !input.disabled) { input.value = "Order one " + item.dataset.name; input.focus(); } });
showCategory(tabs.querySelector(".on").dataset.cat, tabs.querySelector(".on").textContent);
</script>
</body>
</html>`;
