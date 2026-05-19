import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wi-Fi Gratuito — JOCUM AT",
  description: "Conecte-se à internet na Base JOCUM Almirante Tamandaré e veja os planos de contribuição.",
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const plans = [
  { category: "Obreiro", monthly: 30, daily: 3, description: "Para obreiros individuais", highlight: false, note: null },
  { category: "Aluno", monthly: 35, daily: 3, description: "Para alunos da escola", highlight: false, note: null },
  { category: "Casal", monthly: 50, daily: 5, description: "Para casais — 2 pessoas", highlight: true, note: null },
  { category: "Ministério", monthly: 50, daily: null, description: "Para equipes e ministérios", highlight: false, note: "R$ 15/pessoa extra acima de 3" },
];

export default function HotspotPage() {
  return (
    <main className="hotspot-page">
      <header className="hotspot-hero">
        <div className="hotspot-connected-badge">
          <span className="hotspot-dot" aria-hidden="true" />
          Wi-Fi conectado
        </div>
        <img src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré" className="hotspot-logo" />
        <h1 className="hotspot-title">Internet gratuita da Base</h1>
        <p className="hotspot-subtitle">
          Você está conectado! Contribua com a infraestrutura e garanta seu acesso continuamente.
        </p>
      </header>

      <section className="hotspot-plans-section" aria-label="Planos de contribuição">
        <p className="hotspot-section-label">Planos de contribuição</p>
        <div className="hotspot-plans-grid">
          {plans.map((plan) => (
            <article key={plan.category} className={`hotspot-plan-card${plan.highlight ? " hotspot-plan-popular" : ""}`}>
              {plan.highlight && <span className="hotspot-popular-badge">Popular</span>}
              <strong className="hotspot-plan-name">{plan.category}</strong>
              <p className="hotspot-plan-desc">{plan.description}</p>
              <div className="hotspot-plan-price-block">
                <span className="hotspot-price-value">{money.format(plan.monthly)}</span>
                <span className="hotspot-price-period">/mês</span>
              </div>
              {plan.daily !== null && (
                <span className="hotspot-price-secondary">ou {money.format(plan.daily)}/dia</span>
              )}
              {plan.note && <span className="hotspot-price-secondary">{plan.note}</span>}
            </article>
          ))}
        </div>
        <div className="hotspot-discounts-row">
          <span>10% off a partir de 3 meses</span>
          <span aria-hidden="true">·</span>
          <span>Diário: máx. R$ 50 para 20+ dias</span>
        </div>
      </section>

      <section className="hotspot-cta-section">
        <a href="/?tab=signup" className="hotspot-cta-primary">Criar Cadastro</a>
        <a href="/?tab=login" className="hotspot-cta-secondary">Já tenho cadastro — Entrar</a>
      </section>

      <footer className="hotspot-footer">
        <span>JOCUM Almirante Tamandaré · Base de Missões</span>
        <a href="/termos-de-uso" className="hotspot-footer-link">Termos de Uso</a>
      </footer>
    </main>
  );
}
