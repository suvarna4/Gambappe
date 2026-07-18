#!/usr/bin/env node
/**
 * §16.6 M12 rehearsal script — drives the §16.1 demo narrative
 * end-to-end against a running server using FakeVenue, over plain
 * HTTP (the same surface a real demo uses, not internal function
 * calls). Run against a FRESH database (drop+migrate, or a dedicated
 * rehearsal DB) since it creates today's Daily Question.
 *
 * Usage: BASE_URL=http://localhost:3000 node scripts/rehearsal.mjs
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok && res.status !== 409) {
    console.error(`  ! ${opts.method ?? "GET"} ${path} -> ${res.status}`, json);
  }
  return { status: res.status, json, headers: res.headers };
}

function cookieFrom(headers, name) {
  const raw = headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${name}=[^;]+`));
  return match ? match[0] : null;
}

async function main() {
  log("1", "Create Question Zero (admin curation, FakeVenue)");
  const created = await api("/api/admin/questions", {
    method: "POST",
    body: JSON.stringify({
      venue: "fake",
      venueMarketId: "fake:question-zero",
      headline: "Will Argentina win the World Cup final?",
      fakePriceYes: 0.63,
    }),
  });
  const questionId = created.json.question.id;
  console.log("  question:", questionId);

  log("2", "Open it");
  await api(`/api/admin/questions/${questionId}/open`, { method: "POST" });

  log("3", "Spectator view (logged out, no cookie)");
  const spectator = await api(`/api/questions/${questionId}`);
  console.log("  ", spectator.json.question.headline, "@ ¢" + Math.round(spectator.json.question.priceYes * 100));

  log("4", "Ghost picks YES (one tap, mints inline)");
  const pickRes = await api("/api/picks", {
    method: "POST",
    body: JSON.stringify({ questionId, side: "yes" }),
  });
  const ghostCookie = cookieFrom(pickRes.headers, "receipts_ghost");
  console.log("  stamped:", pickRes.json.pick.side, "@ ¢" + Math.round(pickRes.json.pick.entryPrice * 100));

  log("5", "Admin locks the question");
  await api(`/api/admin/questions/${questionId}/lock`, { method: "POST" });

  log("6", "Admin settles via manual override (mirrors venue truth)");
  await api(`/api/admin/questions/${questionId}/settle`, {
    method: "POST",
    body: JSON.stringify({ outcome: "yes" }),
  });

  const graded = await api(`/api/questions/${questionId}`);
  if (graded.json.question.outcome !== undefined) {
    throw new Error("LEAK: outcome visible while merely graded — D-16 violated");
  }
  console.log("  graded, result still hidden (confirmed no leak)");

  log("7", "Admin reveals now (demo pacing)");
  await api(`/api/admin/questions/${questionId}/reveal`, { method: "POST" });

  const revealed = await api(`/api/questions/${questionId}`);
  console.log("  outcome revealed:", revealed.json.question.outcome);

  log("8", "Ghost's personal reveal + share card");
  const reveal = await api(`/api/me/reveal/${questionId}`, { headers: { cookie: ghostCookie } });
  console.log("  result:", reveal.json.reveal.result, "streak:", reveal.json.reveal.participationStreak);
  console.log("  card:", `${BASE}/api/cards/daily/${pickRes.json.pick.id}`);
  console.log("  share page:", `${BASE}/q/${questionId}`);

  log("9", "Claim prompt -> start claim flow");
  const claimStart = await api("/api/claim/start", { headers: { cookie: ghostCookie } });
  console.log("  claim flow reachable:", claimStart.status === 200 || claimStart.status === 307);

  log("done", "Rehearsal complete. Continue claiming manually in a browser to see the attestation screen,");
  console.log("      then use the admin panel's 'Assign nemeses now' once two claimed users are eligible.");
}

main().catch((err) => {
  console.error("REHEARSAL FAILED:", err);
  process.exit(1);
});
