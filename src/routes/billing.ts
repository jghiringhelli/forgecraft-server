import { Hono } from "hono";
import Stripe from "stripe";
import { updateUserTier } from "../modules/users/users.service.js";
import type { Tier } from "@prisma/client";

/** Maps Stripe price IDs (set as env vars) to ForgeCraft tiers. */
function getTierForPriceId(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRICE_PRO) return "PRO";
  if (priceId === process.env.STRIPE_PRICE_TEAMS) return "TEAMS";
  return null;
}

export const billingRouter = new Hono();

/**
 * POST /billing/webhook — receives Stripe events.
 * Verifies webhook signature, updates user tier on subscription changes.
 */
billingRouter.post("/webhook", async (c) => {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecret || !webhookSecret) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const stripe = new Stripe(stripeSecret);
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing Stripe signature" }, 400);

  const rawBody = await c.req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch {
    return c.json({ error: "Invalid Stripe signature" }, 400);
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const priceId = sub.items.data[0]?.price.id;
    if (!priceId) return c.json({ received: true });

    const tier = getTierForPriceId(priceId);
    if (tier && typeof sub.customer === "string") {
      await updateUserTier(sub.customer, tier, sub.id);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (typeof sub.customer === "string") {
      await updateUserTier(sub.customer, "FREE", sub.id);
    }
  }

  return c.json({ received: true });
});

/**
 * POST /billing/checkout — creates a Stripe Checkout session for tier upgrades.
 * Requires a valid Clerk session (authenticated users only).
 */
billingRouter.post("/checkout", async (c) => {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const body = await c.req.json<{ tier: "PRO" | "TEAMS"; customerId?: string }>();
  const priceId =
    body.tier === "PRO"
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_TEAMS;

  if (!priceId) {
    return c.json({ error: "Price not configured for this tier" }, 503);
  }

  const stripe = new Stripe(stripeSecret);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    customer: body.customerId,
    success_url: `${process.env.APP_URL ?? "https://forgecraft.tools"}/?upgraded=true`,
    cancel_url: `${process.env.APP_URL ?? "https://forgecraft.tools"}/#pricing`,
  });

  return c.json({ url: session.url });
});
