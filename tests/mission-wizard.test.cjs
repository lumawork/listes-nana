const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../mission-wizard');
test('Simple form distinguishes unscheduled, dated and relative missions',()=>{
 const base={title:'Ma chambre',person:'annabelle',steps:'Faire le lit\n15:00 Ranger le bureau'};
 const draft=W.build({...base,mode:'none'});assert.equal(draft.spec.reminder,false);assert.equal(draft.spec.firstDue,undefined);assert.equal(draft.spec.steps.length,2);assert.equal(draft.spec.steps[1].time,'15:00');
 const once=W.build({...base,mode:'once',date:'2026-11-01',reminder:true});assert.equal(once.spec.dueType,'day');
 const relative=W.build({...base,mode:'relative',date:'2026-11-01',every:7});assert.equal(relative.spec.every,7);
 assert.throws(()=>W.build({...base,mode:'fixed',date:'2026-11-01',days:[]}));assert.throws(()=>W.steps('99:99 Faux horaire'));
});
test('Editing retains step IDs and distinguishes detail updates from schedule changes',()=>{
 const previous={title:'Chambre',spec:{mode:'once',every:1,unit:'days',firstDue:'2026-11-01T00:00',dueType:'day',steps:[{id:'bed',title:'Lit',time:''}]}};
 const edit=W.build({title:'Ma chambre',person:'annabelle',mode:'once',date:'2026-11-01',steps:'Lit'},previous);
 assert.equal(edit.spec.steps[0].id,'bed');assert.equal(edit.replaceSchedule,false);
 assert.equal(W.build({title:'Chambre',person:'annabelle',mode:'once',date:'2026-11-02',steps:'Lit'},previous).replaceSchedule,true);
});

test('Retrying a new form keeps identical step IDs for idempotent creation',()=>{const values={title:'Chambre',person:'annabelle',mode:'none',steps:'Lit\nBureau'};assert.deepEqual(W.build(values),W.build(values));});
