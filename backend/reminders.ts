import { createClient } from 'npm:@supabase/supabase-js@2.102.0';
import webpush from 'npm:web-push@3.6.7';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args={}){const {data,error}=await admin.rpc(name,args);if(error)throw new Error('RPC_FAILED');return data;}
async function same(a:string,b:string){const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);return x.reduce((v,n,i)=>v|(n^y[i]),0)===0;}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{
 const config=await rpc('mm_push_worker_config');
 if(!config?.token||!await same(req.headers.get('authorization')||'','Bearer '+config.token))return new Response('Unauthorized',{status:401});
 if(!config.publicKey||!config.privateKey)return new Response('Notification setup required',{status:503});
 webpush.setVapidDetails(Deno.env.get('SUPABASE_URL')!,config.publicKey,config.privateKey);
 const jobs=await rpc('nm_push_claim');let sent=0,failed=0;
 for(let i=0;i<jobs.length;i+=5)await Promise.all(jobs.slice(i,i+5).map(async(job:any)=>{
 let status=500;
 try{
 if(!await rpc('nm_push_can_send',{p_id:job.id,p_lease:job.lease})){await rpc('nm_push_ack',{p_id:job.id,p_lease:job.lease,p_status:204});return;}
 const url=new URL(job.subscription.endpoint);if(url.protocol!=='https:'||url.hostname!=='fcm.googleapis.com'||url.port||url.username||url.password)throw Error('INVALID_ENDPOINT');
 const response=await webpush.sendNotification(job.subscription,JSON.stringify({jobId:job.id,userId:job.userId,body:'Un petit pas suffit. Retrouve tes missions dans Notre Maison.'}),{TTL:300,urgency:'normal',timeout:7000});status=response.statusCode;
 }catch(e:any){status=Number(e.statusCode)||500;}
 await rpc('nm_push_ack',{p_id:job.id,p_lease:job.lease,p_status:status});if(status>=200&&status<300)sent++;else failed++;
 }));
 return Response.json({sent,failed});
 }catch{return new Response('Worker unavailable',{status:503});}
});
