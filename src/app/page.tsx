import { getDb } from "@/db/client";
import type { Company } from "@/db/schema";
import { planWhoToMeet, OBJECTIVES } from "@/plan";
import Avatar from "./_components/Avatar";

// Read the graph + profile at request time so a re-enrich shows up on refresh.
export const dynamic = "force-dynamic";

function companyMeta(c: Company | undefined): string[] {
  if (!c) return [];
  return [c.stage, c.sizeBand, c.fundingTotal ?? c.latestAmount ?? c.latestRound].filter(
    (x): x is string => Boolean(x),
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const intent = sp.intent ?? "career-mover";
  const vertical = sp.vertical || undefined;
  const speakingOnly = sp.speaking === "1";
  const savedOnly = sp.saved === "1";

  const {
    people: ranked,
    companies: byId,
    savedIds,
    verticals,
    totalPeople,
    objective,
  } = await planWhoToMeet(getDb(), { intent, vertical, speakingOnly, savedOnly });

  return (
    <main className="wtm">
      <style>{CSS}</style>

      <header className="wtm-head">
        <h1>Who to meet</h1>
        <p className="wtm-tagline">
          {totalPeople} people across {verticals.length} verticals — ranked for{" "}
          <strong>{objective.label}</strong>
          {vertical ? (
            <>
              {" "}
              in <strong>{vertical}</strong>
            </>
          ) : null}
          . Who, where, and why.
        </p>
      </header>

      <form className="wtm-filters" method="get">
        <label>
          Intent
          <select name="intent" defaultValue={intent}>
            {Object.values(OBJECTIVES).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vertical
          <select name="vertical" defaultValue={vertical ?? ""}>
            <option value="">All verticals</option>
            {verticals.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="wtm-check">
          <input type="checkbox" name="speaking" value="1" defaultChecked={speakingOnly} />
          Speaking only
        </label>
        <label className="wtm-check">
          <input type="checkbox" name="saved" value="1" defaultChecked={savedOnly} />
          ★ Saved{savedIds.size ? ` (${savedIds.size})` : ""}
        </label>
        <button type="submit">Apply</button>
      </form>

      {ranked.length === 0 ? (
        <p className="empty">No people match these filters.</p>
      ) : (
        <ol className="wtm-list">
          {ranked.map((p) => {
            const company = p.companyId != null ? byId.get(p.companyId) : undefined;
            const meta = companyMeta(company);
            return (
              <li key={p.personId} className="wtm-card">
                <Avatar name={p.name} src={p.photoUrl} size={48} />

                <div className="wtm-body">
                  <div className="wtm-line1">
                    {savedIds.has(p.personId) ? (
                      <span className="wtm-saved" title="Saved to your who-to-meet list">
                        ★
                      </span>
                    ) : null}
                    <a className="wtm-name" href={`/people/${p.slug}`}>
                      {p.name}
                    </a>
                    {company ? (
                      <a className="wtm-co" href={`/companies/${company.slug}`}>
                        {p.currentCompany ?? company.name}
                      </a>
                    ) : p.currentCompany ? (
                      <span className="wtm-co">{p.currentCompany}</span>
                    ) : null}
                    <span className="wtm-score" title="match score">
                      {p.score.toFixed(2)}
                    </span>
                  </div>

                  {p.headline ? <div className="wtm-headline">{p.headline}</div> : null}

                  {meta.length || p.verticals.length ? (
                    <div className="wtm-chips">
                      {meta.map((m) => (
                        <span key={m} className="wtm-chip wtm-chip-co">
                          {m}
                        </span>
                      ))}
                      {p.verticals.slice(0, 2).map((v) => (
                        <span key={v} className="wtm-chip wtm-chip-vert">
                          {v}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* The why-line is the pedigree/contributions summary; don't
                      repeat it as chips. Warm-path (shared connections) is a
                      distinct signal, so it keeps its chips. */}
                  {p.whyLine ? <div className="wtm-why">{p.whyLine}</div> : null}

                  {p.warmPath.shared.length ? (
                    <div className="wtm-chips">
                      {p.warmPath.shared.map((d) => (
                        <span key={d} className="wtm-chip wtm-chip-warm">
                          {d}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {p.talk ? (
                    <div className="wtm-where">
                      <span className="wtm-where-when">
                        {[p.talk.day, p.talk.time].filter(Boolean).join(" · ")}
                      </span>
                      {p.talk.room ? <span className="wtm-where-room">{p.talk.room}</span> : null}
                      {p.talk.title ? <span className="wtm-where-talk">“{p.talk.title}”</span> : null}
                    </div>
                  ) : (
                    <div className="wtm-where wtm-where-none">Not speaking — reach out directly</div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

const CSS = `
.wtm { max-width: 900px; }
.wtm-head h1 { margin: 0 0 .25rem; }
.wtm-tagline { color: var(--muted); margin: 0 0 1.25rem; font-size: .95rem; }
.wtm-filters { display:flex; flex-wrap:wrap; gap:.7rem; align-items:flex-end; margin:0 0 1.5rem; padding-bottom:1.25rem; border-bottom:1px solid var(--border); }
.wtm-filters label { display:flex; flex-direction:column; gap:.3rem; font-size:.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.wtm-filters .wtm-check { flex-direction:row; align-items:center; gap:.4rem; text-transform:none; letter-spacing:0; font-size:.85rem; color:var(--fg); }
.wtm-filters select, .wtm-filters button { font:inherit; padding:.4rem .6rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); color:var(--fg); }
.wtm-filters button { cursor:pointer; background:var(--surface-2); font-size:.85rem; font-weight:600; }
.wtm-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.6rem; }
.wtm-card { display:flex; gap:.85rem; padding:.85rem 1rem; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); transition:border-color .15s ease, background-color .15s ease, box-shadow .15s ease, transform .15s ease; animation: cc-fade-up .42s cubic-bezier(.22,1,.36,1) both; }
.wtm-card:hover { border-color:var(--border-strong); background:var(--surface-2); box-shadow:var(--shadow-md); transform:translateY(-1px); }
.wtm-list > li:nth-child(1) .wtm-card{animation-delay:.02s}
.wtm-list > li:nth-child(2) .wtm-card{animation-delay:.05s}
.wtm-list > li:nth-child(3) .wtm-card{animation-delay:.08s}
.wtm-list > li:nth-child(4) .wtm-card{animation-delay:.11s}
.wtm-list > li:nth-child(5) .wtm-card{animation-delay:.14s}
.wtm-list > li:nth-child(6) .wtm-card{animation-delay:.17s}
.wtm-list > li:nth-child(7) .wtm-card{animation-delay:.2s}
.wtm-list > li:nth-child(n+8) .wtm-card{animation-delay:.22s}
.wtm-body { min-width:0; display:flex; flex-direction:column; gap:.4rem; flex:1; }
.wtm-line1 { display:flex; align-items:baseline; gap:.5rem; flex-wrap:wrap; }
.wtm-saved { color:#f59e0b; font-size:.95rem; line-height:1; }
.wtm-name { font-weight:600; font-size:1rem; color:var(--fg); text-decoration:none; }
.wtm-name:hover { text-decoration:underline; }
.wtm-co { font-size:.85rem; color:var(--muted); text-decoration:none; }
.wtm-co:hover { color:var(--fg); }
.wtm-score { margin-left:auto; font-size:.8rem; color:var(--muted); font-variant-numeric:tabular-nums; }
.wtm-headline { font-size:.82rem; color:var(--muted); }
.wtm-why { font-size:.88rem; color:var(--fg); }
.wtm-chips { display:flex; flex-wrap:wrap; gap:.35rem; }
.wtm-chip { font-size:.72rem; padding:.1rem .5rem; border-radius:999px; background:var(--surface-2); border:1px solid var(--border); color:var(--muted); }
.wtm-chip-warm { color:var(--fg); border-color:var(--border-strong); }
.wtm-chip-vert { background:transparent; }
.wtm-chip-co { font-variant-numeric:tabular-nums; }
.wtm-where { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; font-size:.8rem; margin-top:.15rem; padding-top:.45rem; border-top:1px dashed var(--border); }
.wtm-where-when { font-weight:600; color:var(--fg); }
.wtm-where-room { font-size:.72rem; padding:.05rem .45rem; border-radius:4px; background:var(--surface-2); border:1px solid var(--border); color:var(--muted); }
.wtm-where-talk { color:var(--muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.wtm-where-none { color:var(--muted); font-style:italic; border-top-color:transparent; }
`;
