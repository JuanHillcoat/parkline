"use client";

import { copy } from "./_lib/copy";

/**
 * Last-resort boundary. Details of infrastructure failures are logged on the
 * server by Next.js and are never rendered here.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="centered">
      <section className="card" role="alert">
        <h1>{copy.errors.page.title}</h1>
        <p>{copy.errors.page.text}</p>
        <button type="button" className="btn btn-primary" onClick={reset}>{copy.errors.page.retry}</button>
      </section>
    </main>
  );
}
