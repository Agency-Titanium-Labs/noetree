import { setupClerkTestingToken } from "@clerk/testing/cypress";

describe("Checkout redirect", () => {
  it("redirects to Stripe's hosted checkout domain when a signed-in user clicks Upgrade to Premium", () => {
    setupClerkTestingToken();

    // setupClerkTestingToken() only bypasses bot protection — it does not
    // sign a user in. Establish a real authenticated session first (D-02's
    // sign-in gate must be already satisfied) via a dedicated Clerk test
    // user (password strategy; credentials in the gitignored
    // cypress.env.json, never committed).
    cy.visit("/en/pricing");
    cy.clerkSignIn({
      strategy: "password",
      identifier: Cypress.env("E2E_CLERK_USER_IDENTIFIER"),
      password: Cypress.env("E2E_CLERK_USER_PASSWORD"),
    });
    cy.visit("/en/pricing");

    cy.contains("Upgrade to Premium").click();

    // Does NOT complete a real card payment — only asserts the redirect
    // reaches Stripe's hosted Checkout domain with the session created.
    cy.url({ timeout: 15000 }).should("include", "checkout.stripe.com");
  });
});
