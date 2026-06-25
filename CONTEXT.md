# Conference Cockpit

A goal-conditioned navigator for a conference: you declare your goal and context,
and it tells you **who to meet, when, why, and how**. The people graph is what it
navigates; meeting a person is the atomic action it optimizes for.

## Language

**Person**:
Someone at the conference you might meet — the atomic unit the system ranks and
plans around (see ADR-0004).
_Avoid_: lead, contact (as the unit)

**Company**:
A Person's employer — an *attribute* of a Person and a dimension you filter or
group by. Never the atomic unit.
_Avoid_: account, org (as the unit)

**Intent**:
The user's goal for this conference, stated in plain language — the objective every
Person is ranked against (e.g. "find my next role", "hire two founding engineers",
"understand healthcare AI").
_Avoid_: preference, query

**Scratchpad**:
The free-form input surface where the user dumps who they are and what they want;
the agent structures it into Slots. The input layer, distinct from the ranking
engine.
_Avoid_: profile, form

**Slot**:
A structured field of the Scratchpad — one of: *Who I am*, *What I want* (the
Intent), *Constraints*, *Watchlist*, *Anti-targets*, *Network*, *Encounters*.

**Lens**:
A scoring-and-shaping objective applied to the people graph for one Intent. It
decides who ranks and how the result is shaped.
_Avoid_: filter, mode

**Persona**:
A recurring shape of Intent + specialized Slots — Career Mover, Recruiter, Founder,
Investor, Seller, Learner. Personas share one people graph and one engine; they are
not separate apps.
_Avoid_: user type, role

**Plan**:
The ranked list of people to meet, each with the context to act (company, talk
slot, why-meet, warm path, opener). A planned entry is a **PlannedPerson**.
_Avoid_: results, list

**Warm path**:
A person-to-person route to a meeting — a mutual connection, a possible referral,
or a shared background (same past employer or school).
_Avoid_: intro path

**Watchlist**:
People, companies, or talks the user has already flagged as worth meeting — seeds
the plan boosts and semantically expands.
_Avoid_: favorites, saved

**Encounter**:
A logged in-person meeting at the event; it advances the follow-up funnel
(met → contacted → replied).
_Avoid_: touchpoint, meeting
