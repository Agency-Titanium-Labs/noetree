import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getUser } from "./helpers/helper";

export const store = mutation({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Called storeUser without authentication present");
    }

    // Check if we've already stored this identity before.
    // Note: If you don't want to define an index right away, you can use
    // ctx.db.query("users")
    //  .filter(q => q.eq(q.field("tokenIdentifier"), identity.tokenIdentifier))
    //  .unique();
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (user !== null) {
      // If we've seen this identity before but the name has changed, patch the value.

      await ctx.db.patch(user._id, {
        name: identity.name,
        tokenIdentifier: identity.tokenIdentifier,
        email: (identity.email || identity.preferredUsername)
          ?.trim()
          .toLowerCase(),
        picture:
          typeof typeof identity.picture !== "undefined"
            ? JSON.stringify(identity.picture)
            : undefined,
        nickname: identity.nickname,
        given_name: identity.givenName,
        updated_at: new Date().toISOString(),
        family_name: identity.familyName,
        phone_number:
          typeof identity.phone_number !== "undefined"
            ? JSON.stringify(identity.phone_number)
            : undefined,
        email_verified:
          typeof identity.email_verified !== "undefined"
            ? Boolean(identity.email_verified)
            : false,
        phone_number_verified:
          typeof identity.phone_number_verified !== "undefined"
            ? Boolean(identity.phone_number_verified)
            : false,
      });

      // Link any email-only shares to this user
      const email = (identity.email || identity.preferredUsername)
        ?.trim()
        .toLowerCase();
      if (email) {
        const emailShares = await ctx.db
          .query("shares")
          .withIndex("by_email", q => q.eq("email", email))
          .collect();
        for (const share of emailShares) {
          if (!share.userId) {
            await ctx.db.patch(share._id, { userId: user._id });
          }
        }
      }

      return user._id;
    }
    // The original dev deployment seeded this roles row; a fresh deployment has
    // no such row, so fall back to finding or creating the "user" role.
    const seededRoleId = ctx.db.normalizeId(
      "roles",
      "jd73rghdc6jjjxhm0e6gd8gys57bx472",
    );
    let roleId: Id<"roles"> | null =
      seededRoleId && (await ctx.db.get("roles", seededRoleId))
        ? seededRoleId
        : null;
    if (!roleId) {
      const roles = await ctx.db.query("roles").take(20);
      roleId =
        roles.find(r => r.role === "user")?._id ??
        (await ctx.db.insert("roles", { role: "user" }));
    }

    // If it's a new identity, create a new `User`.
    const newUserId = await ctx.db.insert("users", {
      name: identity.name,
      tokenIdentifier: identity.tokenIdentifier,
      role: roleId,
      email: (identity.email || identity.preferredUsername)
        ?.trim()
        .toLowerCase(),
      picture:
        typeof typeof identity.picture !== "undefined"
          ? JSON.stringify(identity.picture)
          : undefined,
      nickname: identity.nickname,
      given_name: identity.givenName,
      updated_at: new Date().toISOString(),
      family_name: identity.familyName,
      phone_number:
        typeof identity.phone_number !== "undefined"
          ? JSON.stringify(identity.phone_number)
          : undefined,
      email_verified:
        typeof identity.email_verified !== "undefined"
          ? Boolean(identity.email_verified)
          : false,
      phone_number_verified:
        typeof identity.phone_number_verified !== "undefined"
          ? Boolean(identity.phone_number_verified)
          : false,
    });

    // Link any email-only shares to this user
    const email = (identity.email || identity.preferredUsername)
      ?.trim()
      .toLowerCase();
    if (email) {
      const emailShares = await ctx.db
        .query("shares")
        .withIndex("by_email", q => q.eq("email", email))
        .collect();
      for (const share of emailShares) {
        if (!share.userId) {
          await ctx.db.patch(share._id, { userId: newUserId });
        }
      }
    }

    return newUserId;
  },
});

export const me = query({
  args: {},
  handler: async ctx => {
    return await getUser(ctx);
  },
});
