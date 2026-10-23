import { defineConfig } from "cypress";
import { clerkSetup } from "@clerk/testing/cypress";

export default defineConfig({
  e2e: {
    specPattern: "cypress/integration/**/*.spec.{js,jsx,ts,tsx}",
    setupNodeEvents(on, config) {
      return clerkSetup({ config });
    },
    video: true,
    baseUrl: "http://localhost:3000",
  },
  projectId: "e3zwoh",
});
