"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SignupPayload = {
  categoria?: string;
  nome?: string;
  tempo?: string;
  tipo_plano?: string;
  valor?: number;
  aceite_de_termo?: boolean;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const termsSections = [
  {
    title: "1. Finalidade",
    body: [
      "A rede de internet fornecida tem como objetivo apoiar as atividades pessoais, ministeriais, educacionais e de convivência comunitária dos membros, visitantes e colaboradores da JOCUM.",
    ],
  },
  {
    title: "2. Compromisso com os valores cristãos",
    body: [
      "A JOCUM é uma organização missionária cristã, fundamentada em princípios bíblicos e comprometida com uma vida íntegra, responsável e que glorifica a Deus.",
      "Ao utilizar este serviço, o(a) usuário(a) reconhece e respeita esses valores, comprometendo-se a não realizar ações que estejam em desacordo com essa identidade.",
    ],
  },
  {
    title: "3. Uso responsável da rede",
    body: [
      "O(a) usuário(a) compromete-se a utilizar a rede de forma ética, respeitosa e consciente, abstendo-se de:",
    ],
    items: [
      "Acessar sites com conteúdo impróprio ou malicioso, como pornografia, violência gratuita ou discurso de ódio;",
      "Realizar atividades que possam comprometer a segurança da rede ou de outros usuários;",
      "Usar a rede para fins ilícitos ou que prejudiquem a integridade moral, espiritual ou emocional da comunidade.",
    ],
  },
  {
    title: "4. Ambiente de confiança",
    body: [
      "Entendemos que a internet é uma ferramenta poderosa e que pode ser usada para edificação. Por isso, ao se conectar à nossa rede, o(a) usuário(a) concorda em contribuir para um ambiente digital saudável e alinhado aos princípios do Reino de Deus.",
    ],
  },
  {
    title: "5. Consequências do uso indevido",
    body: [
      "A equipe de Comunicação e liderança da JOCUM AT poderá limitar, suspender ou revogar o acesso à internet em caso de uso indevido ou reincidência de práticas contrárias a este termo.",
    ],
  },
  {
    title: "6. Aceite",
    body: [
      "Declaro que li, compreendi e aceito os termos acima, e me comprometo a utilizá-la com responsabilidade e respeito à missão e aos valores da JOCUM.",
    ],
  },
];

export default function TermsPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("wf_signup");
    if (!stored) return;

    try {
      setPayload(JSON.parse(stored) as SignupPayload);
    } catch {
      sessionStorage.removeItem("wf_signup");
    }
  }, []);

  const goBack = () => {
    router.push("/");
  };

  const continueToPayment = () => {
    if (!accepted) {
      setShowWarning(true);
      return;
    }

    if (payload) {
      sessionStorage.setItem("wf_signup", JSON.stringify({ ...payload, aceite_de_termo: true }));
    } else {
      sessionStorage.setItem("wf_terms_accepted", "true");
    }

    router.push("/pagamento");
  };

  return (
    <main className="terms-page">
      <section className="terms-shell" aria-label="Termo de adesão e aceite">
        <article className="terms-content motion-in">
          <header className="terms-header">
            <button className="back-button" type="button" onClick={goBack} aria-label="Voltar">
              <span aria-hidden="true">‹</span>
            </button>

            <img className="terms-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />

            <div className="terms-title-block">
              <p className="eyebrow">Wi-Fi da Base</p>
              <h1>Termo de Consentimento para Utilização da Internet - JOCUM</h1>
            </div>

            {payload && (
              <div className="terms-summary" aria-label="Resumo do cadastro">
                <span>{payload.categoria || "Categoria"}</span>
                <strong>{payload.tempo || "Tempo a confirmar"}</strong>
                <span>{payload.valor ? money.format(payload.valor) : "Valor a confirmar"}</span>
              </div>
            )}
          </header>

          <div className="terms-scroll">
            <p>
              Ao acessar e utilizar a rede de internet disponibilizada pela JOCUM AT (Jovens Com Uma Missão Almirante
              Tamandaré), o(a) usuário(a) declara estar ciente e de acordo com os termos a seguir:
            </p>

            {termsSections.map((section) => (
              <section className="terms-section" key={section.title}>
                <h2>{section.title}</h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <footer className="terms-actions">
            <label className="terms-check">
              <input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" />
              <span>Li e concordo com os termos acima</span>
            </label>

            <button className="primary-button terms-next-button" type="button" onClick={continueToPayment}>
              Seguinte
            </button>
          </footer>
        </article>

        <aside className="terms-brand" aria-label="JOCUM Almirante Tamandaré">
          <img src="/brand/logo-at-square.png" alt="" aria-hidden="true" />
          <div>
            <p>JOCUM AT</p>
            <strong>Internet com responsabilidade, cuidado e comunhão.</strong>
          </div>
        </aside>
      </section>

      {showWarning && (
        <div className="terms-dialog-backdrop" role="presentation">
          <div className="terms-dialog" role="alertdialog" aria-modal="true" aria-labelledby="terms-dialog-title">
            <h2 id="terms-dialog-title">Ops!</h2>
            <p>
              Não é possível criar um usuário sem que você aceite os termos de utilização. Qualquer dúvida, procure a
              equipe de Comunicação ou a liderança da Base.
            </p>
            <button className="primary-button" type="button" onClick={() => setShowWarning(false)}>
              Ok
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
