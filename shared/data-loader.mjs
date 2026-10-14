export function demoContent(count=120){
 const label='項目';
 return {items:Array.from({length:count},(_,i)=>[false,i+1,label+String(i+1).padStart(3,'0'),'説明 '+String(i+1).padStart(3,'0')]),phonetics:{}};
}
export function validateContent(value){
 if(!value||value.schemaVersion!==1||!Array.isArray(value.items)||value.items.length<6||value.items.length>10000)throw Error('教材ファイルの形式と件数を確認してください。');
 const items=value.items.map((entry,i)=>{const row=Array.isArray(entry)?entry:[entry?.isNew??false,entry?.id,entry?.term,entry?.answer];if(row.length!==4||typeof row[0]!=='boolean'||row[1]!==i+1||row.slice(2).some(text=>typeof text!=='string'||!text.trim()||text.length>500||/[<>]/.test(text)))throw Error('教材は連番IDとプレーンテキストで指定してください。');return row;});
 const phonetics={};if(value.phonetics!==undefined){if(!value.phonetics||typeof value.phonetics!=='object'||Array.isArray(value.phonetics))throw Error('発音データの形式を確認してください。');for(const [key,text] of Object.entries(value.phonetics)){if(typeof text!=='string'||text.length>100||/[<>]/.test(text))throw Error('発音データはプレーンテキストで指定してください。');phonetics[key]=text;}}
 return {items,phonetics};
}
