"use client";

import { useEffect, useMemo, useState } from "react";
import { replaceQuery } from "./url-state";

export type SessionRow = {
  id: number;
  title: string;
  day: string;
  time: string | null;
  startMin: number | null;
  endMin: number | null;
  room: string | null;
  track: string | null;
  speakerName: string | null;
  speakerSlug: string | null;
  companyName: string | null;
  companySlug: string | null;
};

/** Short label for a day pill: "Day 2" from "Day 2 — Session Day 1". */
function dayShort(day: string): string {
  return day.split(/[—-]/)[0].trim();
}
/** Just the start clock for the time rail: "10:45am" from "10:45am-11:05am". */
function startClock(time: string | null): string {
  return time ? time.split(/[-–]/)[0].trim() : "—";
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

  const [day, setDay] = useState<string>(days[0] ?? "");
  const [track, setTrack] = useState<string>("all");
  const [q, setQ] = useState<string>("");

  // A live minute-of-day clock for the "now" marker (refreshes each minute).
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
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
        const hay = `${s.title} ${s.speakerName ?? ""} ${s.companyName ?? ""} ${s.track ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [sessions, day, track, q]);

  const isNow = (s: SessionRow) =>
    nowMin != null &&
    s.startMin != null &&
    s.endMin != null &&
    nowMin >= s.startMin &&
    nowMin < s.endMin;

  const liveCount = rows.filter(isNow).length;

  return (
    <>
      <nav className="filters" aria-label="day">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className="filter"
            data-active={day === d}
            onClick={() => setDay(d)}
          >
            {dayShort(d)}
          </button>
        ))}
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
                    {s.speakerSlug ? (
                      <a className="session-speaker" href={`/people/${s.speakerSlug}`}>
                        {s.speakerName}
                      </a>
                    ) : s.speakerName ? (
                      <span className="session-speaker">{s.speakerName}</span>
                    ) : null}
                    {s.companySlug ? (
                      <a className="session-co" href={`/companies/${s.companySlug}`}>
                        {s.companyName}
                      </a>
                    ) : s.companyName ? (
                      <span className="session-co">{s.companyName}</span>
                    ) : null}
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
