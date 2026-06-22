"use client";

import { useEffect } from "react";

export default function ConnectedPage() {
  useEffect(() => {
    // Após 3s, redireciona para a URL de detecção do sistema — isso fecha o popup automaticamente
    const timer = setTimeout(() => {
      window.location.href = "http://captive.apple.com/hotspot-detect.html";
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
