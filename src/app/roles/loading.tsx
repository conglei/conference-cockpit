/** Instant skeleton while the (dynamic) roles page queries the DB. */
export default function Loading() {
  return (
    <main>
      <div className="skeleton sk-title" />
      <div className="skeleton sk-sub" />
      <div>
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="skeleton sk-row" />
        ))}
      </div>
    </main>
  );
}
