import { join } from "node:path";
import { sessionsPath } from "../../core/utils/paths.js";

/** Persisted ACP sessions (metadata + message snapshots for list/load). */
export const acpSessionsRootPath = () => join(sessionsPath(), "acp");
