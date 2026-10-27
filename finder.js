/* finder.js (school) — search + filters inside the app.
 *  1) A filter bar (text + optional dates) appears on long list pages (expenses, payroll, calendar, teachers, reports, enrolment ...).
 *  2) The round 🔍 button opens "Search everything": pupils, fee receipts, teachers, expenses, events, links, fee items.
 */
(function(){
'use strict';
const X=window.X=window.X||{};
const esc2=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const words=q=>String(q||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
const hit=(t,w)=>w.every(k=>new RegExp('(^|[^a-z0-9])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(t));  // every typed word must start a word in the text

/* ---------- 1) filter bar on list pages ---------- */
window.XF=window.XF||{k:'',q:'',from:'',to:'',on:false,dates:false};
const SKIP=['home','pup','fee','more'];
function key(){const c=[...document.querySelectorAll('#v .chip.on')].map(e=>e.textContent).join(','),s=[...document.querySelectorAll('#v select')].map(e=>e.value).join(',');return [tab,typeof sb!='undefined'?sb:'',c,s].join('|')}
function units(){const mn=document.getElementById('v');if(!mn)return[];const a=[...mn.querySelectorAll('.item')].filter(e=>!e.closest('#xf'));
 mn.querySelectorAll('table').forEach(t=>t.querySelectorAll('tr').forEach(r=>{if(r.querySelector('td'))a.push(r)}));return a}
function dateOf(el){const t=el.textContent||'';let m=t.match(/\d{4}-\d{2}-\d{2}/);if(m)return m[0];m=t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');return''}
function applyF(){const F=window.XF,w=words(F.q),L=units();let shown=0;
 L.forEach(el=>{let ok=true;if(w.length)ok=hit((el.textContent||'').toLowerCase(),w);
  if(ok&&(F.from||F.to)){const d=dateOf(el);if(d)ok=(!F.from||d>=F.from)&&(!F.to||d<=F.to)}
  el.style.display=ok?'':'none';if(ok)shown++});
 const n=document.getElementById('xfn');if(n)n.textContent=(F.q||F.from||F.to)?shown+' of '+L.length+' shown':'';
 const c=document.getElementById('xfc');if(c)c.classList.toggle('hide',!(F.q||F.from||F.to))}
X.fq=v=>{XF.q=v;XF.on=!!(XF.q||XF.from||XF.to);applyF()};
X.ff=v=>{XF.from=v;XF.on=!!(XF.q||XF.from||XF.to);applyF()};
X.ft=v=>{XF.to=v;XF.on=!!(XF.q||XF.from||XF.to);applyF()};
X.fc=()=>{XF.q='';XF.from='';XF.to='';XF.on=false;document.querySelectorAll('#xf input').forEach(i=>i.value='');applyF()};
X.fd=()=>{XF.dates=!XF.dates;const e=document.getElementById('xfd');if(e)e.classList.toggle('hide',!XF.dates)};
window.xAfter=function(){try{
 const mn=document.getElementById('v');if(!mn)return;const k=key();
 if(XF.k!==k){XF.k=k;XF.q='';XF.from='';XF.to='';XF.on=false;XF.dates=false}
 const old=document.getElementById('xf');if(old)old.remove();
 if(SKIP.includes(tab)||mn.querySelector('input[placeholder*="earch"]'))return;
 const L=units();if(L.length<5&&!XF.on)return;const first=L[0];if(!first)return;
 const host=first.closest('table')||first,bar=document.createElement('div');bar.id='xf';bar.style.cssText='margin:0 0 10px';
 const sh=XF.dates||XF.from||XF.to;
 bar.innerHTML='<div style="display:flex;gap:6px"><input id="xfq" type="search" placeholder="🔍 Filter this list (name, item, date…)" autocomplete="off" style="margin:0" value="'+esc2(XF.q)+'" oninput="X.fq(this.value)"><button class="btn" style="margin:0;width:auto;padding:0 12px" onclick="X.fd()" aria-label="Filter by date">📅</button><button id="xfc" class="btn hide" style="margin:0;width:auto;padding:0 12px" onclick="X.fc()" aria-label="Clear filter">✕</button></div><div id="xfd" class="'+(sh?'':'hide')+'" style="display:flex;gap:6px;margin-top:6px"><div style="flex:1"><label>From</label><input type="date" style="margin:0" value="'+XF.from+'" onchange="X.ff(this.value)"></div><div style="flex:1"><label>To</label><input type="date" style="margin:0" value="'+XF.to+'" onchange="X.ft(this.value)"></div></div><small id="xfn" style="display:block;margin-top:4px"></small>';
 host.parentNode.insertBefore(bar,host);
 if(XF.on)applyF();
}catch(e){console.error(e)}};

/* ---------- 2) search everything ---------- */
let G={q:'',scope:'all',from:'',to:'',res:[]};
function corpus(){const C=[];
 const add=(sec,date,title,sub,right,text,open)=>C.push({sec,date:date||'',title,sub,right,text:(title+' '+sub+' '+text+' '+(date||'')).toLowerCase(),open});
 S.p.forEach(p=>add('Pupils','',p.name,[p.cls,p.lin&&'LIN '+p.lin,p.par].filter(Boolean).join(' · '),'',(p.tel||'')+' '+(p.tel2||'')+' '+(p.dist||'')+' '+(p.rel||'')+' '+(p.lin||''),()=>{cm();pf(p.id)}));
 S.pay.forEach(x=>{const p=P(x.pid),d=ldate(new Date(x.t)),t=sum(x.lines,l=>l.a);add('Fee receipts',d,x.no+' · '+(p?p.name:'?'),new Date(x.t).toLocaleDateString('en-GB')+' · '+(p?p.cls:'')+' · '+x.method,fmt(t),(x.ref||'')+' '+(x.payer||'')+' '+(x.rcv||'')+' '+x.lines.map(l=>{const i=FI(l.i);return i?i.name:''}).join(' '),()=>rcpt(x.id))});
 S.ex.forEach(e=>add('Expenses',e.d,(e.desc||e.cat),new Date(e.d).toLocaleDateString('en-GB')+' · '+e.cat,fmt(e.amt),(e.to||'')+' '+(e.by||'')+' '+(e.ref||''),()=>exv(e.id)));
 S.t.forEach(t=>add('Teachers & staff','',t.name,[t.role,t.qual].filter(Boolean).join(' · '),'',(t.tel||'')+' '+(t.nin||'')+' '+(t.sj||'')+' '+arr(t.cls).join(' '),()=>{cm();tv(t.id)}));
 S.ev.forEach(e=>add('Calendar',e.d,e.title,fdm(e.d)+' · '+(e.type||''),'',e.note||'',()=>evf_(e.id)));
 S.dl.forEach(l=>add('Exam links','',l.title,(l.cls||'')+' '+tlab(l.tk||''),'',l.url||'',()=>dlf(l.id)));
 S.fi.forEach(i=>add('Fee items','',i.name,'',' ','',()=>efi(i.id)));
 return C}
function scopes(C){const o=[['all','All']],seen={};C.forEach(c=>{if(!seen[c.sec]){seen[c.sec]=1;o.push([c.sec,c.sec])}});return o}
function results(){const C=corpus(),w=words(G.q);G.res=[];
 let L=C.filter(c=>(G.scope=='all'||c.sec==G.scope)&&hit(c.text,w));
 if(G.from||G.to)L=L.filter(c=>c.date&&(!G.from||c.date>=G.from)&&(!G.to||c.date<=G.to));
 const order=[],by={};L.forEach(c=>{if(!by[c.sec]){by[c.sec]=[];order.push(c.sec)}by[c.sec].push(c)});
 let h='',n=0;order.forEach(sec=>{const A=by[sec].sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0),cap=G.scope=='all'?8:60;
  h+='<h3>'+esc2(sec)+' ('+A.length+')</h3>';A.slice(0,cap).forEach(c=>{G.res.push(c);h+='<button class="item" data-i="'+(G.res.length-1)+'"><span class="nm"><b>'+esc2(c.title)+'</b><small>'+esc2(c.sub)+'</small></span><span class="pr">'+esc2(c.right)+'</span></button>'});
  if(A.length>cap)h+='<button class="btn" data-sc="'+esc2(sec)+'">Show all '+A.length+' in '+esc2(sec)+'</button>';n+=A.length});
 if(!w.length&&!G.from&&!G.to)return{h:'<div class="empty">Type a pupil or teacher name, LIN, receipt number, phone or item.<br><small>Use the chips to search one area only, or pick dates.</small></div>'};
 return{h:n?h:'<div class="empty">Nothing found</div>'}}
X.gs=function(keep){if(!keep&&!G.q)G.scope='all';const C=corpus(),chips=scopes(C).map(([k,l])=>'<button data-sc="'+esc2(k)+'" class="chip'+(G.scope==k?' on':'')+'">'+esc2(l)+'</button>').join('');
 modal('<h2>🔍 Search everything</h2><input id="gsq" type="search" placeholder="Name, LIN, receipt no., phone…" autocomplete="off" value="'+esc2(G.q)+'"><div class="cb2" id="gsc">'+chips+'</div><div style="display:flex;gap:6px"><div style="flex:1"><label>From date</label><input id="gsf" type="date" value="'+G.from+'"></div><div style="flex:1"><label>To date</label><input id="gst" type="date" value="'+G.to+'"></div></div><div id="gsr"></div><button class="btn" onclick="cm()">Close</button>');
 const q=document.getElementById('gsq'),r=document.getElementById('gsr');
 const draw=()=>{r.innerHTML=results().h;document.querySelectorAll('#gsc .chip').forEach(b=>b.classList.toggle('on',b.dataset.sc==G.scope))};
 q.oninput=()=>{G.q=q.value;draw()};document.getElementById('gsf').onchange=e=>{G.from=e.target.value;draw()};document.getElementById('gst').onchange=e=>{G.to=e.target.value;draw()};
 document.getElementById('gsc').onclick=e=>{const b=e.target.closest('button');if(b){G.scope=b.dataset.sc;draw()}};
 r.onclick=e=>{const b=e.target.closest('[data-i]');if(b){const c=G.res[+b.dataset.i];if(c)c.open();return}const s=e.target.closest('[data-sc]');if(s){G.scope=s.dataset.sc;draw()}};
 draw();if(!keep)q.focus()};

function mkBtn(){if(document.getElementById('gsb'))return;const b=document.createElement('button');b.id='gsb';b.setAttribute('aria-label','Search everything');b.textContent='🔍';b.onclick=()=>X.gs();document.body.appendChild(b);
 const s=document.createElement('style');s.textContent='#gsb{position:fixed;right:14px;bottom:calc(76px + env(safe-area-inset-bottom,0px));width:48px;height:48px;border-radius:50%;border:2px solid var(--acc);background:var(--card);color:var(--ink);font-size:20px;box-shadow:0 2px 8px #0006;z-index:5;cursor:pointer}@media print{#gsb,#xf{display:none!important}}';document.head.appendChild(s)}
if(document.body)mkBtn();else document.addEventListener('DOMContentLoaded',mkBtn);
})();
