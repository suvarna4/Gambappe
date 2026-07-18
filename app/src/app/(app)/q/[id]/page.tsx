import { QuestionCard } from "@/components/QuestionCard";

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flex-1 flex flex-col gap-6 pt-4">
      <div className="text-center text-2xl font-bold tracking-tight">RECEIPTS</div>
      <QuestionCard questionId={id} />
    </main>
  );
}
