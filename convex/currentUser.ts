import { query } from './_generated/server';

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      id: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
    };
  },
});
