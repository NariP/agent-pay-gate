import assert from "node:assert/strict";
import { test } from "node:test";
import { Gate, GateError } from "../src/gate.js";
import { MockPayPal } from "../src/paypal.js";
import { MemoryStore } from "../src/store.js";

const setup = (policy = {}) => {
  const clock = { now: 1_800_000_000_000 };
  const store = new MemoryStore();
  const paypal = new MockPayPal({ store, baseUrl: "http://test" });
  const gate = new Gate({
    paypal,
    store,
    baseUrl: "http://test",
    merchantName: "Test Shop",
    policy: { maxOrderCents: 2000, dailyLimitCents: 6000, quoteTtlMs: 15 * 60_000, ...policy },
    now: () => clock.now,
  });
  return { clock, store, paypal, gate };
};

const twoBags = [{ sku: "ETH-200", quantity: 2 }];
const captures = (store, orderId) => store.read().mockOrders[orderId].captureCount ?? 0;

test("an approved order is captured once and becomes PAID", async () => {
  const { gate, paypal, store } = setup();
  const quote = gate.createQuote({ items: twoBags, intent: "two bags of the Ethiopian" });
  assert.equal(quote.totalCents, 900);

  const requested = await gate.requestPayment(quote.id);
  assert.equal(requested.status, "AWAITING_APPROVAL");
  assert.equal(requested.reviewUrl, `http://test/pay/${quote.id}`);

  paypal.approve(requested.paypalOrderId);
  const paid = await gate.settle(quote.id);
  assert.equal(paid.status, "PAID");
  assert.ok(paid.captureId);
  assert.equal(captures(store, requested.paypalOrderId), 1);
});

test("nothing is captured until a human approves", async () => {
  const { gate, store } = setup();
  const quote = gate.createQuote({ items: twoBags });
  const requested = await gate.requestPayment(quote.id);

  assert.equal((await gate.settle(quote.id)).status, "AWAITING_APPROVAL");
  assert.equal(captures(store, requested.paypalOrderId), 0);
});

test("settling again, even at the same time, never captures twice", async () => {
  const { gate, paypal, store } = setup();
  const quote = gate.createQuote({ items: twoBags });
  const requested = await gate.requestPayment(quote.id);
  paypal.approve(requested.paypalOrderId);

  await Promise.all([gate.settle(quote.id), gate.settle(quote.id), gate.settle(quote.id)]);
  await gate.settle(quote.id);

  assert.equal(gate.get(quote.id).status, "PAID");
  assert.equal(captures(store, requested.paypalOrderId), 1);
});

test("an order over the per-order limit is refused before PayPal is involved", () => {
  const { gate, store } = setup();
  assert.throws(
    () => gate.createQuote({ items: [{ sku: "GRD-001", quantity: 1 }] }),
    (error) => error instanceof GateError && error.code === "OVER_ORDER_LIMIT",
  );
  assert.deepEqual(store.read().quotes, {});
  assert.deepEqual(store.read().mockOrders, {});
});

test("the daily limit counts orders that are paid or still waiting", async () => {
  const { gate } = setup({ dailyLimitCents: 2000 });
  const first = gate.createQuote({ items: twoBags });
  await gate.requestPayment(first.id);
  const second = gate.createQuote({ items: twoBags });
  await gate.requestPayment(second.id);

  assert.throws(
    () => gate.createQuote({ items: twoBags }),
    (error) => error.code === "OVER_DAILY_LIMIT",
  );
});

test("an approved amount that differs from the quote is blocked, not captured", async () => {
  const { gate, paypal, store } = setup();
  const quote = gate.createQuote({ items: twoBags });
  const requested = await gate.requestPayment(quote.id);
  store.update((state) => {
    state.mockOrders[requested.paypalOrderId].amount.value = "90.00";
  });
  paypal.approve(requested.paypalOrderId);

  const blocked = await gate.settle(quote.id);
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.blockedReason, /differs from the quoted \$9\.00/);
  assert.equal(captures(store, requested.paypalOrderId), 0);
});

test("a PayPal order made for another quote cannot settle this one", async () => {
  const { gate, paypal, store } = setup();
  const quote = gate.createQuote({ items: twoBags });
  const requested = await gate.requestPayment(quote.id);
  store.update((state) => {
    state.mockOrders[requested.paypalOrderId].customId = "Q-OTHER";
  });
  paypal.approve(requested.paypalOrderId);

  assert.equal((await gate.settle(quote.id)).status, "BLOCKED");
  assert.equal(captures(store, requested.paypalOrderId), 0);
});

test("an approval that arrives after the quote expired is not captured", async () => {
  const { gate, paypal, store, clock } = setup();
  const quote = gate.createQuote({ items: twoBags });
  const requested = await gate.requestPayment(quote.id);
  clock.now += 16 * 60_000;
  paypal.approve(requested.paypalOrderId);

  assert.equal((await gate.settle(quote.id)).status, "EXPIRED");
  assert.equal(captures(store, requested.paypalOrderId), 0);
  await assert.rejects(gate.requestPayment(quote.id), (error) => error.code === "QUOTE_EXPIRED");
});

test("unknown products and bad quantities are refused", () => {
  const { gate } = setup();
  assert.throws(() => gate.createQuote({ items: [{ sku: "NOPE", quantity: 1 }] }), (error) => error.code === "UNKNOWN_SKU");
  assert.throws(() => gate.createQuote({ items: [{ sku: "ETH-200", quantity: 0 }] }), (error) => error.code === "BAD_QUANTITY");
  assert.throws(() => gate.createQuote({ items: [] }), (error) => error.code === "EMPTY_ORDER");
});

const withReviewer = (reviewer) => {
  const env = setup();
  env.gate.reviewer = reviewer;
  return env;
};

test("the AI order check is stored as advice and does not stop the payment request", async () => {
  const { gate } = withReviewer(async () => ({ verdict: "mismatch", reason: "Asked for 2 bags, cart has 20.", model: "fake" }));
  const quote = gate.createQuote({ items: [{ sku: "FLT-100", quantity: 5 }], intent: "two packs of filters" });

  const requested = await gate.requestPayment(quote.id);
  assert.equal(requested.status, "AWAITING_APPROVAL");
  assert.equal(requested.review.verdict, "mismatch");
  assert.ok(requested.events.some((event) => event.type === "REVIEWED"));
});

test("a failing AI order check never blocks an order", async () => {
  const { gate, paypal } = withReviewer(async () => {
    throw new Error("model timeout");
  });
  const quote = gate.createQuote({ items: twoBags, intent: "two bags" });
  const requested = await gate.requestPayment(quote.id);
  assert.equal(requested.review, undefined);
  assert.ok(requested.events.some((event) => event.type === "REVIEW_SKIPPED"));

  paypal.approve(requested.paypalOrderId);
  assert.equal((await gate.settle(quote.id)).status, "PAID");
});

test("requests that expired without approval stop counting toward the daily limit", async () => {
  const { gate, clock } = setup({ dailyLimitCents: 2000 });
  for (let i = 0; i < 2; i++) await gate.requestPayment(gate.createQuote({ items: twoBags }).id);
  assert.throws(() => gate.createQuote({ items: twoBags }), (error) => error.code === "OVER_DAILY_LIMIT");

  clock.now += 16 * 60_000;
  assert.equal(gate.createQuote({ items: twoBags }).totalCents, 900);
});
