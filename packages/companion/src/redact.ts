/**
 * Crude PII scrub (docs/xtrace-hackathon-tasks.md XH-T2), consumed by XH-T5 on every post
 * body before ingest. Ground rule 6 forbids emails leaving the app; post bodies are
 * free-form user text and the repo's moderation model (§14) is reactive removal, not a
 * pre-send filter, so this is the only thing standing between a user typing their email
 * into a trash-talk thread and that email landing in a third-party store. Deliberately
 * crude: over-redaction of rivalry banter is harmless, under-redaction is not.
 */
const EMAIL_PATTERN = /\S+@\S+\.\S+/g;
const PHONE_PATTERN = /\(?\d(?:[-.() ]*\d){6,}\)?/g;

export function scrubPii(text: string): string {
  return text.replace(EMAIL_PATTERN, '[redacted]').replace(PHONE_PATTERN, '[redacted]');
}
