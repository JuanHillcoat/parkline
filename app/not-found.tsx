import Link from "next/link";

export default function NotFound() {
  return (
    <main className="centered">
      <section className="card">
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or was moved.</p>
        <Link href="/" className="btn btn-primary">Go to Home</Link>
      </section>
    </main>
  );
}
