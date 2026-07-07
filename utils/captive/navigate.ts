// No iOS, o WebView do portal cativo (Captive Network Assistant) é destruído quando o
// usuário troca de app (ex: abre o app do banco pra pagar um PIX) — isso mata qualquer
// polling/sessionStorage em andamento. "x-safari-https://" força o iOS a abrir a URL no
// Safari de verdade, que sobrevive à troca de app, evitando perder o cadastro/pagamento.
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isInCaptivePortal(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("captive_mac="));
}

export function captiveNavigate(url: string) {
  if (isInCaptivePortal() && isIOS()) {
    const absolute = new URL(url, window.location.origin).href;
    window.location.href = absolute.replace(/^https:\/\//, "x-safari-https://");
    return;
  }
  window.location.href = url;
}
