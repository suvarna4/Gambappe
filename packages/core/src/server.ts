/**
 * `@receipts/core/server` — the subset of the contract hub that needs Node built-ins
 * (`node:crypto`) and must never reach a browser bundle. Import from here (not the main `.`
 * barrel) in server-only code; `apps/web` client components must only ever import `.`.
 */
export * from './email-transport.js';
export * from './notifications-token.js';
export * from './share-token.js';
