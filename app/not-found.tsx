import Link from "next/link";
import { copy } from "./_lib/copy";

export default function NotFound() {
  return (
    <main className="centered">
      <section className="card">
        <h1>{copy.errors.notFound.title}</h1>
        <p>{copy.errors.notFound.text}</p>
        <Link href="/" className="btn btn-primary">{copy.errors.notFound.home}</Link>
      </section>
    </main>
  );
}
