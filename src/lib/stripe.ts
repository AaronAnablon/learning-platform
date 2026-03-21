import Stripe from "stripe";

export function getStripeClient() {
	const secretKey = process.env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}

	return new Stripe(secretKey);
}
