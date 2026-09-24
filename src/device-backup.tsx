import { useEffect, useRef, useState } from 'react';

const ENDPOINT = 'https://43-133-253-81.nip.io/yomiai-api/device-backups/';
const SECRET = 'yomiai-backup-secret';
const STATUS = 'yomiai-backup-status';
const stores = [['nenei-yomiai-appearance', 'kv'], ['nenei-yomiai-fonts', 'fonts']] as const;
type Row = { id: string; value?: string; name?: string; family?: string; blob?: Blob; data?: string };
type Snapshot = { version: 1; createdAt: string; local: Record<string,string>; appearance: Row[]; fonts: Row[] };
const ownKey = (key: string) => /^(nenei-yomiai-|yomiai-)/.test(key) && !key.startsWith('yomiai-backup-');
const bytes64 = (bytes: Uint8Array) => {
  let value = '';
  for (let i=0;i<bytes.length;i+=8192) value += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(value);
};
const from64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const hex = (bytes: Uint8Array) => [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
async function database(index: number) {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open(stores[index][0],1);
    request.onupgradeneeded = () => request.result.createObjectStore(stores[index][1],{keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rows(index: number, values?: Row[]) {
  const db = await database(index);
  try {
    return await new Promise<Row[]>((resolve,reject) => {
      const tx = db.transaction(stores[index][1],values ? 'readwrite' : 'readonly');
      const store = tx.objectStore(stores[index][1]);
      let result: Row[] = [];
      if (values) { store.clear(); values.forEach(value => store.put(value)); }
      else { const request=store.getAll(); request.onsuccess=()=>{result=request.result;}; }
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || Error('存储操作中断'));
    });
  } finally { db.close(); }
}
async function blob64(blob: Blob) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(reader.error); reader.readAsDataURL(blob);
  });
}
export async function snapshot(): Promise<Snapshot> {
  const local: Record<string,string> = {};
  Object.keys(localStorage).filter(ownKey).sort().forEach(key=>{local[key]=localStorage.getItem(key)!;});
  const appearance=await rows(0);
  const fonts: Row[]=[];
  for (const {blob,...font} of await rows(1)) fonts.push({...font,data:blob ? await blob64(blob) : ''});
  return {version:1,createdAt:new Date().toISOString(),local,appearance,fonts};
}
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  const s=value as Snapshot;
  if (!s || s.version!==1 || !s.local || typeof s.local!=='object' || Array.isArray(s.local) || !Array.isArray(s.appearance) || !Array.isArray(s.fonts)) throw Error('备份文件格式不正确');
  if (Object.entries(s.local).some(([k,v])=>!ownKey(k) || typeof v!=='string')) throw Error('备份包含无效设置');
  if (s.appearance.some(r=>!r || typeof r.id!=='string' || !ownKey(r.id) || typeof r.value!=='string')) throw Error('外观备份不完整');
  if (s.fonts.some(r=>!r || typeof r.id!=='string' || typeof r.name!=='string' || typeof r.family!=='string' || typeof r.data!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data))) throw Error('字体备份不完整');
}
function replaceLocal(values: Record<string,string>) {
  Object.keys(localStorage).filter(ownKey).forEach(key=>localStorage.removeItem(key));
  Object.entries(values).forEach(([k,v])=>localStorage.setItem(k,v));
}
async function writeSnapshot(s: Snapshot) {
  const fonts=s.fonts.map(({data,...font})=>({...font,blob:new Blob([from64(data!)])}));
  await rows(0,s.appearance); await rows(1,fonts); replaceLocal(s.local);
}
let busy=false, restoring=false, lastFingerprint='';
export async function restoreSnapshot(value: unknown) {
  validateSnapshot(value);
  if (busy) throw Error('正在保存，请稍后再恢复');
  restoring=true;
  const before=await snapshot().catch(error=>{restoring=false;throw error;});
  download(before, 'verso-before-restore');
  try {
    await writeSnapshot(value);
    // A restored device gets its own backup slot; it cannot overwrite the source.
    localStorage.removeItem(SECRET); localStorage.removeItem(STATUS);
    Object.keys(sessionStorage).filter(key=>key.startsWith('yomiai-view-')).forEach(key=>sessionStorage.removeItem(key));
    location.reload();
  } catch (error) {
    try { await writeSnapshot(before); } finally { restoring=false; }
    throw error;
  }
}
function secret() {
  let value=localStorage.getItem(SECRET);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) { value=hex(crypto.getRandomValues(new Uint8Array(32)));localStorage.setItem(SECRET,value); }
  return value;
}
async function credentials(code: string) {
  if (!/^[a-f0-9]{64}$/.test(code)) throw Error('恢复码应为 64 位字符');
  const raw=Uint8Array.from(code.match(/../g)!,s=>parseInt(s,16));
  const id=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  return {id,key};
}
function report(message: string) { localStorage.setItem(STATUS,message); window.dispatchEvent(new Event('yomiai-backup-change')); }
export async function saveCloud() {
  if (busy || restoring) return;
  busy=true;
  try {
    const s=await snapshot();
    const fingerprint=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([s.local,s.appearance,s.fonts])))));
    if (fingerprint===lastFingerprint) return;
    const {id,key}=await credentials(secret());
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(s)));
    const response=await fetch(ENDPOINT+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,iv:bytes64(iv),data:bytes64(new Uint8Array(ciphertext))})});
    if (!response.ok) throw Error('云端暂时未能保存');
    lastFingerprint=fingerprint;
    report('已备份 · '+new Date().toLocaleString());
  } catch (error) { report('尚未备份成功 · 请稍后重试'); throw error; }
  finally { busy=false; }
}
export async function readCloud(code: string): Promise<Snapshot> {
  const {id,key}=await credentials(code.trim());
  const response=await fetch(ENDPOINT+id,{cache:'no-store'});
  if (!response.ok) throw Error('没有找到这份云备份');
  const encrypted=await response.json();
  try {
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(encrypted.iv)},key,from64(encrypted.data));
    const result=JSON.parse(new TextDecoder().decode(clear));validateSnapshot(result);return result;
  } catch { throw Error('恢复码不匹配，或备份数据不完整'); }
}
function download(s: Snapshot, prefix='verso-backup') {
  const url=URL.createObjectURL(new Blob([JSON.stringify(s)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=prefix+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function BackupSettings() {
  const [status,setStatus]=useState(localStorage.getItem(STATUS)||'尚无设备备份');
  const [code,setCode]=useState(''), [ownCode,setOwnCode]=useState('');
  const [pending,setPending]=useState<Snapshot|null>(null), [working,setWorking]=useState(false), [error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{const update=()=>setStatus(localStorage.getItem(STATUS)||'尚无设备备份');window.addEventListener('yomiai-backup-change',update);return()=>window.removeEventListener('yomiai-backup-change',update);},[]);
  const run=async(fn:()=>Promise<void>)=>{setWorking(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');}finally{setWorking(false);}};
  return <details className='settings-group backup-settings'><summary>同步与备份</summary>
    <p className='backup-status' role='status'>{status}</p>
    <small>书籍、已提交页边与进度实时同步。时长、外观、字体和草稿点「立即备份」保存，换设备时用恢复码取回。</small>
    <div className='backup-actions'><button disabled={working} onClick={()=>run(saveCloud)}>立即备份</button><button disabled={working} onClick={()=>run(async()=>download(await snapshot()))}>导出文件</button><button disabled={working} onClick={()=>input.current?.click()}>导入文件</button></div>
    <input ref={input} className='hidden-input' type='file' accept='.json,application/json' onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{const s=JSON.parse(await file.text());validateSnapshot(s);setPending(s);});}} />
    <details className='appearance-more'><summary onClick={()=>{try{setOwnCode(secret());}catch{setError('无法生成恢复码');}}}>此设备恢复码</summary><p className='recovery-code'>{ownCode}</p><small>保存到你自己的备忘录；拥有恢复码即可读取这份备份。</small></details>
    <details className='appearance-more'><summary>从云端恢复</summary><label className='field'><span>旧设备恢复码</span><input aria-label='恢复码' value={code} onChange={e=>setCode(e.target.value)} autoComplete='off' spellCheck={false}/></label><button className='text-button' disabled={working} onClick={()=>run(async()=>setPending(await readCloud(code)))}>读取备份</button></details>
    {pending && <div className='restore-confirm'><p>{pending.createdAt ? new Date(pending.createdAt).toLocaleString() : ''} 的备份</p><small>将替换此设备的时长、外观和草稿，并先导出当前数据留底。书籍与已提交页边不受影响。</small><div className='backup-actions'><button disabled={working} onClick={()=>run(()=>restoreSnapshot(pending))}>确认恢复</button><button disabled={working} onClick={()=>setPending(null)}>取消</button></div></div>}
    {error && <p role='alert'>{error}</p>}
  </details>;
}
