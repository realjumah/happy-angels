/* SmartSchool multi-school cloud layer — Firebase Auth + Cloud Firestore.
 *
 * How it works (read this before changing anything):
 *  - The app stays LOCAL-FIRST: everything is saved on the phone first, so selling works with no internet.
 *  - Every record (one product, one sale, one purchase, one expense...) is its own Firestore document.
 *    Only records that actually changed are written (efficient writes, and two phones editing
 *    DIFFERENT records never conflict).
 *  - Each phone remembers the newest server time it has seen and listens only for documents newer than that,
 *    so opening the app costs a handful of reads, not a re-download of the whole school (efficient reads).
 *  - Deleting a record writes a small "tombstone" so other phones learn about the deletion.
 *  - New record ids are made unique per phone, so two phones can never create the same id.
 */
(function(){
  'use strict';
  const CFG=window.SCH_FIREBASE||{};
  const FB=window.OKP_FB;

  // ---- what gets synced -------------------------------------------------------------------------
  // Arrays of records that each have a unique `id`. If you ever add a new array like this to the app, add it here.
  const COLS=['p','t','fi','pay'];            // arrays of records with a unique id
  const VIRT=['sc','cm','ta'];                   // keyed objects: one cloud record per pupil+term+period (sc), per comment (cm), per appraisal (ta)
  // Per-phone bookkeeping that must NOT be shared between phones.
  const LOCAL_ONLY=['id','rno','seed'];
  // Everything else at the top level of the data (school, L, staff, PL, mmr, lastSb ...) is synced as one small doc each.

  const LSK={ws:'sch_fb_ws_v1',base:'sch_fb_base_v1',cursor:'sch_fb_cursor_v1',lane:'sch_fb_lane_v1',idc:'sch_fb_idc_v1',conf:'sch_fb_conflicts_v1'};
  const OVERLAP_MS=120000;   // re-check the last 2 minutes on (re)start, in case of server clock skew
  const DEBOUNCE_MS=2500;    // wait for a pause in editing before saving to the cloud
  const CHUNK=400;           // Firestore allows 500 writes per batch; stay under it

  const $=s=>document.querySelector(s);
  const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lsGet=(k,d=null)=>{try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch{return d}};
  const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
  const lsDel=k=>{try{localStorage.removeItem(k)}catch{}};
  // 53-bit string hash (cyrb53) + length: used only to notice that a record changed.
  const H=str=>{let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (4294967296*(2097151&h2)+(h1>>>0)).toString(36)+'.'+str.length.toString(36)};
  const HR=rec=>H(JSON.stringify(rec));

  const state={
    app:null,auth:null,fs:null,user:null,
    ws:lsGet(LSK.ws),            // {schoolId, role, name, uid} once this phone is connected to a school
    pending:null,                // a school this account belongs to, waiting for "load onto this device"
    base:lsGet(LSK.base,{})||{}, // recordKey -> hash of the version last known to match the cloud ('x' = deleted)
    inflight:{},                 // recordKey -> hash currently being written
    cursor:Number(lsGet(LSK.cursor,0))||0,
    conf:lsGet(LSK.conf,[])||[],
    unsub:null,timer:null,working:false,again:false,paused:false,afterBusy:false,caughtUp:false,listenAt:0,
    status:'Not connected',members:null,inviteCode:null,renderPending:false,hiddenAt:0,idc:null
  };

  const configured=()=>!!(FB&&CFG.apiKey&&CFG.projectId&&!/PASTE|YOUR/i.test(String(CFG.apiKey)+String(CFG.projectId)));
  const online=()=>navigator.onLine!==false;

  function init(){
    if(state.fs)return true;
    if(!configured())return false;
    try{
      state.app=FB.initializeApp(CFG);
      state.auth=FB.getAuth(state.app);
      // Auto long-polling helps on weak/filtered mobile networks. In-memory cache: the phone's own copy is the app's local data.
      state.fs=FB.initializeFirestore(state.app,{experimentalAutoDetectLongPolling:true});
      FB.onAuthStateChanged(state.auth,onAuth);
      return true;
    }catch(e){status('Cloud could not start · '+(e.message||e));return false}
  }

  const R={
    user:uid=>FB.doc(state.fs,'users',uid),
    school:id=>FB.doc(state.fs,'schools',id),
    member:(id,uid)=>FB.doc(state.fs,'schools',id,'members',uid),
    members:id=>FB.collection(state.fs,'schools',id,'members'),
    recs:id=>FB.collection(state.fs,'schools',id,'records'),
    rec:(id,key)=>FB.doc(state.fs,'schools',id,'records',key),
    invite:code=>FB.doc(state.fs,'invites',code)
  };

  // ---- small helpers ------------------------------------------------------------------------------
  function status(s){state.status=s;const el=$('#cloudStatusLine');if(el)el.textContent=s;const b=$('#cloudStatusBtn');if(b)b.textContent='Cloud: '+(state.ws?'Connected':state.user?'Signed in':'Off');if(window.schSubHook)window.schSubHook()}
  function friendly(e){
    const c=(e&&e.code)||'';const m=(e&&e.message)||String(e);
    if(/email-already-in-use/.test(c))return 'That email already has an account. Sign in instead, or use “Forgot password”.';
    if(/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c))return 'Wrong email or password.';
    if(/weak-password/.test(c))return 'Password is too weak. Use at least 8 characters.';
    if(/invalid-email/.test(c))return 'That email address does not look right.';
    if(/too-many-requests/.test(c))return 'Too many attempts. Wait a few minutes and try again.';
    if(/network-request-failed|unavailable/.test(c))return 'No internet connection right now.';
    if(/permission-denied/.test(c))return 'The cloud refused this action. Make sure your email is verified, the invite code is current, and you are still a member of the school.';
    return m;
  }
  const parseKey=k=>{const i=k.indexOf(':');return{t:k.slice(0,i),k:k.slice(i+1)}};
  const persistBase=()=>{lsSet(LSK.base,state.base)};
  function persistLocal(){try{localStorage.setItem(K,JSON.stringify(S))}catch{}}
  function setWs(ws){state.ws=ws||null;if(ws)lsSet(LSK.ws,ws);else lsDel(LSK.ws)}
  function clearWs(){setWs(null);state.base={};state.cursor=0;state.inflight={};state.pending=null;state.inviteCode=null;state.members=null;lsDel(LSK.base);lsDel(LSK.cursor);stopListen()}
  function addConflict(key,note,theirs){state.conf.push({key,note,at:new Date().toISOString(),theirs});if(state.conf.length>50)state.conf=state.conf.slice(-50);lsSet(LSK.conf,state.conf)}
  const timeNow=()=>new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

  // ---- collect local records as syncable units --------------------------------------------------------
  function collect(){
    const map=new Map();let dupes=0;
    for(const c of COLS){
      const arr=Array.isArray(S[c])?S[c]:[];
      for(const r of arr){
        if(!r||r.id==null)continue;
        const key=c+':'+r.id;
        if(map.has(key)){dupes++;continue}
        const j=JSON.stringify(r);
        map.set(key,{t:c,k:String(r.id),j,h:H(j)});
      }
    }
    const put=(t,k,v)=>{const j=JSON.stringify(v);map.set(t+':'+k,{t,k:String(k),j,h:H(j)})};
    for(const pid of Object.keys(S.sc||{}))for(const tk of Object.keys(S.sc[pid]||{}))for(const per of Object.keys(S.sc[pid][tk]||{}))put('sc',pid+'|'+tk+'|'+per,S.sc[pid][tk][per]);
    for(const k of Object.keys(S.cm||{}))put('cm',k,S.cm[k]);
    for(const k of Object.keys(S.ta||{}))put('ta',k,S.ta[k]);
    for(const key of Object.keys(S)){
      if(COLS.includes(key)||VIRT.includes(key)||LOCAL_ONLY.includes(key)||S[key]===undefined)continue;
      put('@',key,S[key]);
    }
    return{map,dupes};
  }

  // ---- unique ids per phone (so two phones never create the same record id) ----------------------------
  function nextId(){
    if(!state.ws)return 0;                       // not connected: the app's normal counter is used
    let lane=lsGet(LSK.lane);
    if(!lane){const a=new Uint32Array(1);(window.crypto||{getRandomValues:x=>{x[0]=Math.floor(Math.random()*4e9)}}).getRandomValues(a);lane=1+(a[0]%8000000);lsSet(LSK.lane,lane)}
    if(state.idc==null){
      let mx=Number(lsGet(LSK.idc,0))||0;const lo=lane*1e9,hi=lo+1e9;
      for(const c of COLS)(S[c]||[]).forEach(r=>{const v=Number(r&&r.id);if(v>=lo&&v<hi)mx=Math.max(mx,v-lo)});
      state.idc=mx;
    }
    state.idc++;lsSet(LSK.idc,state.idc);
    return lane*1e9+state.idc;
  }

  // ---- apply incoming cloud documents to a data object ---------------------------------------------
  // T = the data object to change (the live `S`, or a fresh one while loading a school). fresh=true skips "local edit" checks.
  function applyItems(T,items,fresh){
    const idx={};let changed=false;
    const ensure=t=>{
      if(!idx[t]){
        const arr=Array.isArray(T[t])?T[t]:(T[t]=[]);const pos=new Map();
        arr.forEach((r,i)=>{if(r&&r.id!=null)pos.set(String(r.id),i)});
        idx[t]={arr,pos};
      }
      return idx[t];
    };
    const vsplit=k=>k.split('|');
    const getCur=(t,k)=>{
      if(t==='sc'){const[a,b,c]=vsplit(k);const v=(((T.sc||{})[a]||{})[b]||{})[c];return v===undefined?undefined:{rec:v}}
      if(t==='cm'||t==='ta'){const v=(T[t]||{})[k];return v===undefined?undefined:{rec:v}}
      if(t==='@')return T[k]===undefined?undefined:{rec:T[k]};
      const ix=ensure(t);const p=ix.pos.get(k);
      return p===undefined?undefined:{rec:ix.arr[p]};
    };
    const setCur=(t,k,rec)=>{
      if(t==='sc'){const[a,b,c]=vsplit(k);T.sc=T.sc||{};((T.sc[a]=T.sc[a]||{})[b]=T.sc[a][b]||{})[c]=rec;changed=true;return}
      if(t==='cm'||t==='ta'){(T[t]=T[t]||{})[k]=rec;return}
      if(t==='@'){T[k]=rec;return}
      const ix=ensure(t);const p=ix.pos.get(k);
      if(p===undefined){ix.arr.push(rec);ix.pos.set(k,ix.arr.length-1)}else ix.arr[p]=rec;
    };
    const delCur=(t,k)=>{
      if(t==='sc'){const[a,b,c]=vsplit(k);try{delete T.sc[a][b][c]}catch{}return}
      if(t==='cm'||t==='ta'){try{delete T[t][k]}catch{}return}
      if(t==='@')return;                          // single docs are never deleted
      const ix=ensure(t);const p=ix.pos.get(k);
      if(p!==undefined){ix.arr[p]=null;ix.pos.delete(k)}
    };
    for(const it of items){
      const {t,k}=parseKey(it.key);
      const cur=getCur(t,k);const bh=state.base[it.key];
      if(it.x){                                    // deleted elsewhere
        if(cur){
          if(!fresh&&HR(cur.rec)!==bh){addConflict(it.key,'Deleted on another device but edited here — kept on this device',null);continue}
          delCur(t,k);changed=true;
        }
        state.base[it.key]='x';continue;
      }
      let rec;try{rec=JSON.parse(it.j)}catch{continue}
      const nj=JSON.stringify(rec),ih=H(nj);
      if(cur){
        const lh=HR(cur.rec);
        if(lh===ih){state.base[it.key]=ih;continue}              // already identical
        if(!fresh&&lh!==bh){                                      // this phone has an unsynced edit of the same record
          if(t==='sc'&&ih!==bh){setCur(t,k,Object.assign({},rec,cur.rec));state.base[it.key]=ih;changed=true;continue}   // different subjects entered on two phones: keep both
          if(ih!==bh)addConflict(it.key,'Edited on two devices at once — this device’s version was kept',nj);
          continue;
        }
      }
      setCur(t,k,rec);state.base[it.key]=ih;changed=true;
    }
    for(const t of Object.keys(idx))T[t]=idx[t].arr.filter(r=>r!==null);
    return changed;
  }

  // ---- reading: listen only for documents newer than what this phone has already seen --------------------
  function stopListen(){if(state.unsub){try{state.unsub()}catch{}state.unsub=null}}
  function listen(sinceMs){
    stopListen();
    if(!state.ws||!state.fs||!state.user)return;
    const since=sinceMs!=null?sinceMs:Math.max(0,state.cursor-OVERLAP_MS);
    state.caughtUp=false;state.listenAt=Date.now();
    const q=FB.query(R.recs(state.ws.schoolId),FB.where('u','>',FB.Timestamp.fromMillis(since)),FB.orderBy('u'));
    state.unsub=FB.onSnapshot(q,onSnap,err=>{
      const c=(err&&err.code)||'';
      if(/permission-denied/.test(c))status('Cloud access denied · your email may be unverified or you were removed from the school. Records stay safe on this phone.');
      else status('Cloud listening paused · '+friendly(err));
      state.unsub=null;
    });
  }
  function onSnap(snap){
    state.caughtUp=true;                          // first answer from the cloud received: we now know what others changed
    const items=[];let maxU=state.cursor;
    snap.docChanges().forEach(ch=>{
      if(ch.type==='removed')return;
      const d=ch.doc;if(d.metadata&&d.metadata.hasPendingWrites)return;   // our own not-yet-confirmed write
      const x=d.data();const u=x.u&&x.u.toMillis?x.u.toMillis():0;
      if(u>maxU)maxU=u;
      items.push({key:d.id,x:!!x.x,j:x.j,u});
    });
    if(!items.length)return;
    items.sort((a,b)=>a.u-b.u);
    const changed=applyItems(S,items,false);
    if(maxU>state.cursor){state.cursor=maxU;lsSet(LSK.cursor,maxU)}
    persistBase();
    if(changed){persistLocal();status('Updated from another device · '+timeNow());rerenderSoon()}
  }

  // ---- writing: send only what changed --------------------------------------------------------------------
  async function push(){
    if(!state.user||!state.ws||!state.fs)return;
    if(state.working){state.again=true;return}
    if(state.paused)return;
    // After (re)connecting, first let the cloud tell us what other phones changed, THEN send our changes.
    if(state.unsub&&!state.caughtUp&&Date.now()-state.listenAt<8000){clearTimeout(state.timer);state.timer=setTimeout(push,1000);return}
    if(!online()){status('Offline · changes are saved on this phone and will sync later');return}
    state.working=true;
    try{
      const sid=state.ws.schoolId;const {map,dupes}=collect();const ops=[];
      for(const [key,v] of map){if(state.base[key]!==v.h&&state.inflight[key]!==v.h)ops.push({key,t:v.t,k:v.k,j:v.j,h:v.h,x:false})}
      let dels=0;
      for(const key of Object.keys(state.base)){
        if(state.base[key]!=='x'&&!map.has(key)&&state.inflight[key]!=='x'){const p=parseKey(key);ops.push({key,t:p.t,k:p.k,j:'',h:'x',x:true});dels++}
      }
      if(!ops.length){status((dupes?'Synced (warning: '+dupes+' records share an id and were skipped) · ':'Synced · ')+timeNow());return}
      const total=Object.keys(state.base).length;
      if(dels>=20&&dels>total*0.25){
        if(!confirm('This device is about to DELETE '+dels+' records from the shared school for every phone (for example after restoring an older backup). Continue?')){
          state.paused=true;status('Paused · a large delete was not confirmed. Tap “Sync now” to review.');return;
        }
      }
      status('Saving '+ops.length+' change'+(ops.length>1?'s':'')+'…');
      const jobs=[];
      for(let i=0;i<ops.length;i+=CHUNK){
        const chunk=ops.slice(i,i+CHUNK);const b=FB.writeBatch(state.fs);
        chunk.forEach(o=>{state.inflight[o.key]=o.h;b.set(R.rec(sid,o.key),{t:o.t,k:o.k,j:o.j,x:o.x,u:FB.serverTimestamp(),by:state.user.uid})});
        jobs.push(b.commit().then(()=>{chunk.forEach(o=>{state.base[o.key]=o.h;delete state.inflight[o.key]})},e=>{chunk.forEach(o=>{delete state.inflight[o.key]});throw e}));
      }
      const res=await Promise.allSettled(jobs);
      persistBase();
      const bad=res.find(r=>r.status==='rejected');
      if(bad)throw bad.reason;
      status('Synced · '+timeNow());
    }catch(e){
      const c=(e&&e.code)||'';
      if(/permission-denied/.test(c))status('The cloud refused the save · check that your email is verified and you are still a member. Your records are safe on this phone.');
      else{status('Pending sync · '+friendly(e));clearTimeout(state.timer);state.timer=setTimeout(push,30000)}
    }finally{
      state.working=false;
      if(state.again){state.again=false;clearTimeout(state.timer);state.timer=setTimeout(push,800)}
      rerenderLine();
    }
  }
  function markDirty(){
    if(!state.ws||!state.user)return;
    status(online()?'Changes waiting to sync…':'Offline · changes are saved on this phone');
    clearTimeout(state.timer);state.timer=setTimeout(push,DEBOUNCE_MS);
  }

  // ---- screen refresh that never interrupts typing or a sale in progress ----------------------------------------
  function safeToRender(){
    try{
      const md=$('#m');if(md&&!md.classList.contains('hide'))return false;
      const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return false;
      return true;
    }catch{return true}
  }
  function rerenderSoon(){
    if(typeof render!=='function')return;
    if(safeToRender()){state.renderPending=false;try{render()}catch{}}else state.renderPending=true;
  }
  function rerenderLine(){try{if(typeof tab!=='undefined'&&tab==='more'&&safeToRender()&&typeof render==='function')render()}catch{}}

  // ---- account ------------------------------------------------------------------------------------------------
  function onAuth(user){
    state.user=user||null;
    if(!user){stopListen();status(state.ws?'Signed out · records stay on this phone':'Not signed in');rerenderLine();return}
    afterAuth();
  }
  async function afterAuth(){
    const u=state.user;if(!u||state.afterBusy)return;state.afterBusy=true;
    try{
      if(!u.emailVerified){status('Verify your email to use the cloud');return}
      if(state.ws&&state.ws.uid===u.uid){connect();return}
      if(state.ws&&state.ws.uid!==u.uid)clearWs();
      const p=await FB.getDoc(R.user(u.uid));
      if(!p.exists()){status('Signed in · no school connected yet');return}
      const schoolId=p.data().schoolId;
      const m=await FB.getDoc(R.member(schoolId,u.uid));
      if(!m.exists()){status('Signed in · you are no longer a member of that school');try{await FB.deleteDoc(R.user(u.uid))}catch{}return}
      state.pending={schoolId,role:m.data().role,uid:u.uid};
      status('School found · load its records onto this phone to continue');
    }catch(e){status('Signed in · '+friendly(e))}
    finally{state.afterBusy=false;rerenderLine()}
  }
  function connect(){
    if(!state.ws||!state.user)return;
    status('Connected · checking for updates…');
    listen();
    clearTimeout(state.timer);state.timer=setTimeout(push,1500);
    rerenderLine();
  }
  async function signUp(){
    const email=($('#cloudEmail')?.value||'').trim(),pw=$('#cloudPassword')?.value||'';
    if(!email||!pw)return alert('Enter your email and a password (at least 8 characters).');
    if(pw.length<8)return alert('Use a password of at least 8 characters.');
    if(!init())return alert('Cloud is not configured yet.');
    try{
      const cr=await FB.createUserWithEmailAndPassword(state.auth,email,pw);
      state.user=cr.user;
      try{await FB.sendEmailVerification(cr.user)}catch{}
      openDialog();
    }catch(e){alert('Could not create account: '+friendly(e))}
  }
  async function signIn(){
    const email=($('#cloudEmail')?.value||'').trim(),pw=$('#cloudPassword')?.value||'';
    if(!email||!pw)return alert('Enter your email and password.');
    if(!init())return alert('Cloud is not configured yet.');
    try{
      const cr=await FB.signInWithEmailAndPassword(state.auth,email,pw);
      state.user=cr.user;await afterAuth();openDialog();
    }catch(e){alert('Sign in failed: '+friendly(e))}
  }
  async function resetPassword(){
    const email=($('#cloudEmail')?.value||'').trim();
    if(!email)return alert('Type your email in the box first, then tap “Forgot password”.');
    if(!init())return;
    try{await FB.sendPasswordResetEmail(state.auth,email);alert('If that email has an account, a reset link is on its way. Check spam too.')}catch(e){alert(friendly(e))}
  }
  async function resendVerify(){
    try{await FB.sendEmailVerification(state.user);alert('Verification email sent. Check your inbox and spam folder.')}catch(e){alert(friendly(e))}
  }
  async function checkVerified(){
    try{
      await state.user.reload();await state.user.getIdToken(true);
      if(!state.user.emailVerified)return alert('Not verified yet. Open the link in the email we sent, then try again.');
      await afterAuth();openDialog();
    }catch(e){alert(friendly(e))}
  }
  async function signOutNow(){
    const {map}=state.ws?collect():{map:new Map()};
    let waiting=false;if(state.ws){for(const [k,v] of map){if(state.base[k]!==v.h){waiting=true;break}}}
    if(waiting&&!confirm('Some changes have not reached the cloud yet. Sign out anyway? They stay on this phone.'))return;
    stopListen();clearTimeout(state.timer);
    try{await FB.signOut(state.auth)}catch{}
    state.user=null;state.inviteCode=null;state.members=null;status('Signed out');openDialog();rerenderLine();
  }

  // ---- school setup ------------------------------------------------------------------------------------------------
  const ALPHA='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function makeCode(){const a=new Uint8Array(16);(window.crypto||{getRandomValues:x=>{for(let i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*256)}}).getRandomValues(a);return Array.from(a,b=>ALPHA[b%32]).join('')}
  const normCode=s=>String(s||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
  const showCode=c=>String(c||'').replace(/(.{4})(?=.)/g,'$1-');

  async function serverNow(){
    const uid=state.user.uid;
    await FB.setDoc(R.user(uid),{seen:FB.serverTimestamp()},{merge:true});
    const s=await FB.getDocFromServer(R.user(uid));
    return s.data().seen.toMillis();
  }
  async function createWorkspace(){
    if(!state.user||!state.user.emailVerified)return alert('Verify your email first.');
    const name=($('#cloudSchoolName')?.value||'').trim().slice(0,120),desc=($('#cloudSchoolDesc')?.value||'').trim().slice(0,400);
    if(!name)return alert('Type your school name first.');
    if(!confirm('Create the school “'+name+'” in the cloud? Any records already on THIS phone will be uploaded to it. Download a backup first if you have not already.'))return;
    S.cfg.name=name;S.cfg.desc=desc;persistLocal();
    try{
      status('Creating school…');
      const uid=state.user.uid,schoolId=uid,code=makeCode();
      const b=FB.writeBatch(state.fs);
      b.set(R.school(schoolId),{name,desc,ownerUid:uid,at:FB.serverTimestamp()});
      b.set(R.member(schoolId,uid),{role:'owner',email:state.user.email,code,at:FB.serverTimestamp()});
      b.set(R.user(uid),{schoolId,role:'owner',at:FB.serverTimestamp()});
      b.set(R.invite(code),{schoolId,at:FB.serverTimestamp()});
      await b.commit();
      setWs({schoolId,role:'owner',name,uid});state.base={};state.cursor=0;state.inflight={};state.inviteCode=code;state.pending=null;
      status('Uploading records…');
      await push();
      const left=[...collect().map.keys()].filter(k=>state.base[k]===undefined);
      if(left.length)throw new Error('Upload incomplete ('+left.length+' records left). Tap “Sync now” to retry.');
      const now=await serverNow();state.cursor=now;lsSet(LSK.cursor,now);
      listen(now);
      status('Connected · school created');alert('Cloud school created. Share the invite code shown in this window only with trusted teachers.');
      openDialog();
    }catch(e){status('Could not finish setup · '+friendly(e));alert('Could not finish creating the school: '+friendly(e));openDialog()}
  }
  async function loadSchool(ws){
    // Download every record of the school once, replace this phone's records with them, then follow changes.
    status('Downloading school records…');
    const snap=await FB.getDocs(R.recs(ws.schoolId));
    const items=[];let maxU=0;
    snap.forEach(d=>{const x=d.data();const u=x.u&&x.u.toMillis?x.u.toMillis():0;if(u>maxU)maxU=u;items.push({key:d.id,x:!!x.x,j:x.j,u})});
    items.sort((a,b)=>a.u-b.u);
    const nd={id:(S&&S.id)||1,rno:1,seed:1,p:[],t:[],fi:[],pay:[],sc:{},cm:{},ta:{}};
    const savedBase=state.base;state.base={};
    applyItems(nd,items,true);
    if(!nd.cfg){state.base=savedBase;throw new Error('This school has no records in the cloud yet. Ask the owner to finish setting it up.')}
    S=nd;if(typeof mig==='function')mig();
    persistLocal();
    if(!ws.name&&S.cfg&&S.cfg.name)ws.name=S.cfg.name;setWs(ws);state.pending=null;state.cursor=maxU;lsSet(LSK.cursor,maxU);persistBase();
    listen();
    status('Connected · loaded '+items.length+' records');
    try{render()}catch{}
  }
  async function joinWorkspace(){
    if(!state.user||!state.user.emailVerified)return alert('Verify your email first.');
    const code=normCode($('#cloudInviteCode')?.value);
    if(code.length<16)return alert('Enter the full invite code from the school owner.');
    if(!confirm('Join this school? The records on THIS phone will be replaced by the shared school records. Download a backup first if this phone has records you need.'))return;
    try{
      const inv=await FB.getDoc(R.invite(code));
      if(!inv.exists())throw new Error('Invite code not found. Check it with the owner (it may have been replaced).');
      const schoolId=inv.data().schoolId,uid=state.user.uid;
      await FB.setDoc(R.member(schoolId,uid),{role:'staff',email:state.user.email,code,at:FB.serverTimestamp()});
      await FB.setDoc(R.user(uid),{schoolId,role:'staff',at:FB.serverTimestamp()});
      await loadSchool({schoolId,role:'staff',name:'',uid});
      alert('This phone is now connected to the shared school.');openDialog();
    }catch(e){status('Could not join · '+friendly(e));alert('Could not join the school: '+friendly(e))}
  }
  async function usePendingSchool(){
    const p=state.pending;if(!p)return;
    if(!confirm('Load the shared school records onto this phone? Records only on this phone will be replaced. Download a backup first if needed.'))return;
    try{await loadSchool({schoolId:p.schoolId,role:p.role,name:'',uid:state.user.uid});openDialog()}catch(e){alert('Could not load the school: '+friendly(e))}
  }
  async function reloadAll(){
    if(!state.ws)return;
    await push();
    if(!confirm('Download the whole school again and replace the records on this phone? Use this only if this phone looks out of date or damaged.'))return;
    try{await loadSchool(state.ws);openDialog()}catch(e){alert('Could not reload: '+friendly(e))}
  }
  async function syncNow(){
    if(!state.user)return openDialog();
    if(!state.ws)return openDialog();
    state.paused=false;
    if(!state.unsub)listen();
    await push();
    openDialog();
  }

  // ---- owner tools ---------------------------------------------------------------------------------------------------
  async function loadOwnerInfo(){
    if(!state.ws||state.ws.role!=='owner'||!state.user)return;
    try{
      const m=await FB.getDoc(R.member(state.ws.schoolId,state.user.uid));
      if(m.exists())state.inviteCode=m.data().code||null;
      const ms=await FB.getDocs(R.members(state.ws.schoolId));
      state.members=[];ms.forEach(d=>state.members.push({uid:d.id,...d.data()}));
      openDialog(true);
    }catch{}
  }
  async function newInviteCode(){
    if(!state.ws||state.ws.role!=='owner')return;
    if(!confirm('Create a new invite code? The old code will stop working for new teachers. Teachers already joined keep their access.'))return;
    try{
      const schoolId=state.ws.schoolId,uid=state.user.uid,old=state.inviteCode,code=makeCode();
      const b=FB.writeBatch(state.fs);
      if(old)b.delete(R.invite(old));
      b.set(R.invite(code),{schoolId,at:FB.serverTimestamp()});
      b.set(R.member(schoolId,uid),{role:'owner',email:state.user.email,code,at:FB.serverTimestamp()});
      await b.commit();state.inviteCode=code;openDialog(true);
    }catch(e){alert(friendly(e))}
  }
  async function removeMember(uid){
    if(!state.ws||state.ws.role!=='owner'||uid===state.user.uid)return;
    if(!confirm('Remove this person from the school? They will lose cloud access immediately. Records already on their phone stay there.'))return;
    try{await FB.deleteDoc(R.member(state.ws.schoolId,uid));state.members=(state.members||[]).filter(m=>m.uid!==uid);openDialog(true)}catch(e){alert(friendly(e))}
  }
  function downloadConflicts(){
    const blob=new Blob([JSON.stringify(state.conf,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='sch-sync-conflicts-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  }
  function clearConflicts(){state.conf=[];lsSet(LSK.conf,state.conf);openDialog()}

  // ---- screens ---------------------------------------------------------------------------------------------------------
  function panel(){
    let body;
    if(!configured())body='<p><b>Not set up yet.</b> The app works fully on this phone. To share records between phones, create a free Firebase project and paste its web settings into <code>firebase-config.js</code> (see README).</p>';
    else{
      const who=state.user?.email||'';
      body='<p id="cloudStatusLine">'+h(state.status)+'</p>'+
        (who?'<p>Signed in as <b>'+h(who)+'</b></p>':'<p>Sign in on each phone/computer with an account for this school.</p>')+
        (state.ws?'<p>School: <b>'+h(state.ws.name||'My School')+'</b> · role: '+h(state.ws.role||'member')+'</p>':'<p>No cloud school is connected on this phone yet.</p>')+
        (state.conf.length?'<p class="low"><b>'+state.conf.length+' record'+(state.conf.length>1?'s were':' was')+' edited on two devices at once.</b> Open Cloud settings to review.</p>':'')+
        '<button class="btn big" onclick="openSmartSchoolCloud()">'+(state.user?'Cloud & team settings':'Sign in / set up cloud')+'</button>';
    }
    return '<section class="stat" style="margin-bottom:12px;border:2px solid var(--acc)"><h2>☁ Cloud & team sync</h2>'+body+'</section>';
  }
  function openDialog(fromLoad){
    if(!configured()){modal('<h2>Cloud setup needed</h2><p>To share records between phones for free:</p><ol><li>Create a Firebase project and turn on Email/Password sign-in and Firestore.</li><li>Publish the <b>firestore.rules</b> file.</li><li>Paste the web app settings into <b>firebase-config.js</b>.</li><li>Publish the folder to GitHub Pages and reopen the app.</li></ol><p>The README has every step.</p><button class="btn" onclick="modal()">Close</button>');return}
    if(!init()){modal('<h2>Cloud could not start</h2><p>'+h(state.status)+'</p><button class="btn" onclick="modal()">Close</button>');return}
    if(!state.user){
      modal('<h2>Cloud sign in</h2><p>Create one account for each person. Then sign in with it on their phone.</p><label>Email</label><input id="cloudEmail" type="email" autocomplete="username" placeholder="you@example.com"><label>Password (minimum 8 characters)</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"><button class="btn big" onclick="schCloudSignIn()">Sign in</button><button class="btn" onclick="schCloudSignUp()">Create account</button><button class="btn" onclick="schCloudReset()">Forgot password</button><button class="btn" onclick="modal()">Cancel</button>');return;
    }
    if(!state.user.emailVerified){
      modal('<h2>Verify your email</h2><p>We sent a link to <b>'+h(state.user.email||'')+'</b>. Open it (check spam too), then tap the button below.</p><button class="btn big" onclick="schCloudCheckVerified()">I have verified my email</button><button class="btn" onclick="schCloudResend()">Send the email again</button><button class="btn" onclick="schCloudSignOut()">Sign out</button><button class="btn" onclick="modal()">Close</button>');return;
    }
    if(!state.ws){
      if(state.pending){
        modal('<h2>Your school is in the cloud</h2><p>Signed in as <b>'+h(state.user.email||'')+'</b>. Load the shared records onto this phone to start syncing.</p><button class="btn big" onclick="schCloudUsePending()">Load school records onto this phone</button><button class="btn" onclick="schCloudSignOut()">Sign out</button><button class="btn" onclick="modal()">Close</button>');return;
      }
      modal('<h2>Set up your school in the cloud</h2><p>Signed in as <b>'+h(state.user.email||'')+'</b>. The <b>head teacher / owner</b> creates the school here. Teachers join with the invite code from the owner.</p><label>School name (owner only)</label><input id="cloudSchoolName" value="'+h((S.cfg&&S.cfg.name&&S.cfg.name!=='My School')?S.cfg.name:'')+'" placeholder="e.g. Bright Future Primary School"><label>Short description (optional)</label><input id="cloudSchoolDesc" value="'+h((S.cfg&&S.cfg.desc)||'')+'" placeholder="e.g. Nursery and Primary, Arua"><button class="btn big" onclick="schCloudCreate()">Create my school</button><hr><label>Invite code (teachers)</label><input id="cloudInviteCode" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX"><button class="btn" onclick="schCloudJoin()">Join existing school</button><button class="btn" onclick="schCloudSignOut()">Sign out</button><button class="btn" onclick="modal()">Close</button>');return;
    }
    const w=state.ws,owner=w.role==='owner';
    if(owner&&!fromLoad&&state.members===null)setTimeout(loadOwnerInfo,0);
    const code=owner?(state.inviteCode?'<label>Teacher invite code (share privately)</label><input readonly value="'+h(showCode(state.inviteCode))+'" onclick="this.select()"><small>Anyone with this code and a verified account can join and edit this school’s records.</small><button class="btn" onclick="schCloudNewCode()">Make a new invite code</button>':'<small>Loading invite code…</small>'):'';
    const mem=owner&&state.members?'<h3>People with access</h3>'+state.members.map(m=>'<div class="stat" style="margin:6px 0"><b>'+h(m.email||m.uid)+'</b> · '+h(m.role)+(m.role!=='owner'?'<br><button class="btn del" onclick="schCloudRemove(\''+h(m.uid)+'\')">Remove</button>':'')+'</div>').join(''):'';
    const conf=state.conf.length?'<div class="stat"><b class="low">'+state.conf.length+' edit conflict'+(state.conf.length>1?'s':'')+'</b><p>Two phones changed the same record at once. The version on the phone that saved last was kept. A copy of the other version is saved in a file in case you need it.</p><button class="btn" onclick="schCloudConflictsDl()">Download conflict copies</button><button class="btn" onclick="schCloudConflictsClear()">Mark as reviewed</button></div>':'';
    modal('<h2>Cloud & team settings</h2><p>Signed in as <b>'+h(state.user.email||'')+'</b></p><p>School: <b>'+h(w.name||'My School')+'</b><br>Role: '+h(w.role||'member')+'</p><p id="cloudStatusLine">'+h(state.status)+'</p>'+code+mem+conf+'<button class="btn big" onclick="schCloudSyncNow()">Sync now</button><button class="btn" onclick="schCloudReload()">Download whole school again</button><button class="btn" onclick="schCloudSignOut()">Sign out</button><button class="btn" onclick="modal()">Close</button>');
  }

  // ---- public hooks used by index.html ----------------------------------------------------------------------------------------
  window.openSmartSchoolCloud=()=>openDialog();
  window.schCloudSignUp=signUp;window.schCloudSignIn=signIn;window.schCloudReset=resetPassword;
  window.schCloudResend=resendVerify;window.schCloudCheckVerified=checkVerified;
  window.schCloudCreate=createWorkspace;window.schCloudJoin=joinWorkspace;window.schCloudUsePending=usePendingSchool;
  window.schCloudSyncNow=syncNow;window.schCloudReload=reloadAll;window.schCloudSignOut=signOutNow;
  window.schCloudNewCode=newInviteCode;window.schCloudRemove=removeMember;
  window.schCloudConflictsDl=downloadConflicts;window.schCloudConflictsClear=clearConflicts;
  window.schCloudMarkDirty=markDirty;
  window.schCloudPanel=panel;
  window.schNextId=nextId;
  window.schCloudCore={FB,get state(){return state}};  // used by subscription.js

  window.addEventListener('online',()=>{if(state.ws&&state.user){if(!state.unsub)listen();push()}});
  window.addEventListener('offline',()=>{if(state.ws)status('Offline · changes are saved on this phone')});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){state.hiddenAt=Date.now();return}
    // Coming back after a while: restart the listener from the newest time seen, so a long-running listener never re-reads old changes.
    if(state.ws&&state.user&&state.hiddenAt&&Date.now()-state.hiddenAt>300000){listen();push()}
    state.hiddenAt=0;
  });
  setInterval(()=>{if(state.renderPending)rerenderSoon()},3000);

  window.addEventListener('load',()=>{
    // Ask before restoring a backup on a phone that shares records with others.
    try{
      const oldRb=window.rbo;
      if(typeof oldRb==='function')window.rbo=function(){
        if(state.ws&&!confirm('This phone is connected to the shared school. Restoring a backup will replace the records on EVERY connected phone. Continue only if that is what you want.'))return;
        return oldRb.apply(this,arguments);
      };
    }catch{}
    try{render()}catch{}
    if(init()){status(state.ws?'Connecting…':'Not signed in')}else status(configured()?'Cloud could not start':'Not configured');
  });

  if(window.OKP_TEST)window.schCloudInternals={state,collect,applyItems,push,onSnap,listen,nextId,loadSchool,createWorkspace,H,HR,markDirty,setWs,init,onAuth,afterAuth};
})();
