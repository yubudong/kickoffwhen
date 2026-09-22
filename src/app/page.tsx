import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <h1>家庭学习工具</h1>
        <Link className="primary-link" href="/sign-in">
          进入家长登录
        </Link>
      </section>
    </main>
  );
}
