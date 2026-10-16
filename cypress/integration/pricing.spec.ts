import { setupClerkTestingToken } from "@clerk/testing/cypress";

describe("Pricing page", () => {
  it("renders Free and Premium plan comparison with the expected copy", () => {
    setupClerkTestingToken();

    cy.visit("/en/pricing");

    cy.contains("Simple, transparent pricing").should("be.visible");
    cy.contains("Unlimited notes").should("be.visible");
    cy.contains("6.99€ / month").should("be.visible");
    cy.contains("Upgrade to Premium").should("be.visible");
    cy.contains("Monthly").should("be.visible");
    cy.contains("Annual").should("be.visible");
    cy.contains("Save ~30%").should("be.visible");

    cy.contains("Annual").click();
    cy.contains("59€ / year").should("be.visible");
  });
});
