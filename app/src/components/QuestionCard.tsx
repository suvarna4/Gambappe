"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchQuestion,
  fetchTodayQuestion,
  fetchMyPickForQuestion,
  submitPick,
  type PublicQuestion,
  type MyPick,
} from "@/lib/api";
import { RevealSequence } from "./RevealSequence";
import { ShareButton } from "./ShareButton";

const POLL_MS = 5000;

export function QuestionCard({ questionId }: { questionId?: string }) {
  const [question, setQuestion] = useState<PublicQuestion | null | undefined>(undefined);
  const [myPick, setMyPick] = useState<MyPick | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPublicness, setShowPublicness] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const q = questionId ? await fetchQuestion(questionId) : await fetchTodayQuestion();
    setQuestion(q);
    if (q) {
      const mine = await fetchMyPickForQuestion(q.id);
      setMyPick(mine);
    }
  }, [questionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!question) return;
    if (["locked", "graded"].includes(question.status)) {
      pollRef.current = setInterval(load, POLL_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [question?.status, load, question]);

  async function pick(side: "yes" | "no") {
    if (!question || pending) return;
    setPending(true);
    setError(null);
    const wasFirstPickEver = myPick === null;
    const result = await submitPick(question.id, side);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong");
      return;
    }
    if (result.pick) {
      setMyPick({
        id: result.pick.id,
        questionId: question.id,
        side: result.pick.side as "yes" | "no",
        entryPrice: result.pick.entryPrice,
        entryPriceAt: result.pick.pickedAt,
        pickedAt: result.pick.pickedAt,
        result: null,
      });
      if (wasFirstPickEver) setShowPublicness(true);
    }
    load();
  }

  if (question === undefined) {
    return <div className="ticket p-6 text-center text-[var(--ink-dim)]">Loading...</div>;
  }
  if (question === null) {
    return (
      <div className="ticket p-6 text-center text-[var(--ink-dim)]">
        No question live right now. Check back soon.
      </div>
    );
  }

  return (
    <div className="ticket p-6 flex flex-col gap-4">
      <div className="text-xs uppercase tracking-wide text-[var(--ink-dim)]">{question.category}</div>
      <h1 className="text-xl font-semibold leading-snug">{question.headline}</h1>

      {question.status === "open" && (
        <>
          <div className="numeral text-sm text-[var(--ink-dim)]">
            {question.priceYes != null && (
              <>
                Live: ¢{Math.round(question.priceYes * 100)}
                {question.priceAsOf && (
                  <span className="ml-2">as of {timeAgo(question.priceAsOf)}</span>
                )}
              </>
            )}
          </div>
          {!myPick ? (
            <div className="grid grid-cols-2 gap-3">
              <SideButton label={question.yesLabel} side="yes" onClick={() => pick("yes")} disabled={pending} />
              <SideButton label={question.noLabel} side="no" onClick={() => pick("no")} disabled={pending} />
            </div>
          ) : (
            <PickedTicket pick={myPick} question={question} />
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {showPublicness && (
            <p className="text-xs text-[var(--ink-dim)]">Picks and records are public on Receipts.</p>
          )}
          <div className="text-xs text-[var(--ink-dim)]">{question.participantCount} players in</div>
        </>
      )}

      {question.status === "locked" && (
        <LockedView question={question} myPick={myPick} />
      )}

      {question.status === "graded" && (
        <div className="text-center py-6">
          <div className="stamp numeral text-2xl">SEALED</div>
          <p className="text-sm text-[var(--ink-dim)] mt-2">
            The result is locked in. Reveal at{" "}
            {question.revealAt ? new Date(question.revealAt).toLocaleTimeString() : "soon"}.
          </p>
        </div>
      )}

      {question.status === "revealed" && myPick && (
        <RevealSequence question={question} myPick={myPick} />
      )}
      {question.status === "revealed" && !myPick && (
        <RevealedSpectator question={question} />
      )}

      {question.status === "voided" && (
        <p className="text-center text-[var(--ink-dim)] py-6">
          This market voided. Streaks unaffected — see you tomorrow.
        </p>
      )}

      <a
        href={question.venueUrl}
        target="_blank"
        rel="noopener"
        className="text-xs text-[var(--ink-dim)] underline underline-offset-2 mt-2"
      >
        Trade this on Kalshi →
      </a>
    </div>
  );
}

function SideButton({
  label,
  side,
  onClick,
  disabled,
}: {
  label: string;
  side: "yes" | "no";
  onClick: () => void;
  disabled: boolean;
}) {
  const color = side === "yes" ? "var(--side-yes)" : "var(--side-no)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg py-4 font-semibold border-2 transition disabled:opacity-50"
      style={{ borderColor: color, color }}
    >
      {side === "yes" ? "▲" : "▼"} {label}
    </button>
  );
}

function PickedTicket({ question, pick }: { question: PublicQuestion; pick: MyPick }) {
  const color = pick.side === "yes" ? "var(--side-yes)" : "var(--side-no)";
  return (
    <div className="tear-line pt-4 flex flex-col gap-1">
      <div className="numeral text-lg" style={{ color }}>
        {pick.side.toUpperCase()} @ ¢{Math.round(pick.entryPrice * 100)}
      </div>
      <div className="text-xs text-[var(--ink-dim)]">
        stamped {new Date(pick.pickedAt).toLocaleTimeString()}
      </div>
      <ShareButton question={question} pick={pick} />
    </div>
  );
}

function LockedView({ question, myPick }: { question: PublicQuestion; myPick: MyPick | null }) {
  const yes = question.crowdYesAtLock ?? 0;
  const no = question.crowdNoAtLock ?? 0;
  const total = Math.max(1, yes + no);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-[var(--ink-dim)]">Locked. Crowd split:</div>
      <div className="flex h-3 rounded-full overflow-hidden border border-[var(--border)]">
        <div style={{ width: `${(yes / total) * 100}%`, background: "var(--side-yes)" }} />
        <div style={{ width: `${(no / total) * 100}%`, background: "var(--side-no)" }} />
      </div>
      <div className="numeral text-xs text-[var(--ink-dim)] flex justify-between">
        <span>{question.yesLabel} {yes}</span>
        <span>{question.noLabel} {no}</span>
      </div>
      {myPick && <PickedTicket question={question} pick={myPick} />}
    </div>
  );
}

function RevealedSpectator({ question }: { question: PublicQuestion }) {
  const yes = question.crowdYesAtLock ?? 0;
  const no = question.crowdNoAtLock ?? 0;
  return (
    <div className="text-center py-4">
      <div className="stamp numeral text-2xl" style={{ color: "var(--win)" }}>
        {question.outcome?.toUpperCase()}
      </div>
      <p className="text-sm text-[var(--ink-dim)] mt-2">
        Final split: {yes}-{no}. Play tomorrow&apos;s question.
      </p>
    </div>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}
