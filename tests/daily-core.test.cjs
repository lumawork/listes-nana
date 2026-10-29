const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../daily-core');
const now=Date.parse('2026-10-29T11:00:00Z'); // jeudi à Paris
const list=(id,extra={})=>({id,title:id,resetMode:'daily',tasks:[{id:'one',text:'Mission',done:false}],...extra});
test('Daily board respects recurrence, active days, pause and migration without inventing dates',()=>{
 const data=[list('daily'),list('manual',{resetMode:'manual',tasks:[{time:'15:00',done:false}]}),list('sunday',{activeDays:[0]}),list('paused',{pausedUntil:'2026-10-29'}),list('migrated'),list('done',{tasks:[{done:true}]}),list('weekly',{resetMode:'weekly',activeDays:[4]})];
 const before=JSON.stringify(data);assert.deepEqual(D.legacyGroups(data,now,id=>id==='migrated').map(g=>g.list.id),['daily','weekly']);assert.equal(JSON.stringify(data),before);
});
test('Personal scope defaults to the account mapping, never guesses Papa or Maman',()=>{
 const data={config:{people:[{id:'annabelle',userId:'child'},{id:'papa',userId:'dad'},{id:'maman'}]}};
 assert.equal(D.initialPerson(data,'dad'),'papa');assert.equal(D.initialPerson(data,'unknown'),'');
 assert.equal(D.initialPerson({...data,personScope:'annabelle'},'dad','maman'),'annabelle');assert.equal(D.initialPerson(data,'unknown','maman'),'maman');
});
