"use client";

/**
 * Last-resort boundary. Details of infrastructure failures are logged on the
 * server by Next.js and are never rendered here.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="centered">
      <section className="card" role="alert">
        <h1>Something went wrong</h1>
        <p>The page could not be loaded. Try again in a moment.</p>
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
