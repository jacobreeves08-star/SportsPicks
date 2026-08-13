/**
 * `VITE_API_BASE_URL` — Vite only exposes env vars prefixed `VITE_` to
 * client code (everything else is stripped at build time, deliberately
 * — see Vite's own docs on this; it's how a `.env` full of server
 * secrets never leaks into a shipped bundle). Defaults to the API's
 * local dev port (`apps/api`'s `PORT` default, `.env.example`) so
 * `npm run dev` works with zero client-side config out of the box.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
