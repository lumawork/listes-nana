const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
(async()=>{const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema mm_private;grant usage on schema mm_private to service_role;
create table mm_private.mm_families(id uuid primary key);create table mm_private.mm_profiles(user_id uuid primary key,family_id uuid,kind text,display_name text,legacy_child boolean default false,message_style text);
create table mm_private.mm_guardians(parent_id uuid,child_id uuid);create table mm_private.mm_state(family_id uuid primary key,payload jsonb,revision bigint);create table mm_private.mm_personal_state(user_id uuid primary key,payload jsonb,revision bigint);create table mm_private.mm_shared_lists(id uuid primary key,family_id uuid,created_by uuid,payload jsonb,revision bigint,deleted_at timestamptz);create table mm_private.mm_shared_members(list_id uuid,user_id uuid,role text);
create table mm_private.mm_push_subscriptions(id uuid primary key,user_id uuid,subscription jsonb);create table mm_private.mm_push_deliveries(id uuid primary key,subscription_id uuid,list_id text,kind text,due_at timestamptz default now());
create function public.mm_push_public_key() returns text language sql as $$select 'key'$$;create function public.mm_push_subscribe(jsonb) returns void language sql as $$select$$;create function mm_private.mm_push_can_send(uuid,uuid) returns boolean language sql as $$select true$$;
`);await db.exec(fs.readFileSync('tests/fixtures/schema-v1.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_mes_missions_v11_shared_engine.sql')),'utf8'));
await db.exec(fs.readFileSync('backend/003-missions-etapes.sql','utf8'));await db.exec(fs.readFileSync('backend/003-missions-etapes.sql','utf8'));
const family=id(),kid=id(),dad=id(),other=id(),foreign=id();await db.query('insert into mm_private.mm_families values($1),($2)',[family,foreign]);
for(const [u,h,k] of [[kid,family,'child'],[dad,family,'adult'],[other,foreign,'adult']])await db.query('insert into mm_private.mm_profiles values($1,$2,$3,$3,false,$3)',[u,h,k]);
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
const payload={version:1,settings:{universe:'ponyrose'},history:[],lists:[{id:'room',title:'Ma chambre',group:'Maison',icon:'🎀',note:'Conservé',resetMode:'daily',activeDays:[0,1,2,3,4,5,6],day:today,tasks:[{id:'bed',text:'Faire le lit',time:'',done:true},{id:'desk',text:'Ranger le bureau',time:'',done:false}]},{id:'pony',title:'Poney sans date',group:'Loisirs',resetMode:'manual',tasks:[{id:'bag',text:'Préparer le sac',time:'15:00',done:false}]}]};
await db.query('insert into mm_private.mm_personal_state values($1,$2,1)',[kid,payload]);
async function call(u,action,data={},token=null){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u||'']);await db.exec(u?'set role authenticated':'set role anon');try{return(await db.query('select public.nm_rpc($1,$2,$3) r',[action,data,token])).rows[0].r;}finally{await db.exec('reset role');}}
await call(dad,'snapshot');await call(kid,'snapshot');let up=await call(kid,'bootstrap');assert.equal(up.report.length,2);assert.equal(up.report[1].status,'unscheduled');
let snap=await call(kid,'snapshot');assert.equal(snap.apiVersion,12);assert.equal(snap.definitions.length,2);assert(!snap.occurrences.some(o=>o.title==='Poney sans date'));
assert.deepEqual((await db.query('select payload from mm_private.mm_personal_state where user_id=$1',[kid])).rows[0].payload,payload);
await call(kid,'bootstrap');assert.equal((await call(kid,'snapshot')).definitions.length,2);
let o=snap.occurrences.find(o=>o.title==='Ma chambre');assert.equal(o.spec.stepDone.bed,true);
await assert.rejects(call(kid,'complete',{id:o.id,version:o.version,requestId:id()}),/STEPS_INCOMPLETE/);
await assert.rejects(call(other,'step',{id:o.id,version:o.version,stepId:'desk',done:true,requestId:id()}),/SCOPE_DENIED/);
const request={id:o.id,version:o.version,stepId:'desk',done:true,requestId:id()};assert.equal((await call(kid,'step',request)).completed,true);assert.equal((await call(kid,'step',request)).completed,true);
snap=await call(kid,'snapshot');assert.equal(snap.occurrences.find(x=>x.id===o.id).status,'done');assert.equal(snap.occurrences.find(x=>x.def_id===o.def_id&&x.status==='open').spec.stepDone,undefined);
const created=await call(kid,'create',{person:'annabelle',title:'Sans date',spec:{mode:'none',steps:[{id:'one',title:'Détail'}],ui:{listId:'notes',title:'Notes'}},requestId:id()});assert(created.id);assert(!(await call(kid,'snapshot')).occurrences.some(x=>x.title==='Sans date'));
await assert.rejects(call(kid,'create',{person:'papa',title:'Interdit',spec:{mode:'none'},requestId:id()}),/SCOPE_DENIED/);
const extra=id();await db.query("insert into mm_private.mm_profiles values($1,$2,'adult','Parent',false,'mom')",[extra,family]);assert.equal((await call(extra,'bootstrap')).needsPerson,true);await call(extra,'bootstrap',{person:'papa'});
let grant=await call(dad,'grant',{person:'home',requestId:id()}),pair=await call(null,'pair',{identifier:grant.identifier,code:grant.code});await assert.rejects(call(null,'bootstrap',{},pair.token),/SCOPE_DENIED/);
await assert.rejects(db.exec('set role anon;select * from nm_private.upgrades_v12'),/permission denied/);await db.exec('reset role');

// Deux appareils ne doivent pas écraser des coches concurrentes.
await call(kid,'create',{person:'annabelle',title:'Routine relative',spec:{mode:'relative',every:7,unit:'days',firstDue:new Date(Date.now()-60000).toISOString(),steps:[{id:'a',title:'A'},{id:'b',title:'B'}]},requestId:id()});
let relative=(await call(kid,'snapshot')).occurrences.find(x=>x.title==='Routine relative');
const firstStep=await call(kid,'step',{id:relative.id,version:relative.version,stepId:'a',done:true,requestId:id()});assert.equal(firstStep.completed,false);
await assert.rejects(call(kid,'step',{id:relative.id,version:relative.version,stepId:'b',done:true,requestId:id()}),/VERSION_CONFLICT/);
relative=(await call(kid,'snapshot')).occurrences.find(x=>x.id===relative.id);
await call(null,'step',{id:relative.id,version:relative.version,stepId:'b',done:true,requestId:id()},pair.token);
const after=(await call(kid,'snapshot')).occurrences;assert.equal(after.find(x=>x.id===relative.id).status,'done');
const nextRelative=after.find(x=>x.def_id===relative.def_id&&x.status==='open');assert(nextRelative);assert(!nextRelative.spec.stepDone);assert(Date.parse(nextRelative.due)>Date.now()+6*86400000);
// Les coches appartiennent à l’occurrence et ne peuvent pas être injectées dans un modèle.
await call(kid,'create',{person:'annabelle',title:'Pas de coches injectées',spec:{mode:'once',every:1,unit:'days',firstDue:new Date(Date.now()+86400000).toISOString(),steps:[{id:'a',title:'A'}],stepDone:{a:true}},requestId:id()});
assert.equal((await call(kid,'snapshot')).definitions.find(d=>d.title==='Pas de coches injectées').spec.stepDone,undefined);
console.log('OK V12 SQL : reprise unique, originaux/coches préservés, sans date, étapes, idempotence et droits.');await db.close();})().catch(e=>{console.error(e);process.exit(1)});
