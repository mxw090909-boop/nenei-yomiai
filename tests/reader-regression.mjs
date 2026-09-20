import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://reader.test/nenei-yomiai/', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
const calls = [];
const progress = [{ bookId:'test-book', chapterIndex:2, paragraphIndex:5, percent:40, updatedAt:'2026-09-20T10:00:00Z' }];
let failSave = false, releaseSave;
const notes = [
  { id:'n1',bookId:'test-book',chapterIndex:1,paragraphIndex:3,quote:'正文 3',text:'第一章的留言',author:'ai',createdAt:'2026-09-18T10:00:00Z' },
  { id:'n2',bookId:'test-book',chapterIndex:2,paragraphIndex:5,quote:'正文 5',text:'第二章的留言',author:'ai',createdAt:'2026-09-19T10:00:00Z' },
  { id:'future',bookId:'test-book',chapterIndex:3,paragraphIndex:1,quote:'正文 1',text:'未来章节不应出现在首页',author:'ai',createdAt:'2026-09-20T10:00:00Z' },
];
const paragraphs=Array.from({length:100},(_,i)=>`正文 ${i}。这一段用于检验滚动、续读与批注。`);
const chapter = index => ({bookId:'test-book',chapterIndex:index,title:`第${index}章`,paragraphs});
w.fetch = async (url, opts={}) => {
  const path = new URL(url).pathname.replace('/yomiai-api','');
  calls.push({path,method:opts.method || 'GET',body:opts.body});
  let data;
  if(path==='/books') data={books:[{id:'test-book',title:'测试书',author:'测试作者',status:'正在读',progress:40,chapterCount:3}]};
  else if(path==='/progress') data=opts.method==='PUT'?{ok:true}:{progress};
  else if(path.endsWith('/annotations')) {
    if(opts.method==='POST') {
      if (failSave) throw Error('offline');
      await new Promise(r=>releaseSave=r);
      notes.push({...JSON.parse(opts.body),id:'saved-'+notes.length,bookId:'test-book',createdAt:new Date().toISOString()});
    }
    data={annotations:structuredClone(notes)};
  } else if(path.endsWith('/chapters')) data={chapters:[chapter(1),chapter(2),chapter(3)]};
  else if(/\/chapters\/\d+$/.test(path)) data={chapter:chapter(Number(path.split('/').pop()))};
  else throw Error('Unexpected URL '+url);
  return {ok:true,json:async()=>data};
};
w.console.error = (...args) => { if(!String(args[0]).includes('indexedDB')) console.error(...args); };
w.localStorage.setItem('nenei-yomiai-progress-test-book',JSON.stringify({chapterIndex:1,paragraphIndex:1,percent:1,updatedAt:1}));
Object.defineProperty(w.HTMLElement.prototype,'getBoundingClientRect',{value:function(){
  const reader=this.closest('.reader-screen');
  const index=this.getAttribute('data-paragraph-index');
  const top=index===null?100:240+Number(index)*100-(reader?.scrollTop || 0);
  return {top,bottom:top+100,height:100,left:0,right:400,width:400,x:0,y:top};
}});
const bundle=readdirSync('dist/assets').find(f=>f.endsWith('.js'));
w.eval(readFileSync('dist/assets/'+bundle,'utf8'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await delay(20);}throw Error('Timed out: '+fn);};
const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const click=async(text)=>{assert.ok(button(text),'button '+text);button(text).click();await delay(40);};
const input=(el,value)=>{const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
await until(()=>button('继续阅读') && w.document.querySelector('.recent-note'));
assert.ok(w.document.body.textContent.includes('第二章的留言'));
assert.ok(!w.document.body.textContent.includes('未来章节不应出现在首页'));
assert.equal(calls.filter(c=>c.method==='PUT').length,0,'home must not overwrite remote progress');
await click('继续阅读'); await until(()=>w.document.querySelector('#paragraph-2-5')); await delay(100);
let reader=w.document.querySelector('.reader-screen');
assert.equal(reader.scrollTop,616,'newer server bookmark restored');
assert.equal(calls.filter(c=>c.path.endsWith('/chapters')).length,0,'reading does not eagerly download the full book');
// Pointer down then scrolling must never snap back to the pre-gesture position.
w.document.querySelector('#paragraph-2-5').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
reader.scrollTop=1816;reader.dispatchEvent(new w.Event('scroll'));await delay(700);
assert.equal(reader.scrollTop,1816,'gesture position stays untouched');
let saved=JSON.parse(w.localStorage.getItem('nenei-yomiai-progress-test-book'));
assert.equal(saved.paragraphIndex,17,'scroll records actual visible paragraph');
assert.equal(saved.paragraphOffset,0);
const putCount=calls.filter(c=>c.method==='PUT').length;
w.document.querySelector('#paragraph-2-20').click();await delay(120);
assert.equal(reader.scrollTop,1816,'selecting a paragraph must not move text');
assert.equal(calls.filter(c=>c.method==='PUT').length,putCount,'selection must not write progress');
await click('+ Nenei 页边');
input(w.document.querySelector('.reader-annotation-sheet textarea'),'保留我的草稿');await delay(40);
await click('先不写'); await click('×');
w.document.querySelector('#paragraph-2-21').click();await delay(40);await click('+ Nenei 页边');
assert.equal(w.document.querySelector('textarea').value,'','different quote gets a separate draft');
await click('先不写');await click('×');
w.document.querySelector('#paragraph-2-20').click();await delay(40);await click('+ Nenei 页边');
assert.equal(w.document.querySelector('textarea').value,'保留我的草稿');
failSave=true;await click('保存');assert.ok(w.document.body.textContent.includes('保存失败'));
assert.equal(w.document.querySelector('textarea').value,'保留我的草稿');
failSave=false; const beforePosts=calls.filter(c=>c.method==='POST').length;
button('保存').click();button('保存').click();await delay(50);
assert.equal(calls.filter(c=>c.method==='POST').length,beforePosts+1,'double click sends once');
releaseSave();await delay(60);assert.equal(w.document.querySelector('.reader-annotation-sheet'),null);
await click('搜索');assert.ok(w.document.querySelector('.reader-search input'));
input(w.document.querySelector('.reader-search input'),'正文 88');await delay(40);
assert.ok(w.document.querySelector('.search-results button'),'search returns results');
await click('nenei-yomiai');await click('继续阅读');await delay(100);
reader=w.document.querySelector('.reader-screen');assert.equal(reader.scrollTop,1816,'returning resumes last scroll');
await click('nenei-yomiai');
const nav=[...w.document.querySelectorAll('.bottom-nav button')].find(b=>b.textContent.includes('页边'));nav.click();await delay(50);
assert.equal(w.document.querySelectorAll('.note-card').length,4,'notes cover the whole book');
assert.ok(w.document.querySelector('[aria-label="章节批注"]'),'chapter note composer preserved');
const select=w.document.querySelector('[aria-label="批注作者"]');select.value='nenei';select.dispatchEvent(new w.Event('change',{bubbles:true}));await delay(40);
assert.equal(w.document.querySelectorAll('.note-card').length,1,'author filter works');
notes.push({id:'new',bookId:'test-book',chapterIndex:2,paragraphIndex:30,quote:'正文 30',text:'刚刚写下的新留言',author:'ai',createdAt:new Date().toISOString()});
w.dispatchEvent(new w.Event('focus'));await delay(60);
select.value='unread';select.dispatchEvent(new w.Event('change',{bubbles:true}));await delay(40);
assert.ok(w.document.querySelector('.note-card').textContent.includes('刚刚写下的新留言'));
assert.equal(w.document.querySelectorAll('.note-card').length,1,'old notes are not all marked new');
await click('nenei-yomiai');
const shelf=[...w.document.querySelectorAll('.bottom-nav button')].find(b=>b.textContent.includes('书架'));shelf.click();await delay(40);
const status=w.document.querySelector('[aria-label="书籍状态"]');status.value='已读';status.dispatchEvent(new w.Event('change',{bubbles:true}));await delay(60);
assert.equal(JSON.parse(calls.filter(c=>c.method==='PUT').at(-1).body).status,'已读');
assert.equal(JSON.parse(calls.filter(c=>c.method==='PUT').at(-1).body).percent,100);
console.log('PASS: remote restore, no startup writes, smooth gesture, scroll bookmark, selection isolation, per-quote drafts, failed-save recovery, duplicate guard, search, return-to-reading, whole-book notes, filters, new-note refresh.');
dom.window.close();
