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

export const supportDetail = z.object({
  ticket: supportTicket,
  messages: z.array(supportMessage),
  events: z.array(z.object({
    id: z.uuid(), ticket_id: z.uuid(), actor_id: z.uuid(),
    kind: z.enum(['ticket_created', 'replied', 'status_changed']),
    from_status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved']).nullable(),
    to_status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved']),
    version: revision, message_id: z.uuid().nullable(), created_at: stamp,
  })),
  permissions: z.object({ can_reply: z.boolean(), can_set_status: z.boolean() }),
  page: z.object({ limit: z.number().int().positive(), after_version: z.number().int().nonnegative(),
    next_after_version: revision.nullable(), has_more: z.boolean(),
    total_events: z.number().int().nonnegative(), total_messages: z.number().int().nonnegative() }),
}).superRefine((value, ctx) => {
  if (value.messages.some(message => message.ticket_id !== value.ticket.id) || value.events.some(event => event.ticket_id !== value.ticket.id))
    ctx.addIssue({ code: 'custom', message: 'Cet historique ne correspond pas à la demande.' });
  if (value.page.has_more !== (value.page.next_after_version !== null) ||
    (value.page.next_after_version !== null && value.page.next_after_version <= value.page.after_version))
    ctx.addIssue({ code: 'custom', message: 'La suite de l’historique est invalide.' });
});
export function supportDetailFor(id: string) {
  z.uuid().parse(id);
  return supportDetail.refine(value => value.ticket.id === id, 'La réponse concerne une autre demande.');
}

export const supportReplyDraft = z.object({
  body: z.string().max(4000),
  pending: z.object({ body: z.string().trim().min(1).max(4000), version: revision }).nullable(),
}).strict();
export function supportReplyReceipt(id: string, actor: string, version: number, body: string) {
  return z.object({ticket:supportTicket,message:supportMessage}).refine(value =>
    value.ticket.id===id && value.ticket.version===version+1 && value.message.ticket_id===id &&
    value.message.author_id===actor && value.message.version===version+1 && value.message.body===body,
    'La réponse envoyée n’a pas pu être confirmée. Actualisez l’historique avant de réessayer.');
}
export function pendingReplyRecorded(data: z.infer<typeof supportDetail>, actor: string, pending: {version:number;body:string}) {
  return data.messages.some(message=>message.author_id===actor&&message.version===pending.version+1&&message.body===pending.body);
}
