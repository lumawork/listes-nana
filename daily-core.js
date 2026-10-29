/* Projection sans écriture des anciennes listes : aucune date n'est déduite du nom. */
(function(root){
 'use strict';
 const parisParts=(now)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 function legacyGroups(lists,now=Date.now(),migrated=()=>false){
  const p=parisParts(now),today=`${p.year}-${p.month}-${p.day}`,weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday);
  return lists.filter(l=>!migrated(l.id)&&['daily','weekly'].includes(l.resetMode)&&(!l.pausedUntil||l.pausedUntil<today)&&(!l.activeDays||l.activeDays.includes(weekday))).map(l=>({list:l,tasks:l.tasks.filter(t=>!t.done)})).filter(g=>g.tasks.length);
 }
 function initialPerson(snapshot,userId,remembered=''){
  if(snapshot.personScope)return snapshot.personScope;
  const own=snapshot.config.people.find(p=>p.userId===userId);
  if(own)return own.id;
  return snapshot.config.people.some(p=>p.id===remembered)?remembered:'';
 }
 const api={legacyGroups,initialPerson};
 if(typeof module==='object')module.exports=api;else root.MissionsDailyCore=api;
})(typeof globalThis==='object'?globalThis:this);
