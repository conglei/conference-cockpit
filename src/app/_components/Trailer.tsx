"use client";

import { useState } from "react";

/* ----------------------------------------------------------------
   Serializable shapes — the server pre-renders chip strings so this
   client bundle never imports the plan/provenance engine.
   ---------------------------------------------------------------- */
export type CardData = {
  rank: number;
  name: string;
  domain: string | null;
  whyLine: string;
  score: number;
  claims: { label: string; text: string; chip: string; thin: boolean }[];
  whoToMeet: {
    name: string;
    title: string | null;
    linkedinUrl: string | null;
    speaking: boolean;
    slot: string | null;
  }[];
  openRoles: { title: string; url: string | null }[];
  opener: string;
};

type DirEntry = { name: string; title: string | null };

/** The one question that produces everything below. */
const ASK = "Who should I meet at AIE 2026, and why?";

export default function Trailer({
  cards,
  directory,
  directoryCount,
}: {
  cards: CardData[];
  directory: DirEntry[];
  directoryCount: number;
}) {
  // Trust-as-interaction: hide every source chip to watch the claims go naked.
  const [showSources, setShowSources] = useState(true);

  return (
    <div className="trailer">
      <Hero cards={cards} directory={directory} directoryCount={directoryCount} />
      <AgentMoment />
      <PlanSection
        cards={cards}
        showSources={showSources}
        setShowSources={setShowSources}
      />
      <TrustSection />
      <IdeasSection />
      <ForkSection />
    </div>
  );
}

/* ================================================================
   1 — Hero: the 488 → 8 contrast, the whole pitch in one screen
   ================================================================ */
function Hero({
  cards,
  directory,
  directoryCount,
}: {
  cards: CardData[];
  directory: DirEntry[];
  directoryCount: number;
}) {
  return (
    <section className="t-hero">
      <div className="t-hero-copy">
        <span className="t-eyebrow">AI Engineer World&apos;s Fair 2026 · Career Mover lens</span>
        <h1 className="t-title">
          <span className="t-strike">{directoryCount} names.</span>
          <br />
          <span className="t-accent-grad">{cards.length} you should meet.</span>
        </h1>
        <p className="t-lede">
          A 500-person conference hands you a flat directory and a schedule grid.
          Conference Compass turns it into a goal-ranked, <strong>sourced</strong>{" "}
          plan — who to meet, the fit thesis, and how to open it — in the time it
          takes to ask your agent.
        </p>
        <div className="t-cta-row">
          <a className="t-btn t-btn-primary" href="#plan">
            See the 8 targets
          </a>
          <a className="t-btn t-btn-ghost" href="#fork">
            Fork it for your conference
          </a>
        </div>
        <ul className="t-statline">
          <li><b>297</b> companies</li>
          <li><b>488</b> speakers</li>
          <li><b>552</b> talks</li>
          <li><b>2,373</b> open roles</li>
        </ul>
      </div>

      <div className="t-contrast" aria-hidden="true">
        <div className="t-contrast-before">
          <span className="t-col-label">the raw directory</span>
          <ol className="t-raw-names">
            {directory.slice(0, 80).map((p, i) => (
              <li key={i}>
                {p.name}
                {p.title ? <span className="t-raw-title"> · {p.title}</span> : null}
              </li>
            ))}
          </ol>
          <div className="t-raw-fade" />
        </div>
        <div className="t-contrast-arrow">→</div>
        <div className="t-contrast-after">
          <span className="t-col-label accent">your plan</span>
          {cards.slice(0, 4).map((c) => (
            <div className="t-mini-card" key={c.rank}>
              <span className="t-mini-rank">{c.rank}</span>
              <span className="t-mini-name">{c.name}</span>
              <span className="t-mini-score">{c.score}</span>
            </div>
          ))}
          <div className="t-mini-more">+ {cards.length - 4} more, each sourced</div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================
   2 — The agent moment (honest: the real command, copyable)
   ================================================================ */
function AgentMoment() {
  return (
    <section className="t-section t-agent">
      <div className="t-section-head">
        <span className="t-kicker">Agent-native</span>
        <h2>You didn&apos;t scroll 488 names. You asked.</h2>
        <p className="t-section-lede">
          Conference Compass is a set of Claude Code skills over a small engine —
          not a walled app. The plan below came from one sentence. Run it yourself.
        </p>
      </div>

      <div className="t-terminal">
        <div className="t-terminal-bar">
          <span className="t-dot" />
          <span className="t-dot" />
          <span className="t-dot" />
          <span className="t-terminal-title">claude code · /plan-conference</span>
        </div>
        <div className="t-terminal-body">
          <p className="t-line">
            <span className="t-prompt">you ▸</span> {ASK}
          </p>
          <p className="t-line t-dim">
            <span className="t-prompt accent">compass ▸</span> running{" "}
            <code>plan-conference</code> → <code>pnpm conf-plan</code>
          </p>
          <p className="t-line t-dim">
            <span className="t-prompt accent" /> ranked 297 companies through your
            taste · resolved founders &amp; funding · stamped every claim
          </p>
          <p className="t-line t-ok">
            <span className="t-prompt accent" /> ✓ 8-company plan ready ↓
          </p>
        </div>
      </div>

      <div className="t-cmd-row">
        <CopyInline label="Terminal" cmd="pnpm conf-plan" />
        <CopyInline label="Claude Code" cmd="/plan-conference" />
      </div>
    </section>
  );
}

/* ================================================================
   3 — The plan (the payload) with the interactive Sources toggle
   ================================================================ */
function PlanSection({
  cards,
  showSources,
  setShowSources,
}: {
  cards: CardData[];
  showSources: boolean;
  setShowSources: (v: boolean) => void;
}) {
  return (
    <section className="t-section" id="plan">
      <div className="t-section-head">
        <span className="t-kicker">The plan</span>
        <h2>8 ranked companies, every claim sourced.</h2>
        <p className="t-section-lede">
          Each target carries a fit thesis, who to meet (with their talk slot), the
          open roles, and a copy-ready opener.
        </p>
        <label className="t-toggle">
          <input
            type="checkbox"
            checked={showSources}
            onChange={(e) => setShowSources(e.target.checked)}
          />
          <span className="t-toggle-track" aria-hidden="true">
            <span className="t-toggle-thumb" />
          </span>
          <span className="t-toggle-label">
            {showSources ? "Sources on" : "Sources off"}
            <span className="t-toggle-hint">
              {showSources
                ? " — every claim wears where it came from"
                : " — this is what a scraper gives you. Trust nothing."}
            </span>
          </span>
        </label>
      </div>

      <div className="t-cards" data-sources={showSources}>
        {cards.map((c) => (
          <TrailerCard key={c.rank} c={c} showSources={showSources} />
        ))}
      </div>
    </section>
  );
}

function TrailerCard({ c, showSources }: { c: CardData; showSources: boolean }) {
  return (
    <article className="company-card t-card">
      <div className="card-head">
        <span className="rank">{c.rank}</span>
        <div className="card-title">
          <h3>
            {c.name}
            {c.domain ? (
              <a
                className="domain"
                href={`https://${c.domain}`}
                target="_blank"
                rel="noreferrer"
              >
                {c.domain} ↗
              </a>
            ) : null}
          </h3>
          <p className="why">{c.whyLine}</p>
        </div>
        <span className="score" title="Career Mover fit score">
          {c.score}
        </span>
      </div>

      {c.claims.length ? (
        <ul className="claims">
          {c.claims.map((claim, i) => (
            <li key={i}>
              <span className="claim-label">{claim.label}</span>
              <span className="claim-text">{claim.text}</span>
              {showSources ? (
                <span className="prov-chip" data-thin={claim.thin}>
                  {claim.chip}
                </span>
              ) : (
                <span className="prov-chip t-chip-naked">unsourced</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {c.whoToMeet.length ? (
        <div className="who">
          <span className="section-label">Who to meet</span>
          <ul>
            {c.whoToMeet.map((p, i) => (
              <li key={i}>
                <span className="who-name">
                  {p.linkedinUrl ? (
                    <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </span>
                {p.title ? <span className="who-title"> · {p.title}</span> : null}
                {p.speaking && p.slot ? (
                  <span className="speaking">
                    <MicIcon />
                    {p.slot}
                  </span>
                ) : (
                  <span className="attending">attending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.openRoles.length ? (
        <div className="roles">
          <span className="section-label">Open roles</span>
          {c.openRoles.map((r, i) => (
            <span key={i} className="role-pill">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              ) : (
                r.title
              )}
            </span>
          ))}
        </div>
      ) : null}

      <div className="opener">
        <span className="section-label">Draft opener</span>
        <p>{c.opener}</p>
        <CopyInline label="Copy opener" cmd={c.opener} compact />
      </div>
    </article>
  );
}

/* ================================================================
   4 — The trust spine
   ================================================================ */
function TrustSection() {
  return (
    <section className="t-section t-trust">
      <div className="t-section-head">
        <span className="t-kicker">Why provenance is a feature</span>
        <h2>Anyone can scrape a list. The hard part is enrichment that survives contact with reality.</h2>
        <p className="t-section-lede">
          We repaired dozens of wrong-identity matches, deduped, resolved funding
          and founder backgrounds, and stamped freshness — so every field renders{" "}
          <em>where it came from</em> and <em>how stale it is</em>. A thin signal is
          labeled and ranked low, never dressed up.
        </p>
      </div>

      <div className="t-repairs">
        {[
          { wrong: "Buster", right: "Dave & Buster's" },
          { wrong: "Day", right: "the LDS Church" },
          { wrong: "Hippocratic", right: "Hippocratic AI" },
        ].map((r) => (
          <div className="t-repair" key={r.wrong}>
            <span className="t-repair-wrong">{r.wrong}</span>
            <span className="t-repair-arrow">→</span>
            <span className="t-repair-right">{r.right}</span>
          </div>
        ))}
      </div>

      <div className="t-chip-anatomy">
        <span className="prov-chip">Apollo · as of 5mo ago</span>
        <span className="t-anatomy-note">source</span>
        <span className="t-anatomy-note right">freshness</span>
        <span className="prov-chip" data-thin="true">taste review · as of today</span>
        <span className="t-anatomy-note thin">thin → ranked low, never hidden</span>
      </div>
    </section>
  );
}

/* ================================================================
   5 — Two nameable ideas
   ================================================================ */
function IdeasSection() {
  return (
    <section className="t-section t-ideas">
      <div className="t-section-head">
        <span className="t-kicker">Two ideas that travel</span>
        <h2>Forkable by design.</h2>
      </div>

      <div className="t-idea-grid">
        <div className="t-idea">
          <h3>Your taste is a markdown file your agent reads</h3>
          <p>
            The ranking is driven by a plain-English, version-controllable goal
            profile — not a hidden embedding. Fork it, diff it, share it.
          </p>
          <pre className="t-code">{`# Taste & Preferences

## The dominant filter — FOUNDER BAR
Only companies whose founders clear a
hard pedigree bar: senior operators from
big-tech / top labs, or serious researchers.

## Domain
Want: agents · applied-AI · AI-native product
Pass: robotics · crypto · vertical SaaS`}</pre>
        </div>

        <div className="t-idea">
          <h3>One graph, pluggable lenses</h3>
          <p>
            A shared conference knowledge graph (people ↔ companies ↔ talks ↔
            openings) with a pluggable lens that re-ranks <em>and re-shapes</em> it
            for one goal. The lens decides even the output shape.
          </p>
          <div className="t-lens-rows">
            <div className="t-lens-row active">
              <span className="t-lens-name">Career Mover</span>
              <span className="t-lens-desc">fit + elite founders + open roles · company-first</span>
              <span className="t-lens-badge">shipped</span>
            </div>
            <div className="t-lens-row">
              <span className="t-lens-name">Recruiter</span>
              <span className="t-lens-desc">recruitability + timing · people-first</span>
              <span className="t-lens-badge ghost">a scorer drop-in</span>
            </div>
            <div className="t-lens-row">
              <span className="t-lens-name">Scout</span>
              <span className="t-lens-desc">stage + pedigree + raise-timing</span>
              <span className="t-lens-badge ghost">a scorer drop-in</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================
   6 — Fork CTA
   ================================================================ */
function ForkSection() {
  return (
    <section className="t-section t-fork" id="fork">
      <div className="t-fork-card">
        <h2>Point it at a conference. Get your plan.</h2>
        <p className="t-section-lede">
          Open source · agent-native · forkable for any event. No API keys needed —
          the demo ships a privacy-safe snapshot.
        </p>
        <pre className="t-code t-quickstart">{`pnpm install
pnpm db:migrate
pnpm seed-demo      # load the AIE 2026 demo snapshot
pnpm conf-plan      # the ranked plan in your terminal
pnpm dev            # this view`}</pre>
        <div className="t-cta-row">
          <a className="t-btn t-btn-primary" href="/companies">
            Explore the underlying graph →
          </a>
        </div>
        <p className="t-fineprint">
          Drafts only — no send path. Public professional data only. Never
          manufacture urgency. <span className="muted">MIT.</span>
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------
   Bits
   ---------------------------------------------------------------- */
function CopyInline({
  label,
  cmd,
  compact,
}: {
  label: string;
  cmd: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <button
      type="button"
      className={`t-copy ${compact ? "compact" : ""}`}
      onClick={onCopy}
    >
      {!compact && <span className="t-copy-label">{label}</span>}
      {!compact && <code className="t-copy-cmd">{cmd}</code>}
      <span className="t-copy-icon">
        {copied ? "✓ copied" : compact ? label : "copy"}
      </span>
    </button>
  );
}

/** Small mic glyph marking a speaker's talk slot (SVG, not emoji). */
function MicIcon() {
  return (
    <svg
      className="mic-icon"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </svg>
  );
}
