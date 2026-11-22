import { type PropsWithChildren } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { Copy, ReadState, Screen } from './ui';
/** Display guard only. API authentication and RLS remain authoritative. */
export function ManagementAccess({children,admin=false}:PropsWithChildren<{admin?:boolean}>) {
 const state=useWorkspace(true), role=state.data?.profile.role;
 if(state.loading||state.error)return <Screen top><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/></Screen>;
 if(role!=='admin'&&(admin||role!=='manager'))return <Screen top><Copy kind="title">Accès indisponible</Copy><Copy>Ce parcours est réservé aux comptes autorisés de gestion.</Copy></Screen>;
 return <>{children}</>;
}
