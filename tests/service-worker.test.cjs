const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('A notification follows its own account and project after logout',async()=>{
  let owner='',notifications=[],opened=[],focused=0,windows=[],assets=[];const events={};
  const request=value=>{const r={result:value};queueMicrotask(()=>r.onsuccess?.());return r};
  const db={close(){},transaction(){return {objectStore:()=>({get:()=>request(owner),put:value=>{owner=value;return request(value)}})}}};
  const scope='https://example.test/listes-nana/';
  const context={self:{registration:{scope,showNotification:async(...v)=>notifications.push(v)},location:{origin:'https://example.test'},
    addEventListener:(type,fn)=>events[type]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async u=>opened.push(u)}},
    indexedDB:{open:()=>request(db)},URL,Request,Response,
    fetch:async()=>{throw Error('offline')},caches:{open:async()=>({addAll:async a=>assets=a.map(r=>r.url)}),keys:async()=>[]}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
  async function fire(type,data){let promise;events[type]({...data,waitUntil:p=>promise=p});await promise;}
  const push=id=>fire('push',{data:{json:()=>({userId:id,listId:'chores',jobId:'j'})}});
  // Resolve relative Request URLs as a service worker does in a browser.
  context.Request=class extends Request{constructor(url,init){super(new URL(url,scope),init)}};
  await fire('install',{});assert(assets.every(u=>u.startsWith(scope)));
  await push('mom');assert.equal(notifications.length,0);await fire('message',{data:{type:'SET_USER',userId:'mom'}});
  await push('dad');assert.equal(notifications.length,0);await push('mom');assert.equal(notifications.length,1);
  windows=[{url:'https://example.test/notre-maison/',focus:async()=>{focused++}}];
  await fire('notificationclick',{notification:{close(){},data:{userId:'mom',listId:'chores'}}});assert.equal(focused,0);assert(opened[0].startsWith(scope));
  await fire('message',{data:{type:'SET_USER',userId:''}});await push('mom');assert.equal(notifications.length,1);
  let cached=false;events.fetch({request:new Request('https://example.supabase.co/rest/v1/rpc/nm_rpc'),respondWith:()=>cached=true});assert.equal(cached,false);
});
