import type { NextPageContext } from "next";
import Link from "next/link";

type ErrorPageProps = {
  statusCode?: number;
};

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main style={styles.page}>
      <div>
        <h1 style={styles.title}>Noget gik galt</h1>
        <p style={styles.text}>
          {statusCode
            ? `Siden kunne ikke indlaeses korrekt. Fejlkode: ${statusCode}.`
            : "Siden kunne ikke indlaeses korrekt."}
        </p>
      </div>
      <Link href="/" style={styles.link}>
        Til forsiden
      </Link>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;

  return { statusCode };
};

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
  link: {
    background: "#111827",
    border: "1px solid #111827",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 14px",
    textDecoration: "none",
  },
} satisfies Record<string, React.CSSProperties>;
