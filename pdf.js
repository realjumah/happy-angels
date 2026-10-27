/* pdf.js (school) — makes real PDF files on the phone, no outside library, works offline.
 *   X.receipt(id,share)        fees receipt as PDF
 *   X.voucher(id,share)        expense payment voucher as PDF
 *   X.reportCard(id,share)     one pupil's report card as PDF
 *   X.classCards(share)        report cards for the whole class (class chosen on Assess > Reports), one PDF
 *   X.report(share)            WHOLE SCHOOL report as PDF (summary, enrolment, pupils, staff, fees, payments, expenses...)
 *   X.backup(share)            BACKUP as PDF: readable report + hidden full copy of the data, restorable
 *   X.pdfText(file)            reads a backup PDF and returns the backup text (used by Restore)
 * share=true opens the phone's share sheet (WhatsApp, email, Drive...); otherwise the file is downloaded.
 */
(function(){
'use strict';
const fm=n=>Math.round(+n||0).toLocaleString('en-US');
const WR=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const MAP={0x2013:150,0x2014:151,0x2018:145,0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2026:133,0x20AC:128,0x2122:153,0x2212:45,0x2192:62,0x2190:60,0x2713:42,0x2022:149};
function enc(s){s=String(s==null?'':s);let o='';for(const ch of s){const c=ch.codePointAt(0);if(c>=32&&c<=126)o+=ch;else if(c>=160&&c<=255)o+=ch;else if(c==9)o+=' ';else if(MAP[c])o+=String.fromCharCode(MAP[c]);}return o}
function tw(s,sz,b){s=enc(s);let w=0;const T=b?WB:WR;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);w+=(c>=32&&c<=126)?T[c-32]:(c==150||c==151?556:556)}return w*sz/1000}
function pesc(s){return enc(s).replace(/[\\()]/g,'\\$&')}
function lat(s){const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i)&255;return b}
function rgb(h){h=String(h||'').trim().replace('#','');if(/^[0-9a-f]{3}$/i.test(h))h=h.split('').map(x=>x+x).join('');if(!/^[0-9a-f]{6}$/i.test(h))return '0 0 0';return [0,2,4].map(i=>(parseInt(h.substr(i,2),16)/255).toFixed(3)).join(' ')}
function theme(){let cs=null;try{cs=getComputedStyle(document.documentElement)}catch(e){}const g=(n,d)=>{const v=cs&&cs.getPropertyValue(n).trim();return v||d};
 return{acc:rgb(g('--acc','#7cb83a')),accInk:rgb(g('--accink','#10240b')),head:rgb(g('--head','#1c3a1f')),ink:'0.13 0.13 0.13',mut:'0.40 0.40 0.40',line:'0.80 0.80 0.80',zebra:'0.955 0.955 0.955',bad:'0.75 0.22 0.17',ok:'0.09 0.47 0.31',white:'1 1 1'}}

class Doc{
 constructor(o){o=o||{};this.w=o.w||595.28;this.h=o.h||841.89;this.m=o.m==null?40:o.m;this.fb=o.footer===false?0:1;this.foot=o.foot||'';this.pages=[];this.ims=[];this.T=theme();this.np()}
 get cw(){return this.w-2*this.m}
 get bot(){return this.m+(this.fb?14:0)}
 np(){this.c=[];this.pages.push(this.c);this.y=this.h-this.m}
 used(){return this.h-this.y+this.m}
 need(h){if(this.y-h<this.bot){this.np();return true}return false}
 text(s,x,y,sz,b,col){if(s===''||s==null)return;this.c.push('BT /F'+(b?2:1)+' '+sz+' Tf '+(col||this.T.ink)+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' Td ('+pesc(s)+') Tj ET')}
 rect(x,y,w,h,col){this.c.push(col+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' '+w.toFixed(2)+' '+h.toFixed(2)+' re f')}
 line(x1,y1,x2,y2,col,lw){this.c.push((col||this.T.line)+' RG '+(lw||0.6)+' w '+x1.toFixed(2)+' '+y1.toFixed(2)+' m '+x2.toFixed(2)+' '+y2.toFixed(2)+' l S')}
 dash(y){this.c.push(this.T.mut+' RG 0.5 w [2 2] 0 d '+this.m+' '+y.toFixed(2)+' m '+(this.w-this.m)+' '+y.toFixed(2)+' l S [] 0 d')}
 img(im,x,y,w,h){let k=this.ims.indexOf(im);if(k<0){this.ims.push(im);k=this.ims.length-1}this.c.push('q '+w.toFixed(2)+' 0 0 '+h.toFixed(2)+' '+x.toFixed(2)+' '+y.toFixed(2)+' cm /Im'+k+' Do Q')}
 wrap(s,w,sz,b,max){const out=[];String(s==null?'':s).split('\n').forEach(par=>{if(!par.trim()){out.push('');return}let cur='';par.split(/\s+/).filter(Boolean).forEach(word=>{let t=cur?cur+' '+word:word;if(tw(t,sz,b)<=w){cur=t;return}if(cur)out.push(cur);cur='';while(tw(word,sz,b)>w&&word.length>1){let n=word.length-1;while(n>1&&tw(word.slice(0,n),sz,b)>w)n--;out.push(word.slice(0,n));word=word.slice(n)}cur=word});if(cur)out.push(cur)});if(max&&out.length>max){out.length=max;out[max-1]=out[max-1].replace(/.{0,2}$/,'')+'…'}return out.length?out:['']}
 // one line of text at the cursor; a = 'l' | 'c' | 'r'
 para(s,o){o=o||{};const sz=o.size||9,b=o.bold,lh=sz*1.32,lines=this.wrap(s,this.cw-(o.indent||0),sz,b);lines.forEach(l=>{this.need(lh);this.y-=lh;const x=o.a=='c'?this.m+(this.cw-tw(l,sz,b))/2:o.a=='r'?this.w-this.m-tw(l,sz,b):this.m+(o.indent||0);this.text(l,x,this.y+sz*0.25,sz,b,o.col)});this.y-=(o.gap==null?2:o.gap)}
 h2(s){this.need(46);this.y-=14;this.rect(this.m,this.y-4,3,15,this.T.acc);this.text(s,this.m+9,this.y,12,1,this.T.head);this.y-=10}
 grid(items,cols){cols=cols||3;const g=6,bw=(this.cw-(cols-1)*g)/cols,bh=36;for(let i=0;i<items.length;i+=cols){this.need(bh+g);const top=this.y;items.slice(i,i+cols).forEach((it,j)=>{const x=this.m+j*(bw+g);this.rect(x,top-bh,bw,bh,this.T.zebra);this.rect(x,top-bh,2.5,bh,this.T.acc);this.text(it[0],x+9,top-12,7.5,0,this.T.mut);const bad=it[2]=='bad'||(typeof it[1]=='number'&&it[1]<0);const v=typeof it[1]=='number'?fm(it[1]):String(it[1]);this.text(v,x+9,top-28,12.5,1,bad?this.T.bad:this.T.ink)});this.y-=bh+g}this.y-=2}
 table(cols,rows,o){o=o||{};const sz=o.size||8,lh=sz*1.3,pad=3,cw=this.cw,ws=cols.map(c=>c.w*cw),T=this.T;
  const head=()=>{const HL=cols.map((c,i)=>this.wrap(c.h||'',ws[i]-pad*2,sz,1,3)),n=Math.max(1,...HL.map(l=>l.length)),h=n*lh+pad*2;this.need(h+lh*2+pad*2);this.rect(this.m,this.y-h,cw,h,T.head);let x=this.m;cols.forEach((c,i)=>{HL[i].forEach((t,k)=>{const tx=c.a=='r'?x+ws[i]-pad-tw(t,sz,1):c.a=='c'?x+(ws[i]-tw(t,sz,1))/2:x+pad;this.text(t,tx,this.y-pad-sz*0.85-k*lh,sz,1,T.white)});x+=ws[i]});this.y-=h};
  if(!rows.length){this.para(o.empty||'Nothing recorded.',{size:8.5,col:T.mut,gap:4});return}
  head();let zi=0;
  rows.forEach(r=>{const cells=r.c||r,bold=!!r.b,L=cells.map((t,i)=>this.wrap(t,ws[i]-pad*2,sz,bold||cols[i].b,o.maxLines||5)),n=Math.max(1,...L.map(l=>l.length)),h=n*lh+pad*2;
   if(this.y-h<this.bot){this.np();head()}
   if(r.b){this.rect(this.m,this.y-h,cw,h,T.zebra);this.line(this.m,this.y,this.m+cw,this.y,T.mut,0.7)}else if(zi++%2)this.rect(this.m,this.y-h,cw,h,T.zebra);
   let x=this.m;L.forEach((ls,i)=>{ls.forEach((l,k)=>{const b=bold||cols[i].b,tx=cols[i].a=='r'?x+ws[i]-pad-tw(l,sz,b):cols[i].a=='c'?x+(ws[i]-tw(l,sz,b))/2:x+pad;this.text(l,tx,this.y-pad-sz*0.85-k*lh,sz,b,(cols[i].bad&&String(cells[i]).charAt(0)=='-')?T.bad:null)});x+=ws[i]});
   this.y-=h});
  this.line(this.m,this.y,this.m+cw,this.y,T.line,0.5);this.y-=8}
 finish(emb,meta){const N=this.pages.length,T=this.T;
  if(this.fb)this.pages.forEach((c,i)=>{const y=this.m*0.5+2;c.push(T.line+' RG 0.5 w '+this.m+' '+(y+10)+' m '+(this.w-this.m)+' '+(y+10)+' l S');
   c.push('BT /F1 7.5 Tf '+T.mut+' rg '+this.m+' '+y+' Td ('+pesc(this.foot)+') Tj ET');const pg='Page '+(i+1)+' of '+N;c.push('BT /F1 7.5 Tf '+T.mut+' rg '+(this.w-this.m-tw(pg,7.5,0)).toFixed(2)+' '+y+' Td ('+pg+') Tj ET')});
  const parts=[],offs=[];let off=0;const P=x=>{const b=typeof x=='string'?lat(x):x;parts.push(b);off+=b.length};
  const obj=(n,body)=>{offs[n]=off;P(n+' 0 obj\n'+body+'\nendobj\n')},sobj=(n,dict,bytes)=>{offs[n]=off;P(n+' 0 obj\n'+dict.replace('LEN',bytes.length)+'\nstream\n');P(bytes);P('\nendstream\nendobj\n')};
  const nI=this.ims.length,i0=5+2*N,info=i0+nI,fs=info+1,es=info+2;
  P('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,'<< /Type /Catalog /Pages 2 0 R'+(emb?' /Names << /EmbeddedFiles << /Names [('+pesc(emb.name)+') '+fs+' 0 R] >> >>':'')+' >>');
  obj(2,'<< /Type /Pages /Count '+N+' /Kids ['+this.pages.map((_,i)=>(5+2*i)+' 0 R').join(' ')+'] >>');
  obj(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const xo=nI?' /XObject << '+this.ims.map((_,k)=>'/Im'+k+' '+(i0+k)+' 0 R').join(' ')+' >>':'';
  this.pages.forEach((c,i)=>{obj(5+2*i,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+this.w.toFixed(2)+' '+this.h.toFixed(2)+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>'+xo+' >> /Contents '+(6+2*i)+' 0 R >>');sobj(6+2*i,'<< /Length LEN >>',lat(c.join('\n')))});
  this.ims.forEach((im,k)=>sobj(i0+k,'<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length LEN >>',im.data));
  obj(info,'<< /Title ('+pesc((meta&&meta.title)||'Report')+') /Author ('+pesc((meta&&meta.author)||'')+') /Producer (Shop app) /CreationDate (D:'+new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)+'Z) >>');
  if(emb){obj(fs,'<< /Type /Filespec /F ('+pesc(emb.name)+') /UF ('+pesc(emb.name)+') /Desc (Full copy of the shop data. Use Restore on the Setup page.) /EF << /F '+es+' 0 R >> >>');sobj(es,'<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length LEN >>',emb.bytes)}
  else{obj(fs,'null');obj(es,'null')}
  const xr=off,n=es+1;P('xref\n0 '+n+'\n0000000000 65535 f \n');for(let i=1;i<n;i++)P(String(offs[i]).padStart(10,'0')+' 00000 n \n');
  P('trailer\n<< /Size '+n+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xr+'\n%%EOF');
  const out=new Uint8Array(off);let p=0;parts.forEach(b=>{out.set(b,p);p+=b.length});return out}
}


/* ---------- helpers ---------- */
const nowS=()=>new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const bytesOf=url=>{const b=atob(url.split(',')[1]),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
async function logoJpeg(){try{if(!okLogo(S.cfg.logo))return null;
  const im=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no();i.src=S.cfg.logo});
  const k=Math.min(1,360/Math.max(im.width||200,im.height||200)),c=document.createElement('canvas');c.width=Math.max(1,Math.round((im.width||200)*k));c.height=Math.max(1,Math.round((im.height||200)*k));
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);
  return{w:c.width,h:c.height,data:bytesOf(c.toDataURL('image/jpeg',0.92))}}catch(e){return null}}
function letter(d,logo,title,sub){const T=d.T;let x=d.m,top=d.y;
 if(logo){const lh=50,lw=Math.min(90,lh*logo.w/logo.h),lh2=lw/(logo.w/logo.h);d.img(logo,x,top-lh2,lw,lh2);x+=lw+12}
 let y=top-13;d.text(SN(),x,y,17,1,T.head);y-=14;
 if(S.cfg.desc){d.wrap(S.cfg.desc,d.w-d.m-x,9,0,2).forEach(l=>{d.text(l,x,y,9,0,T.mut);y-=11})}
 d.y=Math.min(y,top-54)-4;d.line(d.m,d.y,d.w-d.m,d.y,T.acc,1.6);d.y-=18;
 d.text(title,d.m,d.y,15,1,T.head);d.y-=13;if(sub)d.para(sub,{size:8.5,col:T.mut,gap:6});else d.y-=4}
const newA4=title=>new Doc({foot:SN()+'  ·  '+title+'  ·  made '+nowS()});
const slug=()=>SN().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'school';

/* ---------- send: share sheet or download ---------- */
async function out(bytes,name,share){const blob=new Blob([bytes],{type:'application/pdf'});
 if(share){try{const f=new File([blob],name,{type:'application/pdf'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return true}}catch(e){if(e&&e.name=='AbortError')return false}toast('Sharing is not available on this device, downloading instead')}
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},5000);toast('PDF downloaded');return true}
let busy=false;
async function run(label,fn){if(busy)return;busy=true;toast('Preparing '+label+'...');try{await fn()}catch(e){console.error(e);alert('Could not make the PDF: '+(e&&e.message||e))}busy=false}

/* ---------- small A5 slips: fees receipt, payment voucher ---------- */
function slipHead(d,logo,title){const T=d.T,cw=d.cw,ctr=(t,z,b,col,gap)=>d.para(t,{size:z,bold:b,a:'c',col:col,gap:gap==null?1:gap});
 if(logo){const lh=56,lw=Math.min(cw*0.5,lh*logo.w/logo.h),hh=lw/(logo.w/logo.h);d.img(logo,d.m+(cw-lw)/2,d.y-hh,lw,hh);d.y-=hh+6}
 ctr(SN(),16,1,T.head,1);if(S.cfg.desc)ctr(S.cfg.desc,9,0,T.mut);
 d.y-=3;d.line(d.m,d.y,d.m+cw,d.y,T.acc,1.4);d.y-=3;ctr(title,13,1,T.head,3)}
function kvRow(d,a,b,bold,z){z=z||9.5;const cw=d.cw;d.need(z*1.5);d.y-=z*1.35;d.text(a,d.m,d.y+z*0.25,z,bold,d.T.mut);const t=String(b),x=d.m+cw-tw(t,z,bold);d.text(t,Math.max(x,d.m+tw(a,z,bold)+6),d.y+z*0.25,z,bold)}
function rule(d){d.y-=4;d.line(d.m,d.y,d.m+d.cw,d.y,d.T.line,0.6);d.y-=4}
function rcBuild(d,x,logo){const p=P(x.pid),a=String(x.tk).split('-T'),T=d.T;slipHead(d,logo,'FEES RECEIPT');
 kvRow(d,'Receipt no.',x.no,1);kvRow(d,'Date',fdt2(x.t));kvRow(d,'Pupil',p?p.name:'?');kvRow(d,'Class',p?p.cls:'');kvRow(d,'Term','Term '+a[1]+', '+a[0]);rule(d);
 d.table([{h:'Fee item',w:.65},{h:'Amount',w:.35,a:'r'}],x.lines.map(l=>{const i=FI(l.i);return[i?i.name:'Item',fm(l.a)]}),{size:9.5});
 kvRow(d,'TOTAL PAID','UGX '+fm(sum(x.lines,l=>l.a)),1,12);kvRow(d,'Paid by ('+x.method+')','');
 if(x.ref)kvRow(d,'Transaction no.',x.ref+(x.prov?' ('+x.prov+')':''));
 if(x.payer)kvRow(d,'Paid by',x.payer+(x.prel?' ('+x.prel+')':''));if(x.rcv)kvRow(d,'Received by',x.rcv+(x.rrole?' ('+x.rrole+')':''));
 if(p&&x.tk===TK())kvRow(d,'Balance now','UGX '+fm(fee(p).bal),1);
 rule(d);d.para('Received with thanks.',{size:10,bold:1,a:'c',col:T.head})}
async function receipt(id,share){const x=S.pay.find(y=>y.id===id);if(!x)return;
 await run('receipt PDF',async()=>{const logo=await logoJpeg(),d=new Doc({w:419.53,h:595.28,m:30,foot:SN()+'  ·  Receipt '+x.no});rcBuild(d,x,logo);
  await out(d.finish(null,{title:'Receipt '+x.no,author:SN()}),'receipt-'+x.no+'-'+ldate(new Date(x.t))+'.pdf',share)})}
async function voucher(id,share){const e=S.ex.find(y=>y.id===id);if(!e)return;
 await run('voucher PDF',async()=>{const logo=await logoJpeg(),d=new Doc({w:419.53,h:595.28,m:30,foot:SN()+'  ·  Payment voucher'}),T=d.T;slipHead(d,logo,'PAYMENT VOUCHER');
  kvRow(d,'Date',new Date(e.d).toLocaleDateString('en-GB'));kvRow(d,'Category',e.cat+(e.st?', '+e.st:''));kvRow(d,'Paid to',e.to||'-');rule(d);
  d.para(e.desc||e.cat,{size:10.5,bold:1,gap:4});kvRow(d,'AMOUNT','UGX '+fm(e.amt),1,13);kvRow(d,'Method',e.m);
  if(e.ref)kvRow(d,'Transaction no.',e.ref+(e.prov?' ('+e.prov+')':''));kvRow(d,'Paid out by',(e.by||'-')+(e.role?' ('+e.role+')':''));rule(d);
  d.y-=26;d.line(d.m,d.y,d.m+130,d.y,T.mut,0.6);d.line(d.m+d.cw-130,d.y,d.m+d.cw,d.y,T.mut,0.6);d.y-=11;d.text('Paid out by (signature)',d.m,d.y,8,0,T.mut);d.text('Received by (signature)',d.m+d.cw-130,d.y,8,0,T.mut);
  await out(d.finish(null,{title:'Payment voucher',author:SN()}),'voucher-'+e.d+'-'+slug()+'.pdf',share)})}

/* ---------- report card ---------- */
function cardBuild(d,p,logo){const T=d.T,id=p.id,sj=subs(p.cls),w=W(),tk=TK(),a=fin(p,tk),part=sj.some(s=>sfin(id,tk,s)!=null&&!comp(id,tk,s)),r=(per,s)=>{const v=sc(id,per)[s];return v==null?'-':String(v)};
 letter(d,logo,'Pupil report card',TL());
 d.grid([['Pupil',p.name],['Class',p.cls],['LIN',p.lin||'-']],3);
 const rows=sj.map(s=>{const f=sfin(id,tk,s);return[s,r('BOT',s),r('MID',s),r('EOT',s),f==null?'-':String(Math.round(f)),gr(f),f==null?'':grr(f)]});
 rows.push({b:1,c:['Average',...AP.map(x=>{const v=av(p,x[0]);return v==null?'-':String(Math.round(v))}),a==null?'-':String(Math.round(a)),gr(a),a==null?'':grr(a)]});
 d.table([{h:'Subject',w:.28,b:1},{h:'BOT '+w.BOT+'%',w:.11,a:'c'},{h:'MID '+w.MID+'%',w:.11,a:'c'},{h:'EOT '+w.EOT+'%',w:.11,a:'c'},{h:'Final',w:.11,a:'c'},{h:'Grade',w:.1,a:'c'},{h:'Remark',w:.18}],rows,{size:9.5});
 d.grid([['Position in class',String(posF(p,tk))],['Final average',a==null?'-':Math.round(a)+'%'],['Overall grade',a==null?'-':gr(a)+' ('+grr(a)+')']],3);
 d.para('Final result = '+AP.map(x=>x[0]+' '+w[x[0]]+'%').join(' + ')+'.'+(part?' Provisional: some assessments are not entered yet.':'')+'  Grades: '+GS().map(g=>g.g+' '+g.m+'+').join(', ')+'.',{size:8,col:T.mut,gap:6});
 d.h2("Class teacher's comment");d.para(S.cm[id+tk]||' ',{size:10,gap:4});d.y-=22;
 d.need(50);[ 'Class teacher','Head teacher','Parent / guardian'].forEach((t,i)=>{const x=d.m+i*(d.cw/3),y=d.y;d.line(x,y,x+d.cw/3-14,y,T.mut,0.6);d.text(t,x,y-10,8,0,T.mut)});d.y-=22}
async function reportCard(id,share){const p=P(id);if(!p)return;await run('report card',async()=>{const logo=await logoJpeg(),d=newA4('Report card, '+p.name);cardBuild(d,p,logo);
 await out(d.finish(null,{title:'Report card '+p.name,author:SN()}),'report-card-'+p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+TK()+'.pdf',share)})}
async function classCards(share){const L=S.p.filter(p=>p.cls===ac).sort((a,b)=>a.name.localeCompare(b.name));if(!L.length)return toast('No pupils in this class yet');
 await run('class report cards',async()=>{const logo=await logoJpeg(),d=newA4('Report cards, '+ac);L.forEach((p,i)=>{if(i)d.np();cardBuild(d,p,logo)});
  await out(d.finish(null,{title:'Report cards '+ac,author:SN()}),'report-cards-'+ac.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+TK()+'.pdf',share)})}

/* ---------- whole school report / backup ---------- */
function tbl(d,R){const n=R.head.length,smp=R.rows.slice(0,200),str=v=>typeof v=='number'?fm(v):String(v==null?'':v);
 d.h2(R.title+(R.sub?'  ·  '+R.sub:''));
 const wt=R.head.map((h,i)=>Math.min(26,Math.max(5,...String(h).split(/\s+/).map(x=>x.length+1),...smp.map(r=>Math.min(String(r[i]==null?'':r[i]).length,26))))),T=wt.reduce((a,b)=>a+b,0);
 const cols=R.head.map((h,i)=>({h:String(h),w:wt[i]/T,a:smp.length&&smp.every(r=>typeof r[i]=='number')?'r':'l'}));
 const rows=R.rows.map(r=>r.map(str));if(R.foot)rows.push({b:1,c:R.foot.map(str)});
 d.table(cols,rows,{size:n>9?6.5:n>7?7:8,maxLines:4})}
async function fullBuild(embed){const logo=await logoJpeg(),title=embed?'Backup & full school record':'Whole school report',d=newA4(title);
 letter(d,logo,title,TL()+'  ·  made '+nowS()+(embed?'\nThis PDF contains a hidden full copy of the school data. To restore: More > Restore from backup > choose this PDF.':''));
 const P0={term:TK(),cls:'All',per:'all',month:today().slice(0,7),date:today()},add=(k,o)=>{try{const R=xrep(k,Object.assign({},P0,o||{}));if(R&&R.rows&&R.rows.length)tbl(d,R)}catch(e){console.warn(k,e)}};
 add('summary');add('enrolment');add('pupils');add('teachers');add('fees');
 allTerms().forEach(t=>add('payments',{term:t}));
 add('expenses');add('payroll');add('attterm');
 S.cfg.cl.forEach(c=>{if(S.p.some(p=>p.cls===c&&fin(p,TK())!=null))add('results',{cls:c})});
 add('calendar');add('roster');
 d.para('— End of report —',{size:8,a:'c',col:d.T.mut});
 let emb=null;if(embed)emb={name:slug()+'-backup-'+today()+'.json',bytes:new TextEncoder().encode('BIZBACKUP-BEGIN:school\n'+JSON.stringify(S)+'\nBIZBACKUP-END')};
 return d.finish(emb,{title:SN()+' - '+title,author:SN()})}
const report=share=>run('school report',async()=>{await out(await fullBuild(false),slug()+'-report-'+today()+'.pdf',share)});
const backup=share=>run('backup PDF',async()=>{await out(await fullBuild(true),slug()+'-backup-'+today()+'.pdf',share)});
async function pdfText(file){const buf=new Uint8Array(await file.arrayBuffer()),s=new TextDecoder('latin1').decode(buf),b=s.indexOf('BIZBACKUP-BEGIN:');if(b<0)throw new Error('This PDF has no backup data inside. Use a PDF made with "Backup as PDF", or a .json backup file.');
 const nl=s.indexOf('\n',b),e=s.indexOf('\nBIZBACKUP-END',nl),tag=s.slice(b+16,nl).trim();if(nl<0||e<0)throw new Error('The backup data in this PDF is incomplete.');if(tag!=='school')throw new Error('This backup PDF belongs to a different app.');
 return new TextDecoder('utf-8').decode(buf.subarray(nl+1,e))}

window.X=Object.assign(window.X||{},{receipt,voucher,reportCard,classCards,report,backup,pdfText});
})();
