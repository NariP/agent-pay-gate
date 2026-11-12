import { z } from "zod";
import { catalog } from "./catalog.js";
import { GateError } from "./gate.js";
import { format } from "./money.js";

const summary = (quote) => ({
  quote_id: quote.id,
  status: quote.status,
  items: quote.items.map((item) => ({ sku: item.sku, name: item.name, quantity: item.quantity, line_total: format(item.lineCents) })),
  total: format(quote.totalCents),
  expires_at: new Date(quote.expiresAt).toISOString(),
});

const GUIDANCE = {
  QUOTED: "Payment has not been requested yet. Call request_payment.",
  AWAITING_APPROVAL: "The human has not approved yet. Do not retry in a loop; ask them to open the approval link.",
  PAID: "Paid. Tell the user the order is confirmed.",
  EXPIRED: "The quote expired without approval. Nothing was charged. Create a new quote if the user still wants it.",
  BLOCKED: "The gate refused to capture this payment. Nothing was charged. Tell the user the reason.",
};

/**
 * The four things an agent can do at this store. The same definitions back the MCP server
 * and the built-in demo agent, so both get exactly the same powers and limits.
 */
export function createTools({ gate, config, log = () => {} }) {
  const tools = [
    {
      name: "list_products",
      title: "List products",
      description: `List what ${config.merchantName} sells, with SKUs and prices in USD.`,
      shape: {},
      run: async () => ({
        merchant: config.merchantName,
        products: catalog.map((p) => ({ sku: p.sku, name: p.name, price: format(p.priceCents), note: p.note })),
        agent_order_limits: { per_order: format(config.policy.maxOrderCents), per_24_hours: format(config.policy.dailyLimitCents) },
      }),
    },
    {
      name: "create_quote",
      title: "Create a quote",
      description:
        "Build an order and get a fixed quote. This charges nothing. The total is locked to this quote; to change anything, create a new quote. Orders over the merchant's limits for agents are refused here.",
      shape: {
        items: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(1).max(20) })).min(1),
        intent: z.string().max(300).describe("The user's request in their own words. Shown to the human on the approval page so they can spot a wrong order."),
      },
      run: async ({ items, intent }) => ({
        ...summary(gate.createQuote({ items, intent })),
        next_step: "Show the items and total to the user, then call request_payment with this quote_id.",
      }),
    },
    {
      name: "request_payment",
      title: "Request payment approval",
      description:
        "Create a PayPal payment request for a quote and get an approval link for the human. You cannot approve or pay it yourself: give the link to the user and wait. Do not open the link or try to complete checkout.",
      shape: { quote_id: z.string() },
      run: async ({ quote_id }) => {
        const quote = await gate.requestPayment(quote_id);
        return {
          ...summary(quote),
          approval_url: quote.reviewUrl,
          ...(quote.review ? { order_check: { verdict: quote.review.verdict, reason: quote.review.reason } } : {}),
          next_step: "Give approval_url to the user. Only they can approve, in PayPal. After they say they approved, call check_payment.",
        };
      },
    },
    {
      name: "check_payment",
      title: "Check payment",
      description:
        "Check whether the human approved the payment. If they did and the approved amount matches the quote exactly, the gate captures it and the order becomes PAID. Calling this again never charges twice.",
      shape: { quote_id: z.string() },
      run: async ({ quote_id }) => {
        const quote = await gate.settle(quote_id);
        return {
          ...summary(quote),
          ...(quote.captureId ? { paypal_capture_id: quote.captureId } : {}),
          ...(quote.blockedReason ? { blocked_reason: quote.blockedReason } : {}),
          next_step: GUIDANCE[quote.status],
        };
      },
    },
  ];

  // Every caller gets a plain object back: the result, or { error, message } when the gate refuses.
  return tools.map((tool) => ({
    ...tool,
    schema: z.object(tool.shape),
    call: async (args) => {
      try {
        return { ok: true, data: await tool.run(z.object(tool.shape).parse(args ?? {})) };
      } catch (error) {
        if (error instanceof z.ZodError) return { ok: false, data: { error: "BAD_INPUT", message: z.prettifyError(error) } };
        if (!(error instanceof GateError)) log(error.message);
        return { ok: false, data: { error: error.code ?? "PAYPAL_ERROR", message: error.message } };
      }
    },
  }));
}
