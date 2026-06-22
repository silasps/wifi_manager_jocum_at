"use client";

import { useEffect } from "react";

export default function ConnectedPage() {
  useEffect(() => {
    const timer = setTimeout(() => {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("android")) {
        window.location.href = "http://connectivitycheck.gstatic.com/generate_204";
      } else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("mac")) {
        // No macOS/iOS, redirecionar para a URL de detecção fecha o popup automaticamente.
        // Se estiver no navegador normal, o Apple retorna "Success" e o usuário pode fechar.
        window.location.href = "http://captive.apple.com/hotspot-detect.html";
      } else if (ua.includes("windows")) {
        window.location.href = "http://www.msftconnecttest.com/connecttest.txt";
      } else {
        window.location.href = "https://www.google.com";
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="hotspot-page">
      <div className="hsp-center-card" style={{ textAlign: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>&#10003;</div>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>
          Você está conectado!
        </h1>
        <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: 0 }}>
          Esta janela vai fechar automaticamente.
        </p>
      </div>
    </main>
  );
}
