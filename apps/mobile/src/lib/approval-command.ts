import { z } from 'zod';
import { workflowCommand,type ApprovalWorkflow } from '../../../../shared/advanced-approval-contract';
import type { createDraftStore } from './draft-store';
export type Command=z.infer<typeof workflowCommand>;
export const approvalCommandKey=(actor:string,quote:string)=>`draft.v1.approval.${actor}.${quote}`;
const savedCommand=z.object({version:z.literal(1),actor:z.uuid(),quote:z.uuid(),command:workflowCommand}).strict();
type Store=ReturnType<typeof createDraftStore>;
export async function persistApprovalCommand(store:Store,actor:string,quote:string,command:Command){
 const value=savedCommand.parse({version:1,actor,quote,command}),key=approvalCommandKey(actor,quote);
 await store.write(key,value);
 const read=await store.read(key,savedCommand);
 if(JSON.stringify(read)!==JSON.stringify(value))throw Error('La reprise de cette commande n’a pas pu être enregistrée. Aucun envoi n’a été effectué.');
}
export async function restoreApprovalCommand(store:Store,actor:string,quote:string){
 const value=await store.read(approvalCommandKey(actor,quote),savedCommand);
 if(value&&(value.actor!==actor||value.quote!==quote))throw Error('La commande enregistrée ne correspond pas à ce compte et à ce devis.');
 return value?.command??null;
}
export function allowedWorkflowActions(status:ApprovalWorkflow):Command['action'][] {
 return [...(status.permissions.can_submit?['submit' as const]:[]),...(status.permissions.can_decide&&status.workflow?.state==='pending'?['approve' as const,'reject' as const,'request_information' as const]:[]),...(status.permissions.can_respond&&status.workflow?.state==='changes_requested'?['respond' as const]:[])];
}
