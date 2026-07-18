/**
 * RevealPayload domain type (design doc §6.7) — inferred from the zod contract so the type
 * and the wire schema can never drift. `viewer.percentile` is nullable BY CONTRACT (null at P0).
 */
import type { z } from 'zod';
import type {
  revealPayloadSchema,
  revealViewerSchema,
  crowdSplitSchema,
} from '../schemas/questions.js';

export type RevealPayload = z.infer<typeof revealPayloadSchema>;
export type RevealViewer = z.infer<typeof revealViewerSchema>;
export type CrowdSplit = z.infer<typeof crowdSplitSchema>;
