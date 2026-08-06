type ZipEntry={name:string;method:number;compressedSize:number;offset:number};
const decoder=new TextDecoder();
const text=(value:string)=>value.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const columnIndex=(reference:string)=>{let value=0;for(const character of reference.match(/[A-Z]+/)?.[0]??'')value=value*26+character.charCodeAt(0)-64;return value-1;};

function zipEntries(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let end=-1;
  for(let index=bytes.length-22;index>=Math.max(0,bytes.length-65557);index--)if(view.getUint32(index,true)===0x06054b50){end=index;break;}
  if(end<0)throw new Error('O ficheiro não é um XLSX válido.');
  const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),entries:ZipEntry[]=[];let cursor=start;
  for(let index=0;index<count;index++){
    if(view.getUint32(cursor,true)!==0x02014b50)break;
    const method=view.getUint16(cursor+10,true),compressedSize=view.getUint32(cursor+20,true),nameLength=view.getUint16(cursor+28,true),extraLength=view.getUint16(cursor+30,true),commentLength=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true),name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    entries.push({name,method,compressedSize,offset});cursor+=46+nameLength+extraLength+commentLength;
  }
  return entries;
}
function entryStream(buffer:ArrayBuffer,entry:ZipEntry){
  const view=new DataView(buffer),nameLength=view.getUint16(entry.offset+26,true),extraLength=view.getUint16(entry.offset+28,true),start=entry.offset+30+nameLength+extraLength,stream=new Blob([new Uint8Array(buffer,start,entry.compressedSize)]).stream() as ReadableStream<Uint8Array>;
  if(entry.method===0)return stream;
  if(entry.method!==8)throw new Error('O método de compressão deste XLSX não é suportado.');
  return stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array,Uint8Array>);
}
const entryText=(buffer:ArrayBuffer,entry:ZipEntry)=>new Response(entryStream(buffer,entry)).text();
const sharedStrings=(xml:string)=>[...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match=>text(match[1]));
function parseRow(xml:string,shared:string[]){
  const row:unknown[]=[];
  for(const cell of xml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)){
    const reference=/\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];if(!reference)continue;
    const type=/\bt="([^"]+)"/.exec(cell[1])?.[1],raw=/<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]??'';
    row[columnIndex(reference)]=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?text(cell[2]):raw===''?'':Number.isFinite(Number(raw))?Number(raw):text(raw);
  }
  return row;
}

export async function* streamXlsxRows(buffer:ArrayBuffer,onRows?:(count:number)=>void):AsyncGenerator<unknown[]>{
  const entries=zipEntries(buffer),sheet=entries.find(entry=>entry.name==='xl/worksheets/sheet1.xml'),dictionary=entries.find(entry=>entry.name==='xl/sharedStrings.xml');
  if(!sheet)throw new Error('Não foi encontrada a primeira folha do extrato.');
  const shared=dictionary?sharedStrings(await entryText(buffer,dictionary)):[],reader=entryStream(buffer,sheet).getReader();let carry='',count=0;
  while(true){const {done,value}=await reader.read();if(done)break;carry+=decoder.decode(value,{stream:true});let end:number;
    while((end=carry.indexOf('</row>'))>=0){const close=end+6,start=carry.lastIndexOf('<row',end);if(start>=0){count++;yield parseRow(carry.slice(start,close),shared);if(count%10000===0)onRows?.(count);}carry=carry.slice(close);}
    if(carry.length>2_000_000)carry=carry.slice(-200_000);
  }
  onRows?.(count);
}
