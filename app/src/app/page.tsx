import { QuestionCard } from "@/components/QuestionCard";
import { ClaimPrompt } from "@/components/ClaimPrompt";

export default function HomePage() {
  return (
    <main className="flex-1 flex flex-col gap-6 pt-4">
      <div className="text-center text-2xl font-bold tracking-tight">RECEIPTS</div>
      <QuestionCard />
      <ClaimPrompt />
    </main>
  );
}
