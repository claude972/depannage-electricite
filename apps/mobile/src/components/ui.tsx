import { ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions, type ScrollViewInstance, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import type { PropsWithChildren, ReactNode, Ref, ComponentRef } from 'react';

const publicPalette = {
  background: '#FFFFFF', surface: '#FFFFFF', subtle: '#F4F6FA', text: '#111318',
  muted: '#4B5563', border: '#D9DEE7', blue: '#2246E5', primary: '#2246E5',
  accent: '#B93A0A', danger: '#B42318',
};
const darkPalette: typeof publicPalette = {
  background: '#121417', surface: '#22262C', subtle: '#1B1E23', text: '#F5F7FA',
  muted: '#B5BAC4', border: '#343A44', blue: '#8EA2FF', primary: '#2246E5',
  accent: '#FF885F', danger: '#FF9F9F',
};
export const editorial = { navy: '#16277A', yellow: '#F4D649', cards: '#244FB1', white: '#FFFFFF', homeYellow: '#FFCC00', homeInk: '#101B3C' };

export function usePalette() {
  const scheme = useColorScheme();
  const [section] = useSegments();
  const connected = section === '(espace)' || section === 'notifications' || section === 'notification-preferences' || section === 'demande' || section === 'dossier' || section === 'offre' || section === 'organisation' || section === 'site' || section === 'annuaire' || section === 'contrat' || section === 'approbation';
  return connected && scheme === 'dark' ? darkPalette : publicPalette;
}
export function Screen({ children, top=false, footer, scrollRef, refreshing=false, onRefresh }: PropsWithChildren<{ top?: boolean; footer?: ReactNode; scrollRef?: Ref<ScrollViewInstance>; refreshing?: boolean; onRefresh?: () => void }>) {
  const palette = usePalette();
  const [section] = useSegments();
  const edges = top ? ['top','left','right'] as const : ['left','right'] as const;
  return <SafeAreaView edges={footer || section === '(espace)' ? edges : [...edges, 'bottom']} style={[styles.flex,{backgroundColor:palette.background}]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentInsetAdjustmentBehavior="automatic" refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={styles.screen}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
    {footer}
  </SafeAreaView>;
}
export function Copy({ children, kind='body', selectable }: PropsWithChildren<{kind?:'body'|'title'|'subtitle'|'muted'|'label'|'error'; selectable?:boolean}>) {
  const p=usePalette();
  const { width } = useWindowDimensions();
  const color = kind==='muted' ? p.muted : kind==='label' ? p.blue : kind==='error' ? p.danger : p.text;
  return <Text selectable={selectable} accessibilityRole={kind==='title'||kind==='subtitle'?'header':undefined} accessibilityLiveRegion={kind==='error'?'polite':undefined} style={[styles[kind],kind==='title'&&width>=1024&&styles.wideTitle,{color}]}>{children}</Text>;
}
export function Card({ children }: PropsWithChildren) {
  const p=usePalette();
  return <View style={[styles.card,{backgroundColor:p.surface,borderColor:p.border}]}>{children}</View>;
}
export function Action({ label, onPress, disabled=false, secondary=false, selected }: {label:string; onPress:()=>void; disabled?:boolean; secondary?:boolean; selected?:boolean}) {
  const p=usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{disabled,selected}} aria-pressed={selected} disabled={disabled} onPress={onPress}
    style={({pressed})=>[styles.action,{backgroundColor:secondary?(selected?p.subtle:p.surface):p.primary,borderColor:selected?p.blue:secondary?p.border:p.primary,opacity:disabled?.48:pressed?.76:1}]}>
    <Text style={[styles.actionText,{color:secondary?p.blue:'#FFFFFF'}]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, inputRef, ...props }: TextInputProps & {label:string; inputRef?: Ref<ComponentRef<typeof TextInput>>}) {
  const p=usePalette();
  return <View style={styles.field}><Copy>{label}</Copy><TextInput
    ref={inputRef} accessibilityLabel={label} placeholderTextColor={p.muted} {...props}
    style={[styles.input,{backgroundColor:p.surface,color:p.text,borderColor:p.border},props.multiline&&styles.multiline,props.style]} /></View>;
}
export function ReadState({ loading,error,onRetry }: {loading:boolean;error:string|null;onRetry:()=>void}) {
  const p=usePalette();
  if (loading) return <View accessibilityLabel="Chargement" style={styles.loading}><ActivityIndicator color={p.blue}/><Copy kind="muted">Chargement…</Copy></View>;
  if (error) return <Card><Copy kind="error">{error}</Copy><Action secondary label="Réessayer" onPress={onRetry}/></Card>;
  return null;
}
export function BookingProgress({ labels, index, columns = false }: { labels: string[]; index: number; columns?: boolean }) {
  const p = usePalette();
  return <View accessibilityLabel={'Étape ' + (index + 1) + ' sur ' + labels.length + '. ' + labels[index]} style={[styles.progress, columns && styles.progressColumns]}>
    {labels.map((label, position) => <View key={label} style={[styles.progressItem, columns && styles.progressColumn]}>
      <View style={[styles.progressNumber, { backgroundColor: position === index ? p.primary : p.subtle, borderColor: p.border }]}>
        <Text style={[styles.progressLabel, { color: position === index ? '#FFFFFF' : p.muted }]}>{position + 1}</Text>
      </View>
      <Text style={[styles.progressLabel, columns && styles.progressColumnLabel, { color: position === index ? (columns ? p.blue : p.text) : p.muted }]}>{label}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({  progress: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  progressColumns: { flexWrap: 'nowrap', alignItems: 'flex-start' },
  progressColumn: { flex: 1, minWidth: 0, flexDirection: 'column', alignItems: 'flex-start' },
  progressColumnLabel: { fontSize: 11, lineHeight: 17 },
  progressItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressNumber: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  progressLabel: { fontFamily: 'JakartaMedium', fontSize: 12, lineHeight: 16 },

  flex:{flex:1}, screen:{padding:16,gap:16,paddingBottom:30,width:'100%',maxWidth:650,alignSelf:'center'},
  card:{padding:16,gap:12,borderWidth:1,borderRadius:16},
  action:{minHeight:48,paddingVertical:11,paddingHorizontal:16,borderWidth:1,borderRadius:12,alignItems:'center',justifyContent:'center'},
  actionText:{fontFamily:'JakartaMedium',fontSize:15,lineHeight:22,textAlign:'center'},
  title:{fontFamily:'JakartaMedium',fontSize:23,lineHeight:32,letterSpacing:-.2},
  wideTitle:{fontSize:28,lineHeight:36,letterSpacing:-.4},
  subtitle:{fontFamily:'JakartaMedium',fontSize:18,lineHeight:26},
  body:{fontFamily:'JakartaRegular',fontSize:15,lineHeight:23},
  muted:{fontFamily:'JakartaRegular',fontSize:14,lineHeight:22},
  label:{fontFamily:'JakartaMedium',fontSize:13,lineHeight:20},
  error:{fontFamily:'JakartaSemiBold',fontSize:14,lineHeight:22},
  input:{minHeight:48,borderWidth:1,borderRadius:13,paddingHorizontal:13,paddingVertical:10,fontFamily:'JakartaRegular',fontSize:16},
  multiline:{minHeight:105,textAlignVertical:'top'},
  field:{gap:5},loading:{alignItems:'center',gap:10,padding:16},
});
