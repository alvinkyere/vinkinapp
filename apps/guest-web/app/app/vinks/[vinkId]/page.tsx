import Link from 'next/link';

export default async function OpenVinkInAppPage({
  params,
}: {
  params: Promise<{ vinkId: string }>;
}) {
  const { vinkId } = await params;
  const customSchemeUrl = `vinkin://vinks/${encodeURIComponent(vinkId)}`;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center font-sans">
      <h1 className="font-display text-2xl font-extrabold text-ink">Open this Vink in VinkIn</h1>
      <p className="text-smoke">This organizer link opens the VinkIn app when it is installed.</p>
      <Link
        className="rounded-full bg-blue px-6 py-3 font-semibold text-white"
        href={customSchemeUrl}
      >
        Open VinkIn
      </Link>
    </main>
  );
}
