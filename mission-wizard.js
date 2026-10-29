/* One form contract shared by phone and tablet. */
(function(root){'use strict';
 function id(){return root.crypto?.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
 function steps(text,previous=[]){
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  if(lines.length>300)throw Error('Limite : 300 étapes.');
  const used=new Set();return lines.map((line,i)=>{
   const m=/^(\d{2}:\d{2})\s+(.+)$/.exec(line),title=m?m[2]:line,time=m?m[1]:'';
   if(title.length>500||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Étape ou horaire invalide.');
   const old=previous.find(s=>s.title===title&&!used.has(s.id))||(!used.has(previous[i]?.id)?previous[i]:null);
   const hash=[...(title+'|'+time)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);const key=old?.id||('step-'+i+'-'+hash.toString(36));used.add(key);return {id:key,title,time};
  });
 }
 function build(values,previous){
  const title=String(values.title||'').trim();if(!title||title.length>500)throw Error('Indique le nom de la mission.');
  const mode=values.mode;if(!['none','once','fixed','relative'].includes(mode))throw Error('Choisis quand faire cette mission.');
  if(!['annabelle','papa','maman'].includes(values.person))throw Error('Choisis une personne.');
  const spec={mode,every:Number(values.every||1),unit:values.unit||'days',steps:steps(values.steps||'',previous?.spec?.steps||[]),ui:{...(previous?.spec?.ui||{}),listId:values.groupId||'general',title:values.groupTitle||'Maison',icon:values.icon||'🌿',visualTheme:values.visualTheme||previous?.spec?.ui?.visualTheme||'inherit'},reminder:mode!=='none'&&!!values.reminder,reminderTime:values.reminderTime||'',reminderDelay:Number(values.reminderDelay||15),reminderCount:Number(values.reminderCount??0)};
  if(mode!=='none'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(values.date||''))throw Error('Choisis une date.');
   spec.firstDue=values.date+'T'+(values.time||'00:00');spec.dueType=values.time?'time':'day';
   if(mode==='fixed'){spec.days=values.days;if(!spec.days?.length)throw Error('Choisis au moins un jour.');}
   if(!Number.isInteger(spec.every)||spec.every<1||spec.every>365)throw Error('Choisis un intervalle entre 1 et 365.');
   if(values.period){spec.period=values.period;spec.periodStart=values.periodStart??previous?.spec?.periodStart??'';spec.periodEnd=values.periodEnd??previous?.spec?.periodEnd??'';}
  }
  const normalize=s=>JSON.stringify({mode:s.mode,every:s.every||1,unit:s.unit||'days',firstDue:s.firstDue||'',period:s.period||'',periodStart:s.periodStart||'',periodEnd:s.periodEnd||'',days:s.mode==='fixed'?(s.days||[0,1,2,3,4,5,6]).slice().sort():[],dueType:s.dueType||'time'});
  return {person:values.person,title,spec,replaceSchedule:!!previous&&normalize(previous.spec)!==normalize(spec)};
 }
 const api={id,steps,build};if(typeof module==='object')module.exports=api;else root.MissionWizard=api;
})(typeof globalThis==='object'?globalThis:this);
