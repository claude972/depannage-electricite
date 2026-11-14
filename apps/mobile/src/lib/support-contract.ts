import { z } from 'zod';

const revision = z.number().int().min(1).max(2147483647);
const stamp = z.iso.datetime({ offset: true });
export const supportCommand = z.object({
  request_id: z.uuid(),
  subject: z.string().trim().min(4).max(160).regex(/^[^\u0000]*$/),
  body: z.string().trim().min(10).max(4000).regex(/^[^\u0000]*$/),
  intervention_id: z.uuid().nullable(),
}).strict();
export const supportTicket = z.object({
  id: z.uuid(), creator_id: z.uuid(), intervention_id: z.uuid().nullable(),
  subject: z.string(), status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved']),
  version: revision, created_at: stamp, updated_at: stamp, last_message_at: stamp,
});
export const supportMessage = z.object({
  id: z.uuid(), ticket_id: z.uuid(), author_id: z.uuid(),
  author_kind: z.enum(['user', 'admin', 'operator']), version: revision,
  body: z.string(), created_at: stamp,
});
const receipt = z.object({ ticket: supportTicket, initial_message: supportMessage, replayed: z.boolean() });
/** A successful HTTP response must still identify the exact account, dossier and content sent. */
export function supportReceipt(command: z.infer<typeof supportCommand>, actor: string) {
  const expected = supportCommand.parse(command);
  z.uuid().parse(actor);
  return receipt.refine(value => value.ticket.creator_id === actor &&
    value.ticket.subject === expected.subject && value.ticket.intervention_id === expected.intervention_id &&
    value.initial_message.ticket_id === value.ticket.id && value.initial_message.author_id === actor &&
    value.initial_message.version === 1 && value.initial_message.body === expected.body,
  'La réponse ne confirme pas cette demande. Conservez-la pour une nouvelle tentative identique.');
}
export const supportIntent = z.object({ actor_id: z.uuid(), command: supportCommand }).strict();
export function supportRetry(intent: z.infer<typeof supportIntent>, actor: string, dossier: string | null) {
  const value = supportIntent.parse(intent);
  if (value.actor_id !== actor || value.command.intervention_id !== dossier)
    throw new Error('Cette demande appartient à un autre compte ou dossier.');
  return value.command;
}

export const supportDraft = z.object({
  subject: z.string().max(160), body: z.string().max(4000),
  pending: supportIntent.nullable(), confirmedTicketId: z.uuid().nullable(),
}).strict();
export function supportDraftKey(actor: string, dossier: string | null) {
  return `support-v1.${z.uuid().parse(actor)}.${dossier === null ? 'general' : z.uuid().parse(dossier)}`;
}
/** Clear editable content only when it still matches the confirmed snapshot. */
export function confirmSupportDraft(draft: z.infer<typeof supportDraft>, actor: string, dossier: string | null, result: unknown) {
  const current = supportDraft.parse(draft);
  if (!current.pending) throw new Error('Aucune demande en attente de confirmation.');
  const command = supportRetry(current.pending, actor, dossier);
  const confirmed = supportReceipt(command, actor).parse(result);
  const unchanged = current.subject.trim() === command.subject && current.body.trim() === command.body;
  return { subject: unchanged ? '' : current.subject, body: unchanged ? '' : current.body,
    pending: null, confirmedTicketId: confirmed.ticket.id };
}
