import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const identity = {
  tokenIdentifier: "https://clerk.dev|user_store_test",
  subject: "user_store_test",
  name: "Store Test",
  email: "store-test@example.com",
};

describe("users.store", () => {
  test("creates a user on a fresh deployment with no seeded role", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.withIdentity(identity).mutation(api.users.store, {});
    const { user, roles } = await t.run(async ctx => ({
      user: await ctx.db.get("users", userId),
      roles: await ctx.db.query("roles").collect(),
    }));
    expect(user?.tokenIdentifier).toBe(identity.tokenIdentifier);
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe("user");
    expect(user?.role).toBe(roles[0]._id);
  });

  test("reuses an existing user role instead of creating another", async () => {
    const t = convexTest(schema, modules);
    const roleId = await t.run(
      async ctx => await ctx.db.insert("roles", { role: "user" }),
    );
    const userId = await t.withIdentity(identity).mutation(api.users.store, {});
    const { user, roleCount } = await t.run(async ctx => ({
      user: await ctx.db.get("users", userId),
      roleCount: (await ctx.db.query("roles").collect()).length,
    }));
    expect(user?.role).toBe(roleId);
    expect(roleCount).toBe(1);
  });

  test("is idempotent for the same identity", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const first = await asUser.mutation(api.users.store, {});
    const second = await asUser.mutation(api.users.store, {});
    expect(second).toBe(first);
  });
});
