import { useEffect,useState } from 'react';
import { Keyboard,Platform,View } from 'react-native';
import { usePathname,useRouter,type Href } from 'expo-router';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';
import { spaceTabs } from '@/lib/mobile-navigation';
import { MobileTabBar,type Glyph } from './mobile-chrome';
import { WhatsAppContactButton } from './mobile-contact-actions';
import { usePalette } from './ui';
const guest=[{route:'/bienvenue',label:'Accueil',icon:'home'},{route:'/catalogue',label:'Services',icon:'services'},{route:'/retrouver',label:'Activité',icon:'activity'},{route:'/compte',label:'Compte',icon:'account'}] as const;
const names:Record<string,{label:string;icon:Glyph}>={accueil:{label:'Accueil',icon:'home'},interventions:{label:'Demandes',icon:'activity'},profil:{label:'Profil',icon:'account'},messages:{label:'Messages',icon:'messages'},aide:{label:'Aide',icon:'help'},devis:{label:'Devis',icon:'price'},organisations:{label:'Sites',icon:'services'},annuaire:{label:'Annuaire',icon:'account'}};
/** Persistent in every stack destination. Its own layout height reserves space for page CTAs. */
export function GlobalMobileChrome(){
 const router=useRouter(),path=usePathname(),auth=useSession(),state=useWorkspace(true),p=usePalette();
 const [typing,setTyping]=useState(false);
 // Android redimensionne la fenêtre : la barre remonterait au-dessus du clavier, on la retire pendant la saisie.
 // iOS : le clavier la recouvre. La retirer changerait la hauteur des écrans après le calcul de l’inset clavier
 // et laisserait le bouton principal sous le clavier.
 useEffect(()=>{if(Platform.OS==='ios')return;const show=Keyboard.addListener('keyboardDidShow',()=>setTyping(true));const hide=Keyboard.addListener('keyboardDidHide',()=>setTyping(false));return()=>{show.remove();hide.remove();};},[]);
 if(typing||!auth.ready)return null;
 const role=state.data?.profile.role;
 const active=auth.session ? (/^\/(dossier|offre|demande)(\/|$)/.test(path)?'/interventions':/^\/(site|organisation|contrat|approbation)(\/|$)/.test(path)?role==='admin'?'/annuaire':'/organisations':path.startsWith('/annuaire/')?'/annuaire':path) : (/^\/(connexion|inscription|aide-mobile|mot-de-passe-oublie)/.test(path)?'/compte':/^\/(prestation|demande-client)/.test(path)?'/catalogue':path);
 const items=auth.session?spaceTabs(role).map(name=>({route:`/(espace)/${name}`,label:name==='interventions'?(role==='artisan'?'Missions':role==='client'?'Demandes':'Dossiers'):names[name].label,icon:names[name].icon,active:`/${name}`})):guest.map(item=>({...item,active:item.route}));
 return <View style={{backgroundColor:p.background}}>
 {/* Bouton flottant : il ne réserve plus une bande pleine largeur qui masquait le bas des écrans et interceptait les appuis. */}
 {(!auth.session||role==='client')&&<View pointerEvents="box-none" style={{position:'absolute',right:12,bottom:'100%',paddingBottom:2}}><WhatsAppContactButton/></View>}
 <MobileTabBar items={items.map(item=>({label:item.label,icon:item.icon,selected:active===item.active,onPress:()=>router.navigate(item.route as Href)}))}/>
 </View>;
}
