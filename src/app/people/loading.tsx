/** Instant skeleton while the (dynamic) people page queries the DB. */
export default function Loading() {
  return (
    <main className="dir-main">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-sub" />
      <div className="dir-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton sk-card" />
        ))}
      </div>
    </main>
  );
}
