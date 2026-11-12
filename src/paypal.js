import { randomUUID } from "node:crypto";
import { toValue } from "./money.js";

const approveLink = (order) =>
  order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;

const orderBody = ({ quote, merchantName, returnUrl, cancelUrl, locale }) => ({
  intent: "CAPTURE",
  purchase_units: [
    {
      reference_id: quote.id,
      custom_id: quote.id,
      description: `${merchantName} order placed by an AI agent`,
      amount: {
        currency_code: quote.currency,
        value: toValue(quote.totalCents),
        breakdown: { item_total: { currency_code: quote.currency, value: toValue(quote.totalCents) } },
      },
      items: quote.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: String(item.quantity),
        unit_amount: { currency_code: quote.currency, value: toValue(item.unitCents) },
      })),
    },
  ],
  payment_source: {
    paypal: {
      experience_context: {
        brand_name: merchantName,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        ...(locale ? { locale } : {}),
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    },
  },
});

export class PayPalClient {
  constructor({ clientId, clientSecret, apiBase, locale, fetchImpl = fetch }) {
    this.locale = locale;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.apiBase = apiBase;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const response = await this.fetch(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new Error(`PayPal sign-in failed (${response.status}). Check the sandbox client ID and secret.`);
    const data = await response.json();
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  async call(method, path, { body, requestId } = {}) {
    const response = await this.fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        // Same ID on a retry makes PayPal return the first result instead of acting twice.
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const issue = data.details?.[0]?.issue ?? data.name ?? "UNKNOWN";
      const error = new Error(`PayPal ${method} ${path} failed: ${issue} (${response.status})`);
      error.issue = issue;
      error.debugId = data.debug_id;
      throw error;
    }
    return data;
  }

  async createOrder(input) {
    const order = await this.call("POST", "/v2/checkout/orders", {
      body: orderBody({ ...input, locale: this.locale }),
      requestId: `create-${input.quote.id}`,
    });
    return { id: order.id, approveUrl: approveLink(order) };
  }

  async getOrder(orderId) {
    return normalize(await this.call("GET", `/v2/checkout/orders/${orderId}`));
  }

  async captureOrder(orderId, quoteId) {
    const order = await this.call("POST", `/v2/checkout/orders/${orderId}/capture`, {
      requestId: `capture-${quoteId}`,
    });
    return normalize(order);
  }
}

const normalize = (order) => {
  const unit = order.purchase_units?.[0] ?? {};
  const capture = unit.payments?.captures?.[0];
  return {
    id: order.id,
    status: order.status,
    customId: unit.custom_id ?? capture?.custom_id,
    amount: unit.amount ?? capture?.amount,
    captureId: capture?.id,
    captureStatus: capture?.status,
    payerEmail: order.payer?.email_address,
  };
};

// Local stand-in with the same interface, used when no sandbox credentials are configured.
export class MockPayPal {
  constructor({ store, baseUrl }) {
    this.store = store;
    this.baseUrl = baseUrl;
  }

  async createOrder({ quote }) {
    const id = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.store.update((state) => {
      state.mockOrders[id] = {
        id,
        status: "PAYER_ACTION_REQUIRED",
        customId: quote.id,
        amount: { currency_code: quote.currency, value: toValue(quote.totalCents) },
      };
    });
    return { id, approveUrl: `${this.baseUrl}/mock-paypal/${id}` };
  }

  async getOrder(orderId) {
    const order = this.store.read().mockOrders[orderId];
    if (!order) throw new Error(`Mock PayPal order ${orderId} not found`);
    return order;
  }

  async captureOrder(orderId) {
    return this.store.update((state) => {
      const order = state.mockOrders[orderId];
      if (!order) throw new Error(`Mock PayPal order ${orderId} not found`);
      if (order.status === "APPROVED") {
        order.status = "COMPLETED";
        order.captureId = `MOCKCAP-${randomUUID().slice(0, 8).toUpperCase()}`;
        order.captureStatus = "COMPLETED";
        order.captureCount = (order.captureCount ?? 0) + 1;
      }
      return order;
    });
  }

  approve(orderId) {
    this.store.update((state) => {
      const order = state.mockOrders[orderId];
      if (order?.status === "PAYER_ACTION_REQUIRED") order.status = "APPROVED";
    });
  }
}
