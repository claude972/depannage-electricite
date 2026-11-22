import { View } from 'react-native';
import { PublicTabs } from '@/components/mobile-chrome';
import { PublicLink, usePublicPortal } from '@/components/mobile-public-content';
import { Action, Card, Copy, Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { PUBLIC_PATHS, operatorIdentityRows, operatorPublicationSchema, publishedStamp, publishedState, validatedServiceArea } from '@/lib/published-info';

const paragraphs = (value: string) => value.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);

/** PUB-09 : mêmes rubriques que la page « À propos » du Web. Seules les valeurs publiées sont affichées. */
export default function About() {
  const { openPortal, portalError } = usePublicPortal();
  const read = useResource(PUBLIC_PATHS.operatorProfile, operatorPublicationSchema);
  const operator = publishedState(read);
  const profile = operator.phase === 'published' ? operator.value.profile : null;
  const settled = operator.phase === 'published' || operator.phase === 'absent';
  const area = validatedServiceArea(profile);
  return <Screen footer={<PublicTabs />}>
    <Copy kind="title">À propos de l’application</Copy>
    <Copy>Une application de dépannage électrique en Martinique. Cette page décrit ce qu’elle fait, pas plus.</Copy>
    <Card>
      <Copy kind="subtitle">Ce que fait l’application</Copy>
      <Copy>Mettre en relation une personne confrontée à une panne électrique et un artisan électricien, avec un parcours lisible : description du problème, estimation indicative, attribution d’un artisan, devis, intervention, puis règlement.</Copy>
      <Copy kind="muted">Pour les particuliers ; les artisans électriciens ; les entreprises clientes qui gèrent plusieurs sites (copropriétés, restauration, bureaux, établissements recevant du public) ; et l’exploitant de la plateforme, qui examine les dossiers artisans et supervise les interventions.</Copy>
    </Card>
    {operator.phase === 'loading' && <Copy kind="muted">Lecture des informations publiées…</Copy>}
    {operator.phase === 'error' && <Card>
      <Copy kind="error">Les informations publiées par l’exploitant n’ont pas pu être lues. Aucune présentation n’est affichée à leur place.</Copy>
      <Action secondary label="Réessayer" onPress={read.reload} />
    </Card>}
    <Card>
      <Copy kind="subtitle">Présentation de l’exploitant</Copy>
      {profile?.display_name && <Copy kind="label">{profile.display_name}</Copy>}
      {profile?.about_text ? paragraphs(profile.about_text).map((part, index) => <Copy key={index}>{part}</Copy>)
        : settled && <Copy kind="muted">La présentation de l’exploitant n’est pas encore publiée. Aucun texte n’est affiché à sa place.</Copy>}
    </Card>
    <Card>
      <Copy kind="subtitle">Exploitant du service</Copy>
      {operatorIdentityRows(profile).map(row => <View key={row.label} style={{ gap: 2 }}>
        <Copy kind="label">{row.label}</Copy>
        <Copy selectable>{row.value}</Copy>
      </View>)}
      {area && <View style={{ gap: 2 }}><Copy kind="label">Zone annoncée par l’exploitant</Copy><Copy>{area}</Copy></View>}
      {operator.phase === 'published' && <Copy kind="muted">{publishedStamp(operator.value)}</Copy>}
    </Card>
    <Card>
      <Copy kind="subtitle">L’équipe</Copy>
      {profile?.team_text ? paragraphs(profile.team_text).map((part, index) => <Copy key={index}>{part}</Copy>)
        : settled && <Copy kind="muted">La présentation de l’équipe n’est pas encore publiée par l’exploitant. Aucun nom, effectif ni chiffre n’est affiché à sa place.</Copy>}
    </Card>
    <PublicLink label="Lire la page À propos sur le site" onPress={() => openPortal('/#about')} />
    {portalError && <Copy kind="error">{portalError}</Copy>}
  </Screen>;
}
