import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripeClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json(
        { error: "STRIPE_WEBHOOK_SECRET is not configured" },
        { status: 500 }
      );
    }

    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    const body = await request.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("Checkout completed", session.id);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid webhook payload or signature",
        details: String(error),
      },
      { status: 400 }
    );
  }
}
