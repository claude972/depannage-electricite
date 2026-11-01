// Display name from the REAL profile (FASTSPLIT-CLIENT-ADDRESS-NAME-001). Live: only
// `profile.full_name`, never a demo name; the database default « Mon compte » (sign-up without a
// name) is a placeholder, not a first name. Demo: the demo profile, else the demo cast name.
import type { Session } from "./session-types";

type Role = Session["role"];

/** Neutral account label used when no real name is known (same as the database default). */
export const ACCOUNT_LABEL = "Mon compte";
const PLACEHOLDERS = new Set(["mon compte", "bienvenue"]);

export function realName(fullName: string | null | undefined): string | null {
  const name = (fullName ?? "").replace(/\s+/g, " ").trim();
  return name && !PLACEHOLDERS.has(name.toLowerCase()) ? name : null;
}

export function resolveDisplayName(
  mode: "live" | "demo",
  role: Role,
  profile: { role?: Role | null; full_name?: string | null } | null,
  demoNames: Record<Role, string>,
): { displayName: string; firstName: string | null } {
  const name =
    mode === "demo" ? (profile?.role === role ? realName(profile?.full_name) : null) ?? demoNames[role] : realName(profile?.full_name);
  return { displayName: name ?? ACCOUNT_LABEL, firstName: name ? name.split(" ")[0] : null };
}
