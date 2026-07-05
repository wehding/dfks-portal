"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  return (
    <html lang="da">
      <body>
        <main style={styles.page}>
          <div>
            <h1 style={styles.title}>Noget gik galt</h1>
            <p style={styles.text}>
              Appen kunne ikke indlaeses korrekt. Proev igen, eller gaa tilbage
              til forsiden.
            </p>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={reset} style={styles.primaryButton}>
              Proev igen
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={styles.secondaryButton}
            >
              Til forsiden
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

const styles = {
  page: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    gap: 16,
    justifyContent: "center",
    minHeight: "100vh",
    padding: 24,
    textAlign: "center",
  },
  title: {
    color: "#111827",
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
  },
  text: {
    color: "#4b5563",
    fontSize: 14,
    lineHeight: 1.5,
    margin: "8px auto 0",
    maxWidth: 420,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  primaryButton: {
    background: "#111827",
    border: "1px solid #111827",
    borderRadius: 8,
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 14px",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    color: "#111827",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 14px",
  },
} satisfies Record<string, React.CSSProperties>;
