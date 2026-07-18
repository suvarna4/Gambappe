/**
 * Auth.js route handler (WS2-T2, §11.1). Node runtime — the Drizzle adapter needs `pg`.
 */
import { handlers } from '../../../../auth';

export const { GET, POST } = handlers;
export const runtime = 'nodejs';
