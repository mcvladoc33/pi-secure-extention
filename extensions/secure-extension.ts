/**
 * Secure Extension
 *
 * Global extension that:
 * 1. Hard-blocks access to files/dirs outside the project's working directory
 *    (no confirm override — this is a security boundary, not a suggestion).
 * 2. Before every bash command, and before every write/edit inside the
 *    workspace, shows a 3-option dialog like OpenCode's:
 *      - Allow once        -> runs this one time, asks again next time
 *      - Allow for session -> for bash: auto-allows that exact command
 *                             text for the rest of the session.
 *                           -> for write/edit: auto-allows ALL write/edit
 *                             calls (any file) for the rest of the session.
 *      - Deny               -> blocks the operation
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";

// ---- Workspace root -------------------------------------------------------

function getProjectRoot(ctx?: any): string {
  const fromEnv = process.env.PI_WORKSPACE || process.env.CWD;
  const fromCtx = ctx?.cwd || ctx?.workspaceRoot;
  const root = fromEnv || fromCtx || process.cwd();
  return path.resolve(root);
}

// Cross-platform, case-insensitive-on-Windows containment check.
function isPathWithinProject(targetPath: string, projectRoot: string): boolean {
  const absTarget = path.resolve(projectRoot, targetPath);
  const relative = path.relative(projectRoot, absTarget);

  if (relative === "") return true; // exact match = project root itself

  const normalizedRelative =
    process.platform === "win32" ? relative.toLowerCase() : relative;

  return !normalizedRelative.startsWith("..") && !path.isAbsolute(relative);
}

// ---- Dangerous-command detection (cosmetic: just makes the dialog louder) --

const dangerousCommandPatterns: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf / -fr in any order
  /\brm\s+/i,
  /\bmv\s+/i,
  /\bsudo\b/i,
  /\bchown\b/i,
  /\bchmod\b/i,
  /\bdd\s+if=/i,
  /\btruncate\b/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
];

function isDangerousCommand(command: string): boolean {
  return dangerousCommandPatterns.some((pattern) => pattern.test(command));
}

// ---- Shared 3-option dialog helper -----------------------------------------

const OPTION_ONCE = "Allow once";
const OPTION_SESSION = "Allow for this session";
const OPTION_DENY = "Deny";

type Decision = "once" | "session" | "deny";

async function askPermission(ctx: any, title: string): Promise<Decision> {
  if (!ctx.hasUI) {
    // No UI to confirm with — fail safe and block rather than run blind.
    return "deny";
  }
  const choice = await ctx.ui.select(title, [OPTION_ONCE, OPTION_SESSION, OPTION_DENY]);
  if (choice === OPTION_SESSION) return "session";
  if (choice === OPTION_ONCE) return "once";
  return "deny"; // covers explicit Deny and dialog dismissed/cancelled
}

// ---- Extension --------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let projectRoot: string = getProjectRoot();

  // bash: still tracked per exact command text.
  const allowedCommandsForSession = new Set<string>();

  // write/edit: blanket flag — once granted, applies to ANY file for the
  // rest of the session (this is what makes it "not weird" per-file).
  let writeEditAllowedForSession = false;

  pi.on("session_start", async (event, ctx) => {
    projectRoot = getProjectRoot(ctx);
    allowedCommandsForSession.clear();
    writeEditAllowedForSession = false;
    ctx.ui.setStatus("secure-ext", `Workspace: ${projectRoot}`);
  });

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;
    const { path: targetPath, command } = input;

    // --- File access: read / write / edit — hard block outside workspace ---
    if ((toolName === "read" || toolName === "write" || toolName === "edit") && targetPath) {
      if (!isPathWithinProject(targetPath, projectRoot)) {
        ctx.ui.notify(
          `Blocked ${toolName}: "${targetPath}" is outside the workspace (${projectRoot})`,
          "error"
        );
        return { block: true, reason: `Path is outside workspace: ${projectRoot}` };
      }
    }

    // --- write / edit inside the workspace: same 3-option dialog ---
    if ((toolName === "write" || toolName === "edit") && targetPath) {
      if (writeEditAllowedForSession) {
        return undefined;
      }

      const absPath = path.resolve(projectRoot, targetPath);
      const title = `${toolName === "write" ? "Write" : "Edit"} file?\n${absPath}`;
      const decision = await askPermission(ctx, title);

      if (decision === "session") {
        writeEditAllowedForSession = true; // blanket, any file, rest of session
        return undefined;
      }
      if (decision === "once") {
        return undefined;
      }
      ctx.ui.notify(`${toolName} blocked by user: ${absPath}`, "warning");
      return { block: true, reason: `${toolName} blocked by user` };
    }

    // --- Bash: 3-option confirmation dialog before every command ---
    if (toolName === "bash" && command) {
      if (allowedCommandsForSession.has(command)) {
        return undefined;
      }

      const dangerous = isDangerousCommand(command);
      const title = dangerous
        ? `⚠️ Potentially destructive command:\n${command}`
        : `Run command?\n${command}`;

      const decision = await askPermission(ctx, title);

      if (decision === "session") {
        allowedCommandsForSession.add(command);
        return undefined;
      }
      if (decision === "once") {
        return undefined;
      }
      ctx.ui.notify("Command blocked by user", "warning");
      return { block: true, reason: "Command blocked by user" };
    }

    return undefined;
  });
}
