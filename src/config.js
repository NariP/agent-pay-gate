import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

// Hosts such as Render pass the port to listen on as PORT and the public address as RENDER_EXTERNAL_URL.
const port = num("GATE_PORT", num("PORT", 8787));
const list = (name) => (process.env[name] ?? "").split(",").map((item) => item.trim().replace(/\/$/, "")).filter(Boolean);
const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";

export const config = {
  port,
  baseUrl: (process.env.GATE_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  // Minutes between pings to our own public address, which keeps a free host from sleeping. 0 turns it off.
  keepAwakeMinutes: num("KEEP_AWAKE_MIN", process.env.RENDER_EXTERNAL_URL ? 10 : 0),
  // Browser origins allowed to call the MCP endpoint. The gate's own origin is always allowed.
  mcpAllowedOrigins: list("MCP_ALLOWED_ORIGINS"),
  storeFile: process.env.GATE_STORE_FILE ?? join(ROOT, "local", "data", "store.json"),
  merchantName: process.env.MERCHANT_NAME ?? "Slow Morning Coffee",
  currency: "USD",
  paypal: {
    clientId,
    clientSecret,
    apiBase: process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com",
    // Language of the PayPal approval screen, as a BCP 47 tag such as en-US. Empty lets PayPal decide.
    locale: process.env.PAYPAL_LOCALE ?? "en-US",
    // Without credentials the gate runs against a local PayPal stand-in so the flow can be tried offline.
    mock: process.env.PAYPAL_MOCK === "1" || !clientId || !clientSecret,
  },
  // Told to agents and shoppers so nobody has to guess whether real money is involved.
  get paymentEnvironment() {
    if (this.paypal.mock) return "mock: a built-in stand-in for PayPal, no payment provider is contacted";
    if (/sandbox/.test(this.paypal.apiBase)) return "PayPal sandbox: test accounts and test money only, no real charge";
    return "PayPal live: approved payments move real money";
  },
  // The demo shopping agent on the storefront. It shares the endpoint and key with the order check.
  agent: {
    model: process.env.AI_AGENT_MODEL ?? "deepseek-v4-1-flash-261017",
    turnsPerTenMinutes: num("AGENT_TURNS_PER_10_MIN", 20),
    turnsPerDay: num("AGENT_TURNS_PER_DAY", 600),
  },
  review: {
    apiKey: process.env.AI_REVIEW_API_KEY ?? "",
    baseUrl: process.env.AI_REVIEW_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3",
    model: process.env.AI_REVIEW_MODEL ?? "deepseek-v4-1-flash-261017",
  },
  policy: {
    maxOrderCents: Math.round(num("MAX_ORDER_USD", 20) * 100),
    dailyLimitCents: Math.round(num("DAILY_LIMIT_USD", 60) * 100),
    quoteTtlMs: num("QUOTE_TTL_MIN", 15) * 60_000,
  },
};
