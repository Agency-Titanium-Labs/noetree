import { auth } from "@clerk/nextjs/server";
import { redirect, routing } from "@/i18n/routing";
import { SuccessStatus } from "./SuccessStatus";

export default async function CheckoutSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = (routing.locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  const { userId } = await auth();

  if (!userId) {
    // D-12: no user resolved server-side — send back to pricing (internal route).
    redirect({ href: "/pricing", locale });
    return;
  }

  // D-12: this boundary only gates signed-out visitors server-side via Clerk
  // auth(); it never fetches the checkout session server-side. The reactive
  // client child derives its own identity from Convex auth (IDOR fix,
  // 03-REVIEW.md CR-01), not from a prop. session_id (if present in the URL)
  // is a debugging reference only — Convex is the sole source of truth.
  return <SuccessStatus locale={locale} />;
}
