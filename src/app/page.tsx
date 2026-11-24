import { HomeLogin } from "@/components/child/home-login";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <h1>家庭学习工具</h1>
        <HomeLogin />
      </section>
    </main>
  );
}
