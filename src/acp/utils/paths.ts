import { join } from "node:path";
import { basePath } from "../../core/utils/paths.js";

/** Persisted ACP sessions (metadata + message snapshots for list/load). */
export const acpSessionsRootPath = () => join(basePath(), "acp-sessions");
