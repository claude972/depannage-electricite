import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';

export function usePalette() {
  return useColorScheme() === 'dark'
    ? {background:'#11141C', surface:'#1C2230', text:'#F5F7FF', muted:'#ADB7CD', border:'#364259', blue:'#ADC0FF', primary:'#2246E5', accent:'#FF885F', danger:'#FF9F9F'}
    : {background:'#F5F7FF', surface:'#FFFFFF', text:'#111A32', muted:'#4C5770', border:'#DCE3F3', blue:'#2246E5', primary:'#2246E5', accent:'#A62B03', danger:'#A52020'};
}
export function Screen({ children, top=false }: PropsWithChildren<{top?:boolean}>) {
  const palette = usePalette();
  return <SafeAreaView edges={top?['top','left','right','bottom']:['left','right','bottom']} style={[styles.flex,{backgroundColor:palette.background}]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export function Copy({ children, kind='body' }: PropsWithChildren<{kind?:'body'|'title'|'subtitle'|'muted'|'label'|'error'}>) {
  const p=usePalette();
  const color = kind==='muted' ? p.muted : kind==='label' ? p.blue : kind==='error' ? p.danger : p.text;
  return <Text accessibilityRole={kind==='title'||kind==='subtitle'?'header':undefined} accessibilityLiveRegion={kind==='error'?'polite':undefined} style={[styles[kind],{color}]}>{children}</Text>;
}
export function Card({ children }: PropsWithChildren) {
  const p=usePalette();
  return <View style={[styles.card,{backgroundColor:p.surface,borderColor:p.border}]}>{children}</View>;
}
export function Action({ label, onPress, disabled=false, secondary=false }: {label:string; onPress:()=>void; disabled?:boolean; secondary?:boolean}) {
  const p=usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[styles.action,{backgroundColor:secondary?p.surface:p.primary,borderColor:secondary?p.border:p.primary,opacity:disabled?.48:pressed?.76:1}]}>
    <Text style={[styles.actionText,{color:secondary?p.blue:'#FFFFFF'}]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & {label:string}) {
  const p=usePalette();
  return <View style={styles.field}><Copy>{label}</Copy><TextInput
    accessibilityLabel={label} placeholderTextColor={p.muted} {...props}
    style={[styles.input,{backgroundColor:p.surface,color:p.text,borderColor:p.border},props.multiline&&styles.multiline,props.style]} /></View>;
}
export function ReadState({ loading,error,onRetry }: {loading:boolean;error:string|null;onRetry:()=>void}) {
  const p=usePalette();
  if (loading) return <View accessibilityLabel="Chargement" style={styles.loading}><ActivityIndicator color={p.blue}/><Copy kind="muted">Chargement…</Copy></View>;
  if (error) return <Card><Copy kind="error">{error}</Copy><Action secondary label="Réessayer" onPress={onRetry}/></Card>;
  return null;
}
const styles = StyleSheet.create({
  flex:{flex:1}, screen:{padding:20,gap:16,paddingBottom:34,width:'100%',maxWidth:650,alignSelf:'center'},
  card:{padding:16,gap:12,borderWidth:1,borderRadius:20},
  action:{minHeight:50,paddingVertical:13,paddingHorizontal:16,borderWidth:1,borderRadius:14,alignItems:'center',justifyContent:'center'},
  actionText:{fontFamily:'JakartaBold',fontSize:15,textAlign:'center'},
  title:{fontFamily:'JakartaBold',fontSize:30,lineHeight:38},
  subtitle:{fontFamily:'JakartaBold',fontSize:20,lineHeight:27},
  body:{fontFamily:'JakartaRegular',fontSize:15,lineHeight:23},
  muted:{fontFamily:'JakartaRegular',fontSize:14,lineHeight:22},
  label:{fontFamily:'JakartaBold',fontSize:13,lineHeight:20,letterSpacing:.3},
  error:{fontFamily:'JakartaSemiBold',fontSize:14,lineHeight:22},
  input:{minHeight:48,borderWidth:1,borderRadius:13,paddingHorizontal:13,paddingVertical:10,fontSize:16},
  multiline:{minHeight:105,textAlignVertical:'top'},
  field:{gap:5},loading:{alignItems:'center',gap:10,padding:16},
});
