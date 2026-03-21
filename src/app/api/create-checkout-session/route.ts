import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      priceId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!body.priceId || !body.successUrl || !body.cancelUrl) {
      return NextResponse.json(
        { error: "priceId, successUrl, and cancelUrl are required" },
        { status: 400 }
      );
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: body.priceId, quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create checkout session", details: String(error) },
      { status: 500 }
    );
  }
}
