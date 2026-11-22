// Delegated payer selector: two members may share a display name. The label adds the member's role
// and, when name + role are still identical, a short reference — the owner always knows whom he
// designates. Only data the organisation overview already returns (no e-mail is exposed there).
export type PayerMemberSource = { user_id: string; full_name?: string | null; role?: string | null };

export function payerMemberLabels(members: PayerMemberSource[], roleLabels: Record<string, string>): { id: string; label: string }[] {
  const base = members.map((m) => {
    const name = m.full_name?.trim() || `Membre ${m.user_id.slice(0, 8)}`;
    const role = m.role ? roleLabels[m.role] ?? null : null;
    return { id: m.user_id, label: role ? `${name} — ${role}` : name };
  });
  const count = new Map<string, number>();
  for (const m of base) count.set(m.label, (count.get(m.label) ?? 0) + 1);
  return base.map((m) => ((count.get(m.label) ?? 0) > 1 ? { id: m.id, label: `${m.label} (réf. ${m.id.slice(0, 8)})` } : m));
}
