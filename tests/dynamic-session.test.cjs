const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const C=require('../dynamic-core.js');
class Element {
  constructor(){this.children=[];this.value='';this.dataset={};this.classList={toggle(){},add(){}};}
  append(...v){for(const x of v)if(x&&typeof x==='object')x.parentElement=this;this.children.push(...v);}
  prepend(...v){this.children.unshift(...v);}
  before(){}
  cloneNode(){return new Element();}
  replaceWith(){}
  replaceChildren(...v){this.children=v;}
  setAttribute(){}
  addEventListener(){}
}
const turn=async()=>{for(let i=0;i<60;i++)await Promise.resolve()};
test('A late snapshot from the previous account is discarded and the new account reloads',async()=>{
  const ids={},values={},elements={};const element=id=>ids[id]||=new Element();
  const create=(tag,cls,text)=>Object.assign(new Element(),{tagName:tag,className:cls,textContent:text});
  let releaseOld,reads=[];
  const oldReply=new Promise(resolve=>releaseOld=resolve);
  const snapshot=id=>({userId:id,revision:1,serverNow:new Date().toISOString(),admin:true,config:{people:[]},definitions:[],occurrences:[]});
  const rpc=id=>async name=>{
    if(name==='nm_legacy')return {links:[],personal:[],shared:[]};
    reads.push(id);if(id==='mom')return oldReply;return snapshot(id);
  };
  const context={state:{lists:[]},MissionsDailyCore:require("../daily-core.js"),MissionsDynamicCore:C,MISSIONS_CONFIG:{maisonUrl:'https://example.test/notre-maison/'},
    location:{href:'https://example.test/listes-nana/'},URL,Date,Intl,Map,Set,Promise,queueMicrotask,
    crypto:require('node:crypto').webcrypto,console,navigator:{onLine:true},
    document:{hidden:false,body:new Element(),querySelector:s=>elements[s]||=new Element()},
    localStorage:{getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v,removeItem:k=>delete values[k]},
    window:{addEventListener(){}},setInterval(){},setTimeout:fn=>queueMicrotask(fn),
    $:element,el:create,btn:(text,onclick,cls)=>Object.assign(create('button',cls,text),{onclick}),render(){},toast(){}};
  vm.runInNewContext(fs.readFileSync('dynamic.js','utf8'),context);
  await turn();
  context.MissionsDynamic.setContext({session:{user:{id:'mom'}},profile:{kind:'adult'},call:rpc('mom')});
  await turn();assert.equal(reads.includes('mom'),true);
  context.MissionsDynamic.setContext({session:{user:{id:'dad'}},profile:{kind:'adult'},call:rpc('dad')});
  await turn();assert.equal(context.MissionsDynamic.currentSnapshot(),null);
  releaseOld(snapshot('mom'));await turn();
  assert.equal(context.MissionsDynamic.currentSnapshot().userId,'dad');
  assert.equal(reads.at(-1),'dad');
  context.MissionsDynamic.setContext({session:null,profile:null,call:rpc('dad')});await turn();
  assert.equal(context.MissionsDynamic.currentSnapshot(),null);
});
