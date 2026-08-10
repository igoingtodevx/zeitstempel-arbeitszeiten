import { ConvexReactClient } from 'convex/react';

const url = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? 'http://127.0.0.1:3210';

export const convex = new ConvexReactClient(url);
export const convexConfigured = Boolean(import.meta.env.VITE_CONVEX_URL);
