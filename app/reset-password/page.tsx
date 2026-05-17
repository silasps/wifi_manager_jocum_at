"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase/client";

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="M4 4l16 16" />}
    </svg>
  );
}

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase injects the recovery session from the URL hash automatically
    // We just need to wait for the auth state change with type "PASSWORD_RECOVERY"
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("As senhas precisam ser iguais.");
      return;
    }
    if (password.length < 6) {
      setMessage("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setMessage("Não foi possível atualizar a senha. Tente solicitar um novo link.");
      return;
    }

    setDone(true);
  };

  return (
    <main className="login-page">
      <section className="auth-shell" aria-label="Redefinir senha">
        <div className="brand-panel">
          <div>
            <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
            <p className="eyebrow">Wi-Fi da Base</p>
            <p className="brand-copy">Defina uma nova senha para retomar o acesso.</p>
          </div>
        </div>

        <div className="auth-card">
          <img className="auth-logo" src="/brand/logo-at-symbol.png" alt="JOCUM AT" />

          {done ? (
            <div className="form-stack motion-in">
              <p className="form-intro">Senha atualizada com sucesso!</p>
              <a className="primary-button" href="/" style={{ textAlign: "center", display: "block" }}>
                Ir para o login
              </a>
            </div>
          ) : !ready ? (
            <div className="form-stack motion-in">
              <p className="form-intro">Verificando o link de recuperação...</p>
              <p className="status-message">Se nada acontecer, solicite um novo link na tela de login.</p>
              <a className="link-button" href="/" style={{ textAlign: "center", display: "block" }}>
                Voltar ao login
              </a>
            </div>
          ) : (
            <form className="form-stack motion-in" onSubmit={handleSubmit}>
              <p className="form-intro">Digite sua nova senha abaixo.</p>

              <label>
                Nova senha
                <span className="password-field">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    <PasswordVisibilityIcon visible={showPassword} />
                  </button>
                </span>
              </label>

              <label>
                Confirme a nova senha
                <span className="password-field">
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? "Ocultar senha" : "Mostrar senha"}>
                    <PasswordVisibilityIcon visible={showConfirm} />
                  </button>
                </span>
              </label>

              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar nova senha"}
              </button>

              {message && <p className="status-message">{message}</p>}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
