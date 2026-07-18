export default function AlreadyExistsPage() {
  return (
    <div className="ticket p-6 flex flex-col gap-3 text-center">
      <h1 className="text-lg font-semibold">You already have an account</h1>
      <p className="text-sm text-[var(--ink-dim)]">
        Sign out on this device and sign back in with that account to see your record.
      </p>
    </div>
  );
}
