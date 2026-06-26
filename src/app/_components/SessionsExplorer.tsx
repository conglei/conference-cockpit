"use client";

import { useEffect, useMemo, useState } from "react";
import { replaceQuery } from "./url-state";

export type SessionRow = {
  id: number;
  title: string;
  day: string;
  date: string | null;
  time: string | null;
  startMin: number | null;
  endMin: number | null;
  room: string | null;
  track: string | null;
  speakers: { name: string; slug: string }[];
  companies: { name: string; slug: string }[];
};

/** Short label for a day pill: "Day 2" from "Day 2 — Session Day 1". */
function dayShort(day: string): string {
  return day.split(/[—-]/)[0].trim();
}
/** Just the start clock for the time rail: "10:45am" from "10:45am-11:05am". */
function startClock(time: string | null): string {
  return time ? time.split(/[-–]/)[0].trim() : "—";
}
/** ISO "2026-06-29" → "Jun 29". */
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** Local wall-clock date as ISO "YYYY-MM-DD" (no UTC drift). */
function localISO(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Browse the conference agenda. Filter by day / track / text, all in memory and
 * URL-synced. A live "now" marker (current time-of-day, refreshed each minute)
 * flags the slot in progress — the venue's "what's happening right now?".
 */
export default function SessionsExplorer({
  sessions,
}: {
  sessions: SessionRow[];
}) {
  const days = useMemo(
    () => [...new Set(sessions.map((s) => s.day))].sort(),
    [sessions],
  );
  const tracks = useMemo(
    () =>
      [...new Set(sessions.map((s) => s.track).filter(Boolean))].sort() as string[],
    [sessions],
  );

  // Each day's real calendar date (from the server's CONFERENCE_START mapping).
  const dateByDay = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of sessions) if (!m.has(s.day)) m.set(s.day, s.date);
    return m;
  }, [sessions]);

  const [day, setDay] = useState<string>(days[0] ?? "");
  const [track, setTrack] = useState<string>("all");
  const [q, setQ] = useState<string>("");

  // A live wall-clock timestamp for the "now" marker (refreshes each minute).
  const [nowTs, setNowTs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // On mount, jump to the day that IS today (if the conference is in progress).
  useEffect(() => {
    const todayISO = localISO(Date.now());
    const todayDay = [...dateByDay.entries()].find(([, d]) => d === todayISO)?.[0];
    if (todayDay) setDay(todayDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    replaceQuery({
      day: day === days[0] ? undefined : day,
      track: track === "all" ? undefined : track,
      q: q || undefined,
    });
  }, [day, track, q, days]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (day && s.day !== day) return false;
      if (track !== "all" && s.track !== track) return false;
      if (needle) {
        const hay = `${s.title} ${s.speakers.map((p) => p.name).join(" ")} ${s.companies
          .map((c) => c.name)
          .join(" ")} ${s.track ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [sessions, day, track, q]);

  // Live = the real now falls inside this session's date + time window.
  const isNow = (s: SessionRow) => {
    if (nowTs == null || !s.date || s.startMin == null || s.endMin == null) return false;
    const [y, m, d] = s.date.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, s.startMin).getTime();
    const end = new Date(y, m - 1, d, 0, s.endMin).getTime();
    return nowTs >= start && nowTs < end;
  };

  const liveCount = rows.filter(isNow).length;

  // Conference status relative to today: before / during / after.
  const dates = [...dateByDay.values()].filter(Boolean).sort() as string[];
  const status = (() => {
    if (nowTs == null || dates.length === 0) return null;
    const today = localISO(nowTs);
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (today < first) {
      const days = Math.round((Date.parse(first) - Date.parse(today)) / 86_400_000);
      return `Starts ${fmtDate(first)} · in ${days} day${days === 1 ? "" : "s"}`;
    }
    if (today > last) return `Ended ${fmtDate(last)}`;
    return `Live · ${fmtDate(today)}`;
  })();

  return (
    <>
      <nav className="filters sessions-days" aria-label="day">
        {days.map((d) => {
          const today = nowTs != null && dateByDay.get(d) === localISO(nowTs);
          return (
            <button
              key={d}
              type="button"
              className="filter"
              data-active={day === d}
              onClick={() => setDay(d)}
            >
              {dayShort(d)}
              {dateByDay.get(d) ? (
                <span className="day-date"> · {fmtDate(dateByDay.get(d)!)}</span>
              ) : null}
              {today ? <span className="day-today">today</span> : null}
            </button>
          );
        })}
        {status ? <span className="sessions-status">{status}</span> : null}
      </nav>

      <div className="sessions-controls">
        <input
          type="search"
          className="sessions-search"
          placeholder="Search talks, speakers, companies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="search sessions"
        />
        <select
          className="sessions-track"
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          aria-label="filter by track"
        >
          <option value="all">All tracks</option>
          {tracks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="sessions-count">
          {rows.length} session{rows.length === 1 ? "" : "s"}
          {liveCount > 0 ? (
            <>
              {" · "}
              <a className="sessions-live" href="#now">
                ● {liveCount} live now
              </a>
            </>
          ) : null}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No sessions match these filters.</p>
      ) : (
        <ol className="session-list">
          {rows.map((s) => {
            const live = isNow(s);
            return (
              <li
                key={s.id}
                className="session-item"
                data-now={live || undefined}
                id={live ? "now" : undefined}
              >
                <div className="session-time">
                  <span className="session-clock">{startClock(s.time)}</span>
                  {live ? <span className="session-now-tag">● now</span> : null}
                </div>
                <div className="session-body">
                  <h3 className="session-title">{s.title}</h3>
                  <div className="session-meta">
                    {s.speakers.length ? (
                      <span className="session-speakers">
                        {s.speakers.map((p, i) => (
                          <span key={p.slug}>
                            {i > 0 ? <span className="session-sep">, </span> : null}
                            <a className="session-speaker" href={`/people/${p.slug}`}>
                              {p.name}
                            </a>
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {s.companies.map((c) => (
                      <a key={c.slug} className="session-co" href={`/companies/${c.slug}`}>
                        {c.name}
                      </a>
                    ))}
                    {s.room ? <span className="session-room">{s.room}</span> : null}
                    {s.track ? <span className="session-track">{s.track}</span> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
