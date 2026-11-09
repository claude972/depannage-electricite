import { useState } from 'react';
import { Action, Card, Copy, Field } from './ui';

const rates=[0,2.1,5.5,8.5,10,20] as const;
type DraftLine={label:string;quantity:string;price:string};
const newLine=():DraftLine=>({label:'',quantity:'1',price:''});
export function QuoteEditor({ busy,onSend }: {busy:boolean;onSend:(lines:{label:string;quantity:number;unit_price_cents:number}[],rate:number)=>void}) {
  const [lines,setLines]=useState([newLine()]);
  const [rate,setRate]=useState<number|null>(null);
  const [error,setError]=useState<string|null>(null);
  const update=(index:number,key:keyof DraftLine,value:string)=>setLines(current=>current.map((line,i)=>i===index?{...line,[key]:value}:line));
  function send() {
    setError(null);
    const priced=lines.map(line=>{
      const price=line.price.trim().replace(',','.');
      const quantity=Number(line.quantity);
      const cents=/^\d{1,6}(?:\.\d{1,2})?$/.test(price)?Math.round(Number(price)*100):-1;
      return {label:line.label.trim(),quantity,unit_price_cents:cents};
    });
    if(rate===null||priced.some(line=>!line.label||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||line.unit_price_cents<0||line.unit_price_cents>10000000)){
      setError('Renseignez les libellés, quantités, prix et le taux de TVA applicable.');
      return;
    }
    onSend(priced,rate);
  }
  return <Card>
    <Copy kind="subtitle">Préparer le devis</Copy>
    {lines.map((line,index)=><Card key={index}>
      <Copy kind="label">LIGNE {index+1}</Copy>
      <Field label="Prestation ou pièce" value={line.label} onChangeText={value=>update(index,'label',value)} maxLength={160} editable={!busy}/>
      <Field label="Quantité" value={line.quantity} onChangeText={value=>update(index,'quantity',value)} keyboardType="numeric" editable={!busy}/>
      <Field label="Prix unitaire HT en euros" value={line.price} onChangeText={value=>update(index,'price',value)} keyboardType="decimal-pad" editable={!busy}/>
      {lines.length>1&&<Action label="Retirer cette ligne" secondary disabled={busy} onPress={()=>setLines(current=>current.filter((_,i)=>i!==index))}/>}
    </Card>)}
    {lines.length<30&&<Action label="Ajouter une ligne" secondary disabled={busy} onPress={()=>setLines(current=>[...current,newLine()])}/>}
    <Copy>Taux de TVA applicable</Copy>
    {rates.map(value=><Action key={value} label={`${value.toLocaleString('fr-FR')} %`} secondary={rate!==value} disabled={busy} onPress={()=>setRate(value)}/>)}
    {error&&<Copy kind="error">{error}</Copy>}
    <Action label="Envoyer le devis" disabled={busy} onPress={send}/>
  </Card>;
}
