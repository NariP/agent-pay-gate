import { randomUUID } from "node:crypto";
import { findProduct } from "./catalog.js";
import { format, toCents } from "./money.js";

export class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Money that has left, or may still leave, the buyer's account counts toward the daily limit.
const COMMITTED = new Set(["AWAITING_APPROVAL", "PAID"]);

/**
 * The gate sits between an AI agent and the merchant's PayPal account.
 * The agent can build an order and ask for payment, but only a human approving
 * in PayPal can move money, and only for the exact amount that was quoted.
 */
export class Gate {
  constructor({ paypal, store, policy, baseUrl, merchantName, currency = "USD", reviewer = null, now = () => Date.now() }) {
    Object.assign(this, { paypal, store, policy, baseUrl, merchantName, currency, reviewer, now });
  }

  createQuote({ items, requestedBy = "agent", intent = "" }) {
    if (!Array.isArray(items) || items.length === 0) throw new GateError("EMPTY_ORDER", "An order needs at least one item.");

    const lines = items.map(({ sku, quantity }) => {
      const product = findProduct(sku);
      if (!product) throw new GateError("UNKNOWN_SKU", `No product with SKU ${sku}.`);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new GateError("BAD_QUANTITY", `Quantity for ${product.sku} must be a whole number from 1 to 20.`);
      }
      return { sku: product.sku, name: product.name, quantity, unitCents: product.priceCents, lineCents: product.priceCents * quantity };
    });
    const totalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);

    const { maxOrderCents, dailyLimitCents, quoteTtlMs } = this.policy;
    if (totalCents > maxOrderCents) {
      throw new GateError(
        "OVER_ORDER_LIMIT",
        `Total ${format(totalCents)} is over the per-order limit of ${format(maxOrderCents)} for agent-placed orders. No payment request was created.`,
      );
    }
    const committedToday = this.committedSince(this.now() - DAY_MS);
    if (committedToday + totalCents > dailyLimitCents) {
      throw new GateError(
        "OVER_DAILY_LIMIT",
        `This order would bring agent-placed spending to ${format(committedToday + totalCents)} in 24 hours, over the limit of ${format(dailyLimitCents)}. No payment request was created.`,
      );
    }

    const createdAt = this.now();
    const quote = {
      id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "QUOTED",
      currency: this.currency,
      items: lines,
      totalCents,
      requestedBy,
      intent: String(intent).slice(0, 300),
      createdAt,
      expiresAt: createdAt + quoteTtlMs,
      events: [{ at: createdAt, type: "QUOTED", detail: `${requestedBy} built an order for ${format(totalCents)}` }],
    };
    this.store.update((state) => {
      state.quotes[quote.id] = quote;
    });
    return quote;
  }

  async requestPayment(quoteId) {
    const quote = this.expireIfDue(this.mustGet(quoteId));
    if (quote.status === "EXPIRED") throw new GateError("QUOTE_EXPIRED", `Quote ${quoteId} expired. Create a new quote.`);
    if (quote.status === "AWAITING_APPROVAL") return quote;
    if (quote.status !== "QUOTED") throw new GateError("WRONG_STATE", `Quote ${quoteId} is ${quote.status}; payment cannot be requested again.`);

    await this.review(quote);

    const order = await this.paypal.createOrder({
      quote,
      merchantName: this.merchantName,
      returnUrl: `${this.baseUrl}/return?quote=${quote.id}`,
      cancelUrl: `${this.baseUrl}/cancel?quote=${quote.id}`,
    });
    if (!order.approveUrl) throw new GateError("NO_APPROVAL_LINK", "PayPal did not return an approval link.");

    return this.patch(quoteId, {
      status: "AWAITING_APPROVAL",
      paypalOrderId: order.id,
      paypalApproveUrl: order.approveUrl,
      reviewUrl: `${this.baseUrl}/pay/${quote.id}`,
    }, "PAYMENT_REQUESTED", `PayPal order ${order.id} created; waiting for a human to approve`);
  }

  /**
   * Looks at the PayPal order and captures it only if a human approved it and
   * every detail still matches the quote. Safe to call any number of times.
   */
  async settle(quoteId) {
    let quote = this.expireIfDue(this.mustGet(quoteId));
    if (quote.status !== "AWAITING_APPROVAL") return quote;

    const order = await this.paypal.getOrder(quote.paypalOrderId);
    if (order.status === "COMPLETED") return this.markPaid(quoteId, order);
    if (order.status !== "APPROVED") return quote;

    const problem = this.mismatch(quote, order);
    if (problem) {
      return this.patch(quoteId, { status: "BLOCKED", blockedReason: problem }, "BLOCKED", problem);
    }

    // Claim the capture before calling PayPal so two callers cannot both capture.
    const claimed = this.store.update((state) => {
      const current = state.quotes[quoteId];
      if (current.status !== "AWAITING_APPROVAL" || current.capturing) return false;
      current.capturing = true;
      return true;
    });
    if (!claimed) return this.mustGet(quoteId);

    try {
      const captured = await this.paypal.captureOrder(quote.paypalOrderId, quote.id);
      if (captured.status !== "COMPLETED") {
        return this.patch(quoteId, { capturing: false }, "CAPTURE_PENDING", `PayPal returned ${captured.status}`);
      }
      return this.markPaid(quoteId, captured);
    } catch (error) {
      this.patch(quoteId, { capturing: false }, "CAPTURE_FAILED", error.message);
      throw error;
    }
  }

  /**
   * Asks the AI reviewer whether the cart matches what the human asked for.
   * The result is advice for the human on the approval page. It never approves
   * or blocks a payment, and a reviewer failure never stops an order.
   */
  async review(quote) {
    if (!this.reviewer || quote.review) return;
    try {
      const review = await this.reviewer(quote);
      this.patch(quote.id, { review }, "REVIEWED", `AI order check: ${review.verdict}. ${review.reason}`);
    } catch (error) {
      this.patch(quote.id, {}, "REVIEW_SKIPPED", `AI order check skipped (${error.code ?? "AI_UNAVAILABLE"})`);
    }
  }

  get(quoteId) {
    return this.expireIfDue(this.mustGet(quoteId));
  }

  list() {
    return Object.values(this.store.read().quotes)
      .map((quote) => this.expireIfDue(quote))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  mismatch(quote, order) {
    if (order.customId !== quote.id) return `PayPal order belongs to ${order.customId ?? "an unknown quote"}, not ${quote.id}.`;
    if (order.amount?.currency_code !== quote.currency) return `Approved currency ${order.amount?.currency_code} differs from quoted ${quote.currency}.`;
    if (toCents(order.amount?.value) !== quote.totalCents) {
      return `Approved amount ${order.amount?.value} differs from the quoted ${format(quote.totalCents)}. Payment was not captured.`;
    }
    return null;
  }

  markPaid(quoteId, order) {
    return this.patch(quoteId, {
      status: "PAID",
      capturing: false,
      captureId: order.captureId,
      paidAt: this.now(),
    }, "PAID", `Captured by PayPal${order.captureId ? ` (${order.captureId})` : ""}`);
  }

  committedSince(since) {
    const now = this.now();
    // An unapproved request past its expiry can no longer be captured, so it stops counting
    // even if nobody has looked at it since.
    const live = (quote) => quote.status === "PAID" || now < quote.expiresAt;
    return Object.values(this.store.read().quotes)
      .filter((quote) => COMMITTED.has(quote.status) && quote.createdAt >= since && live(quote))
      .reduce((sum, quote) => sum + quote.totalCents, 0);
  }

  expireIfDue(quote) {
    const open = quote.status === "QUOTED" || (quote.status === "AWAITING_APPROVAL" && !quote.capturing);
    if (!open || this.now() < quote.expiresAt) return quote;
    return this.patch(quote.id, { status: "EXPIRED" }, "EXPIRED", "Not approved in time; the approval link no longer works here");
  }

  mustGet(quoteId) {
    const quote = this.store.read().quotes[quoteId];
    if (!quote) throw new GateError("UNKNOWN_QUOTE", `No quote with ID ${quoteId}.`);
    return quote;
  }

  patch(quoteId, fields, eventType, detail) {
    return this.store.update((state) => {
      const quote = state.quotes[quoteId];
      if (quote.status === "PAID" && fields.status && fields.status !== "PAID") return quote;
      const repeat = quote.status === fields.status && quote.events.at(-1)?.type === eventType;
      Object.assign(quote, fields);
      if (!repeat) quote.events.push({ at: this.now(), type: eventType, detail });
      return structuredClone(quote);
    });
  }
}
