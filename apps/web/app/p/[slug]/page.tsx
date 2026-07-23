/**
 * `/p/[slug]` — the public profile page (design doc §10.1 route table, §10.2 spectator-page
 * architecture, §10.4 design system, WS7-T4). ISR, 60s revalidate.
 *
 * §10.2/INV-10: the server render carries ZERO viewer-specific data — no cookies are read, no
 * identity is resolved, and the exact same HTML renders for an anonymous crawler and a logged-in
 * viewer of someone else's profile. §10.2's "viewer strip" (your own pick buttons / claim
 * prompt) is a concept for a question page or one's OWN profile, not this generic
 * anyone's-profile page.
 *
 * SPEC-GAP(ws7-t4): §10.1 names the route `/p/[handle]`, but §6.1.2 is explicit that profiles
 * are addressed by URL-safe `slug` (handles contain `#`/spaces, which aren't URL-safe) — this
 * implements `/p/[slug]`, matching §9.2's `GET /profiles/:slug` and §6.1.2 exactly, and treats
 * the §10.1 route-table name as shorthand rather than a literal path-segment name.
 *
 * SPEC-GAP(ws7-t4): a self-view enhancement (viewer strip on YOUR OWN profile — e.g. "this is
 * you", settings shortcut) is out of scope here per the task brief; this page renders the
 * public-profile-of-anyone case only.
 */
import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@receipts/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Barcode, PriceTag, Stamp, TicketCard } from '@receipts/ui';
import { GraveyardShelf } from '@/components/GraveyardShelf';
import { ProfileHeaderStats } from '@/components/profile/ProfileHeaderStats';
import { ProfileStatGrid } from '@/components/profile/ProfileStatGrid';
import { topPercentDisplay } from '@/components/profile/format';
import { getDb } from '@/lib/stores';
import { getProfilePageModel, getProfilePublicView, toPickPublic } from '@/lib/profile-page';
import type { ProfilePublic } from '@/lib/profile-page';
import { CpuBadge } from '@/components/nemesis/CpuBadge';
import { cpuRefFields } from '@/lib/cpu-badge';

export const revalidate = 60; // §10.1: /p/[handle] (here /p/[slug]) — ISR 60s

interface PageParams {
  slug: string;
}

interface PageSearchParams {
  cursor?: string;
}

interface PageProps {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/** One-line public record summary (§10.5 og:description convention) from whatever the public
 * contract actually exposes (no raw accuracy fraction is public, §9.2 — percentile only). */
function recordSummary(profile: ProfilePublic): string {
  const bits: string[] = [];
  if (profile.streak.current > 0) bits.push(`${profile.streak.current}-day streak`);
  if (profile.rating?.accuracy_percentile != null) {
    bits.push(`${topPercentDisplay(profile.rating.accuracy_percentile)} accuracy`);
  }
  if (profile.fingerprint) bits.push(`${profile.fingerprint.resolved_pick_count} picks logged`);
  return bits.length > 0 ? bits.join(' · ') : `${profile.handle}'s pick record`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getProfilePublicView(getDb(), slug);
  if (!profile) return { title: 'Profile not found' };

  // §10.5 pinned convention: og:title = headline or "{handle}'s receipt".
  const title = `${profile.handle}'s receipt`;
  const description = `${recordSummary(profile)} on ${PRODUCT_NAME}.`;
  const pageUrl = `${appUrl()}/p/${profile.slug}`;
  // SPEC-GAP(ws7-t4): WS8 owns the real /api/og/* renderer (§10.5: six templates incl.
  // `profile`, 1200×630, satori). It doesn't exist yet, so this points at the documented
  // future path — a real WS8 handler at this route needs no page change to "just work"; today
  // it 404s, which is the placeholder behavior the task brief calls out as acceptable.
  const ogImageUrl = `${appUrl()}/api/og/profile/${profile.slug}`;

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      types: {
        // SPEC-GAP(ws7-t4): /api/oembed is WS8-T4 (P1.5, not yet built), but §10.5 asks every
        // public page to carry this link tag regardless of whether the endpoint exists yet.
        'application/json+oembed': `${appUrl()}/api/oembed?url=${encodeURIComponent(pageUrl)}`,
      },
    },
    openGraph: {
      title,
      description,
      url: pageUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function ProfilePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { cursor } = await searchParams;

  const model = await getProfilePageModel(getDb(), slug, cursor ?? null);
  if (!model) notFound();

  const { profile, stats, picks, nextCursor } = model;
  const path = `/p/${profile.slug}`;

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">
          {profile.handle}
          {profile.kind === 'cpu' ? (
            <CpuBadge personaLabel={cpuRefFields(profile).cpu_persona_label} className="ml-2" />
          ) : null}
        </h1>
        <ProfileHeaderStats
          currentStreak={profile.currentStreak}
          freezeBank={profile.freezeBank}
          accuracyPercentile={stats.rating?.accuracy_percentile ?? null}
          walletVerified={stats.wallet?.verified ?? false}
        />
      </header>

      <ProfileStatGrid
        currentStreak={profile.currentStreak}
        bestStreak={profile.bestStreak}
        currentWinStreak={profile.currentWinStreak}
        bestWinStreak={profile.bestWinStreak}
        rating={stats.rating ? stats.rating.glicko_rating : null}
        nemesis={stats.nemesisSummary}
        badges={stats.badges}
      />

      {/* SW9-T3: the graveyard shelf (swipe-ux-plan §2.7 P3), fed by the lengths-only
          `ProfilePublic.graveyard` block. Rendered ONLY when the block exists — an empty
          history renders nothing at all, not an empty box (SW4-T3 AC). Profile-own data, so
          the page stays viewer-free/ISR-cacheable (INV-10). */}
      {stats.graveyard && (
        <GraveyardShelf
          ripDays={stats.graveyard.rip}
          calledItCount={stats.graveyard.called_it_count}
        />
      )}

      <section aria-labelledby="pick-log-heading" className="space-y-4">
        <h2 id="pick-log-heading" className="text-lg font-semibold">
          Pick log
        </h2>

        {picks.length === 0 ? (
          <p className="text-muted text-sm">No public picks yet.</p>
        ) : (
          <ul className="space-y-3">
            {picks.map((row) => {
              const publicPick = toPickPublic(row);
              const label =
                publicPick.side === 'yes' ? row.question.yesLabel : row.question.noLabel;
              return (
                <li key={publicPick.id}>
                  <TicketCard>
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-sm">{row.question.headline}</p>
                        <PriceTag
                          side={publicPick.side}
                          label={label}
                          yesProbability={publicPick.yes_price_at_entry}
                        />
                        <p className="text-muted font-mono text-xs">{publicPick.picked_at}</p>
                      </div>
                      <Stamp variant={publicPick.result} />
                    </div>
                  </TicketCard>
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && (
          <Link
            href={`${path}?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm underline underline-offset-2"
          >
            Load more
          </Link>
        )}
      </section>

      <Barcode path={path} />
    </main>
  );
}
