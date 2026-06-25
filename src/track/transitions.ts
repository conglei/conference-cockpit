import { APPLICATION_STATUS, type ApplicationStatus } from "../db/schema";

/**
 * The application lifecycle (issue 08). The deterministic primitive behind the
 * `track` skill: *what* the legal next stages are. The skill supplies the
 * judgment ("given this signal, advance to X"); this module enforces that the
 * transition is one the pipeline actually allows.
 *
 *   interested → applied → screening → interviewing → offer
 *               ↘ referred ↗
 *
 * `referred` is an alternate entry (a contact got you in the door) that rejoins
 * at `screening`. `rejected` and `withdrawn` are terminal off-ramps reachable
 * from any non-terminal stage. Terminal stages have no forward transitions.
 */
export const TERMINAL_STATUSES = ["rejected", "withdrawn"] as const;

const FORWARD: Record<ApplicationStatus, ApplicationStatus[]> = {
  interested: ["applied", "referred"],
  referred: ["screening"],
  applied: ["screening"],
  screening: ["interviewing"],
  interviewing: ["offer"],
  offer: [],
  rejected: [],
  withdrawn: [],
};

export function isTerminal(status: ApplicationStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isApplicationStatus(v: string): v is ApplicationStatus {
  return (APPLICATION_STATUS as readonly string[]).includes(v);
}

/**
 * The stages you may move to from `from`. Off-ramps (`rejected`/`withdrawn`)
 * are always available from a non-terminal stage; terminal stages are dead ends.
 */
export function allowedTransitions(from: ApplicationStatus): ApplicationStatus[] {
  if (isTerminal(from)) return [];
  return [...FORWARD[from], ...TERMINAL_STATUSES];
}

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return false;
  return allowedTransitions(from).includes(to);
}

/** Throwing guard used by the track flow before it touches the DB. */
export function assertTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (!canTransition(from, to)) {
    const allowed = allowedTransitions(from);
    throw new Error(
      `Illegal status transition: "${from}" → "${to}". ` +
        (allowed.length
          ? `Allowed from "${from}": ${allowed.join(", ")}.`
          : `"${from}" is terminal — no further transitions.`),
    );
  }
}
