import { query } from './_generated/server';

export const ping = query({
  args: {},
  handler: async () => ({ ok: true as const, service: 'convex' as const }),
});
