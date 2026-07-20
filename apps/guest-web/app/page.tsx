export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center font-sans">
      <h1 className="font-display text-2xl font-extrabold text-ink">
        Vink<span className="text-blue">In</span>
      </h1>
      <p className="text-smoke">
        Scan a QR code or open the join link an organizer shared with you to see your Vink.
      </p>
    </main>
  );
}
