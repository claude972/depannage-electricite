import { PublicTabs } from '@/components/mobile-chrome';
import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Action, Card, Copy, Field, Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { apiOrigin } from '@/lib/config';
import {
  COVERAGE_COPY, PUBLIC_PATHS, contactChannels, coveragePath, coverageResult, coverageSchema, isPostalCode, operatorPublicationSchema,
  operatorRows, publishedStamp, publishedState, warrantyTermsSchema, type Channel, type Published, type Row,
} from '@/lib/published-info';
import { releaseLabel } from '@/lib/release';

export default function MobileHelp() {
  const router = useRouter();
  const operatorRead = useResource(PUBLIC_PATHS.operatorProfile, operatorPublicationSchema);
  const warrantyRead = useResource(PUBLIC_PATHS.warrantyTerms, warrantyTermsSchema);
  const operator = publishedState(operatorRead);
  const warranty = publishedState(warrantyRead);
  const profile = operator.phase === 'published' ? operator.value.profile : null;
  return <Screen footer={<PublicTabs />}>
    <Copy kind="title">Comment pouvons-nous vous aider ?</Copy>
    <Card>
      <Copy kind="subtitle">Une intervention en cours ?</Copy>
      <Copy>Utilisez le numéro indiqué dans votre demande pour consulter son avancement.</Copy>
      <Action label="Retrouver mon intervention" onPress={() => router.push('/retrouver')} />
    </Card>

    <CoverageCheck serviceArea={profile?.service_area ?? null} />

    <Card>
      <Copy kind="subtitle">Contact</Copy>
      <Pending state={operator} onRetry={operatorRead.reload}
        failed="Les coordonnées publiées n’ont pas pu être lues. Aucune coordonnée n’est affichée à leur place."
        absent="L’exploitant n’a pas encore publié de coordonnées de contact. Aucune adresse ni aucun numéro n’est affiché à leur place." />
      {profile && <Contact channels={contactChannels(profile)} />}
    </Card>

    <Card>
      <Copy kind="subtitle">Exploitant du service</Copy>
      <Pending state={operator} onRetry={operatorRead.reload}
        failed="Les informations de l’exploitant n’ont pas pu être lues. Aucune information n’est affichée à leur place."
        absent="L’exploitant n’a pas encore publié ses informations légales. Aucune société ni aucun identifiant n’est affiché à leur place." />
      {operator.phase === 'published' && <>
        <Rows rows={operatorRows(operator.value.profile)} />
        <Copy kind="muted">{publishedStamp(operator.value)}</Copy>
      </>}
    </Card>

    <Card>
      <Copy kind="subtitle">Conditions de garantie</Copy>
      <Pending state={warranty} onRetry={warrantyRead.reload}
        failed="Les conditions publiées sont momentanément indisponibles. Aucune garantie n’est déduite de cette indisponibilité."
        absent="Conditions de garantie non encore publiées par l’exploitant. Aucune garantie n’est promise tant qu’elles ne sont pas publiées." />
      {warranty.phase === 'published' && <WarrantyTerms terms={warranty.value} />}
    </Card>

    {apiOrigin && <Action secondary label="Ouvrir le centre d’aide sur le Web" onPress={() => void openBrowserAsync(apiOrigin + '/#help')} />}
    <Copy kind="muted">{releaseLabel(Platform.OS)}</Copy>
  </Screen>;
}

/** Chargement, panne (avec reprise) ou absence de publication : jamais de valeur de remplacement. */
function Pending<T>({ state, failed, absent, onRetry }: { state: Published<T>; failed: string; absent: string; onRetry: () => void }) {
  if (state.phase === 'loading') return <Copy kind="muted">Lecture des informations publiées…</Copy>;
  if (state.phase === 'absent') return <Copy kind="muted">{absent}</Copy>;
  if (state.phase === 'error') return <>
    <Copy kind="error">{failed}</Copy>
    <Action secondary label="Réessayer" onPress={onRetry} />
  </>;
  return null;
}

function Rows({ rows }: { rows: Row[] }) {
  return <>{rows.map(row => <View key={row.label} style={{ gap: 2 }}>
    <Copy kind="label">{row.label}</Copy>
    <Copy>{row.value}</Copy>
  </View>)}</>;
}

function Contact({ channels }: { channels: Channel[] }) {
  const [unopened, setUnopened] = useState<string | null>(null);
  const open = (channel: Channel) => {
    setUnopened(null);
    void Linking.openURL(channel.url).catch(() => setUnopened(channel.value));
  };
  return <>
    <Rows rows={channels} />
    {channels.map(channel => <Action key={channel.label} secondary label={channel.action} onPress={() => open(channel)} />)}
    {unopened && <Copy kind="error">Aucune application de cet appareil n’a pu ouvrir {unopened}. Vous pouvez recopier cette coordonnée.</Copy>}
    {!channels.some(channel => channel.label === 'Téléphone') && <Copy kind="muted">Aucun numéro de téléphone n’est publié.</Copy>}
  </>;
}

function CoverageCheck({ serviceArea }: { serviceArea: string | null }) {
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const read = useResource(checked ? coveragePath(checked) : null, coverageSchema);
  const check = () => {
    if (!isPostalCode(code)) {
      setChecked(null);
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (checked === code) read.reload();
    else setChecked(code);
  };
  const result = checked && read.data ? coverageResult(checked, read.data) : null;
  return <Card>
    <Copy kind="subtitle">Zone desservie</Copy>
    {serviceArea && <View style={{ gap: 2 }}>
      <Copy kind="label">Zone annoncée par l’exploitant</Copy>
      <Copy>{serviceArea}</Copy>
    </View>}
    <Copy>{COVERAGE_COPY.intro}</Copy>
    <Field label="Code postal" value={code} keyboardType="number-pad" inputMode="numeric" maxLength={5} autoComplete="off" returnKeyType="done"
      onSubmitEditing={check}
      onChangeText={value => {
        setCode(value.replace(/\D/g, '').slice(0, 5));
        setChecked(null);
        setInvalid(false);
      }} />
    <Action label={read.loading ? 'Vérification…' : 'Vérifier'} disabled={read.loading} onPress={check} />
    {invalid && <Copy kind="error">{COVERAGE_COPY.invalid}</Copy>}
    {checked && read.error && <Copy kind="error">{COVERAGE_COPY.failed}</Copy>}
    {result && <>
      <Copy kind="label">{result.label}</Copy>
      <Copy>{result.message}</Copy>
      <Copy kind="muted">{COVERAGE_COPY.informative}</Copy>
    </>}
  </Card>;
}

function WarrantyTerms({ terms }: { terms: { version: number; title: string; body: string; published_at: string } }) {
  const [open, setOpen] = useState(false);
  return <>
    <Copy kind="label">{terms.title}</Copy>
    <Copy kind="muted">{publishedStamp(terms)}</Copy>
    {open && <Copy>{terms.body}</Copy>}
    <Action secondary label={open ? 'Masquer les conditions' : `Lire les conditions (version ${terms.version})`} onPress={() => setOpen(value => !value)} />
  </>;
}
