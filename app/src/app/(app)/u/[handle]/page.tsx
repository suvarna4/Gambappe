import { notFound } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";
import { getPublicProfile } from "@/server/profile";

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const data = await getPublicProfile(handle);
  if (!data) notFound();
  return (
    <main className="flex-1 flex flex-col gap-6 pt-4">
      <ProfileView profile={data.profile} picks={data.picks} />
    </main>
  );
}
