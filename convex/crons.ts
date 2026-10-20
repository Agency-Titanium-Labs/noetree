import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// AIF-03: backstop reaper. Every stuck AI reservation is refunded without any
// user action, even if the per-run scheduled expireRun was lost.
crons.interval(
  "refund stale AI runs",
  { minutes: 5 },
  internal.aiRuns.sweepStaleRuns,
  {},
);

// Phase 21: delete expired autocomplete suggestions (and their text).
crons.interval(
  "sweep expired autocomplete suggestions",
  { minutes: 10 },
  internal.aiSuggestions.sweepSuggestions,
  {},
);

export default crons;
