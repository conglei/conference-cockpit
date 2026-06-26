import { getDb } from "@/db/client";
import { createCompanyRepo } from "@/db/repository";
import { createPersonRepo } from "@/db/people-repository";
import { whoNext } from "@/referrers";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

function fmt(v: number): string {
  return v.toFixed(2);
}

export default async function WhoNextPage() {
  const db = getDb();
  const entries = await whoNext(createPersonRepo(db), createCompanyRepo(db));

  return (
    <main>
      <h1>Who next</h1>
      <p className="subtitle">
        {entries.length} warm path{entries.length === 1 ? "" : "s"}, ranked by
        company-fit × connection-strength
      </p>

      {entries.length === 0 ? (
        <p className="empty">
          No contactable referrers yet. Ingest your LinkedIn connections and
          cross-reference a target company&apos;s roster:{" "}
          <code>pnpm find-referrers ingest Connections.csv</code> then{" "}
          <code>pnpm find-referrers cross-ref &lt;slug&gt;</code>.
        </p>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Person</th>
              <th>Company</th>
              <th>Fit</th>
              <th>Degree</th>
              <th>Strength</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.person.id}>
                <td data-axis="active">
                  <strong>{fmt(e.priority)}</strong>
                </td>
                <td>
                  <a href={`/people/${e.person.slug}`}>
                    <strong>{e.person.name}</strong>
                  </a>
                  {e.person.title ? (
                    <div className="muted">{e.person.title}</div>
                  ) : null}
                </td>
                <td>
                  {e.company ? (
                    <a href={`/companies/${e.company.slug}`}>{e.company.name}</a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{fmt(e.companyFit)}</td>
                <td>{e.person.connectionDegree ?? "—"}</td>
                <td>{fmt(e.connectionStrength)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </main>
  );
}
