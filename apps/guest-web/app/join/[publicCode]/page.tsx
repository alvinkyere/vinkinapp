import { JoinExperience } from '../../../features/join/JoinExperience';

export default async function JoinPage({
  params,
}: {
  params: Promise<{ publicCode: string }>;
}) {
  const { publicCode } = await params;
  return (
    <main className="flex flex-1 flex-col justify-center">
      <JoinExperience publicCode={publicCode} />
    </main>
  );
}
