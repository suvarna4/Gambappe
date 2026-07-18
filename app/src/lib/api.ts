export interface PublicQuestion {
  id: string;
  kind: string;
  headline: string;
  yesLabel: string;
  noLabel: string;
  category: string;
  status: "draft" | "open" | "locked" | "graded" | "revealed" | "voided";
  opensAt: string;
  locksAt: string;
  venueUrl: string;
  participantCount: number;
  priceYes?: number | null;
  priceAsOf?: string | null;
  crowdYesAtLock?: number | null;
  crowdNoAtLock?: number | null;
  priceYesAtLock?: number | null;
  revealAt?: string | null;
  outcome?: "yes" | "no" | "void" | null;
  priceYesAtSettle?: number | null;
  revealedAt?: string | null;
}

export async function fetchTodayQuestion(): Promise<PublicQuestion | null> {
  const res = await fetch("/api/questions/today", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load today's question");
  const json = await res.json();
  return json.question;
}

export async function fetchQuestion(id: string): Promise<PublicQuestion | null> {
  const res = await fetch(`/api/questions/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load question");
  const json = await res.json();
  return json.question;
}

export interface MeUser {
  handle: string;
  kind: "ghost" | "pending" | "claimed";
  createdAt: string;
  stats: {
    accuracy: number | null;
    edge: number | null;
    participationStreak: number;
    bestParticipationStreak: number;
    winStreak: number;
    bestWinStreak: number;
    calledItCount: number;
    categoryStats: Record<string, { picks: number; wins: number }>;
  };
  badges: string[];
  email: string | null;
  eligibility: { nemesisEligible: boolean; picksResolvedTotal: number; nemesisMinPicks: number };
  prompts: { claimStreak: boolean; claimPicks: boolean };
}

export async function fetchMe(): Promise<MeUser | null> {
  const res = await fetch("/api/me", { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.user;
}

export interface MyPickResponse {
  pick: { side: "yes" | "no"; entryPrice: number; pickedAt: string } | null;
}

export async function submitPick(
  questionId: string,
  side: "yes" | "no"
): Promise<{
  ok: boolean;
  status: number;
  pick?: { id: string; side: string; entryPrice: number; pickedAt: string };
  error?: string;
}> {
  const res = await fetch("/api/picks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questionId, side }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok || res.status === 409) {
    return { ok: true, status: res.status, pick: json.pick };
  }
  return { ok: false, status: res.status, error: json?.error?.message ?? "Something went wrong" };
}

export interface RevealPayload {
  questionId: string;
  side: "yes" | "no";
  entryPrice: number;
  result: "pending" | "win" | "loss" | "void";
  outcome: "yes" | "no" | "void" | null;
  crowdYesAtLock: number | null;
  crowdNoAtLock: number | null;
  percentile: number | null;
  participationStreak: number;
  winStreak: number;
}

export async function fetchReveal(questionId: string): Promise<RevealPayload | null> {
  const res = await fetch(`/api/me/reveal/${questionId}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.reveal;
}

export interface MyPick {
  id: string;
  questionId: string;
  side: "yes" | "no";
  entryPrice: number;
  entryPriceAt: string;
  pickedAt: string;
  result: "pending" | "win" | "loss" | "void" | null;
}

export async function fetchMyPickForQuestion(questionId: string): Promise<MyPick | null> {
  const res = await fetch(`/api/me/picks?questionId=${questionId}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.picks?.[0] ?? null;
}

export interface PublicProfile {
  handle: string;
  kind: "ghost" | "pending" | "claimed";
  createdAt: string;
  stats: MeUser["stats"];
  badges: string[];
}

export interface ProfilePickLogRow {
  handle: string;
  side: "yes" | "no";
  entryPrice: number;
  pickedAt: string;
  result?: "pending" | "win" | "loss" | "void";
  headline: string;
  questionId: string;
}

export async function fetchProfile(
  handle: string
): Promise<{ profile: PublicProfile; picks: ProfilePickLogRow[] } | null> {
  const res = await fetch(`/api/profiles/${handle}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
