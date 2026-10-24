/* ระบบติดตามแผนงานโครงการ แผนแม่บทการบริหารจัดการทรัพยากรน้ำ ลุ่มน้ำปิง */
(function(){
'use strict';
const CFG = window.APP_CONFIG || {firebase:{}};
const DATA = (window.DATA_BASE || 'data/');
const STATUS_OPTS = ['แนวคิดโครงการ','ศึกษาความเหมาะสม','สำรวจออกแบบ','เสนอของบประมาณ','ได้รับงบประมาณ','อยู่ระหว่างดำเนินการ','ดำเนินการแล้วเสร็จ'];
const SCOL = {1:'var(--s1)',2:'var(--s2)',3:'var(--s3)',4:'var(--s4)',5:'var(--s5)'};
const SHEX = {1:'#2f7fc1',2:'#4c9a56',3:'#d0862a',4:'#23938a',5:'#7656a8'};
const TGHEX = '#e07b39';
const PAGE = 40;

let M, T = {}, P = [], SEED = [], SUBS = [], AUDIT = [];
let IDX = {byTam:{}, byBasin:{}}, MEAS = {}, PROG = {}, STRAT = {}, BAS = {};
const S = {
  tab:'area', prov:null, amp:null, tam:null, basin:null,
  f:{q:'', s:new Set(), F:'', S:'', grp:'', src:''},
  admin:false, user:null, seedFallback:false
};
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (n==null||n==='') ? '–' : Number(n).toLocaleString('th-TH');
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const SESSION_DAYS = 30;
const Sess = {
  get(){ let v=null; try{ v = JSON.parse(localStorage.getItem('ping_session')||'null') || JSON.parse(sessionStorage.getItem('ping_session')||'null'); }catch(e){} if(v && v.exp && v.exp < Date.now()) { this.clear(); return null; } return v; },
  set(v, remember){ const rec = Object.assign({}, v, {exp: remember ? Date.now()+SESSION_DAYS*864e5 : null}); try{ (remember?localStorage:sessionStorage).setItem('ping_session', JSON.stringify(rec)); (remember?sessionStorage:localStorage).removeItem('ping_session'); }catch(e){} },
  clear(){ try{ localStorage.removeItem('ping_session'); sessionStorage.removeItem('ping_session'); }catch(e){} }
};
async function sha256(t){ const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function toast(msg){
  const el = document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
function normProj(p){
  return Object.assign({id:'',seq:0,sb:'',ref:'',s:null,F:'',S:'',title:'',detail:'',tambons:[],agency:'',budget:null,yearStart:null,yearEnd:null,status:'',note:'',src:'excel'}, p);
}

/* ================= STORE ================= */
const Store = {
  mode: (CFG.firebase && CFG.firebase.apiKey) ? 'firebase' : 'demo',
  db:null, auth:null, unsub:[],
  async init(){
    if(this.mode === 'firebase'){
      try{ await this.loadFirebase(); }catch(e){ console.error(e); this.mode='demo'; toast('เชื่อมต่อฐานข้อมูลออนไลน์ไม่ได้ ข้อมูลที่เพิ่มจะเก็บในเครื่องนี้ชั่วคราว'); }
    }
    if(this.mode === 'firebase') this.initFirebase(); else this.initDemo();
  },
  loadScript(src){ return new Promise((res, rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); },
  async loadFirebase(){
    const b='https://cdn.jsdelivr.net/npm/firebase@10.12.2/';
    await this.loadScript(b+'firebase-app-compat.js');
    await this.loadScript(b+'firebase-auth-compat.js');
    await this.loadScript(b+'firebase-firestore-compat.js');
    firebase.initializeApp(CFG.firebase);
    this.db = firebase.firestore(); this.auth = firebase.auth();
  },
  /* ---- demo (เก็บในเบราว์เซอร์) ---- */
  initDemo(){
    const o = LS.get('ping_overrides', {edited:{}, added:[], deleted:[]});
    P = SEED.filter(p=>!o.deleted.includes(p.id)).map(p=> normProj(o.edited[p.id] || p)).concat(o.added.map(normProj));
    SUBS = LS.get('ping_subs', []).filter(s=>s.review==='pending');
    AUDIT = LS.get('ping_audit', []);
    const ss = Sess.get(); if(ss && ss.role==='admin'){ S.admin=true; S.user={email: ss.name || 'ผู้ดูแลระบบ'}; }
    onData();
  },
  demoSave(fn){ const o = LS.get('ping_overrides', {edited:{}, added:[], deleted:[]}); fn(o); LS.set('ping_overrides', o); this.initDemo(); },
  demoAudit(action, id, detail){ const a = LS.get('ping_audit', []); a.unshift({ts:Date.now(), by:S.user?.email||'-', action, id, detail}); LS.set('ping_audit', a.slice(0,200)); },
  /* ---- firebase ---- */
  initFirebase(){
    this.db.collection('projects').onSnapshot(snap=>{
      if(snap.empty){ P = SEED.map(normProj); S.seedFallback = true; }
      else { P = snap.docs.map(d=>normProj(d.data())); S.seedFallback = false; }
      onData();
    }, err=>{ console.error(err); toast('อ่านข้อมูลโครงการไม่ได้: '+err.message); P = SEED.map(normProj); S.seedFallback=true; onData(); });
    this.auth.onAuthStateChanged(async u=>{
      this.unsub.forEach(f=>f()); this.unsub=[]; SUBS=[]; AUDIT=[];
      S.user = u ? {email:u.email, uid:u.uid} : null; S.admin=false;
      if(u){
        try{ const d = await this.db.doc('admins/'+u.uid).get(); S.admin = d.exists; }catch(e){ S.admin=false; }
        if(!S.admin){ toast('บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแลระบบ'); }
        else {
          this.unsub.push(this.db.collection('submissions').where('review','==','pending').onSnapshot(s=>{ SUBS = s.docs.map(d=>Object.assign({_id:d.id}, d.data())).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)); renderHeader(); if(S.tab==='admin') renderView(); }));
          this.unsub.push(this.db.collection('audit').orderBy('ts','desc').limit(60).onSnapshot(s=>{ AUDIT = s.docs.map(d=>d.data()); if(S.tab==='admin') renderView(); }));
        }
      }
      renderHeader(); renderView();
    });
  },
  /* ---- actions ---- */
  async login(email, pass, remember){
    if(this.mode==='demo'){
      if(await sha256(pass) === CFG.adminCodeHash){ S.admin=true; S.user={email:email||'ผู้ดูแลระบบ'}; renderHeader(); renderView(); return; }
      throw new Error('รหัสผู้ดูแลไม่ถูกต้อง');
    }
    await this.auth.setPersistence(remember===false ? firebase.auth.Auth.Persistence.SESSION : firebase.auth.Auth.Persistence.LOCAL);
    await this.auth.signInWithEmailAndPassword(email || CFG.adminEmail, pass);
  },
  async logout(){ if(this.mode==='demo'){ S.admin=false; S.user=null; renderHeader(); renderView(); return; } await this.auth.signOut(); },
  async resetPassword(email){ if(this.mode==='demo') throw new Error('โหมดทดลองไม่มีระบบรีเซ็ตรหัสผ่าน'); await this.auth.sendPasswordResetEmail(email); },
  async submit(data){
    const rec = Object.assign({}, data, {review:'pending'});
    if(this.mode==='demo'){
      rec._id = 'S'+Date.now(); rec.createdAt = {seconds: Math.floor(Date.now()/1000)};
      const a = LS.get('ping_subs', []); a.unshift(rec); LS.set('ping_subs', a); SUBS = a.filter(s=>s.review==='pending'); renderHeader(); return;
    }
    rec.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await this.db.collection('submissions').add(rec);
  },
  nextId(){ const mx = P.reduce((m,p)=>Math.max(m, p.seq||0), 0); return {seq:mx+1, id:'P'+String(mx+1).padStart(4,'0')}; },
  async approve(sub, data){
    const {id, seq} = this.nextId();
    const proj = normProj(Object.assign({}, pickProj(data), {id, seq, src:'new', proposer:sub.proposer||'', proposerOrg:sub.proposerOrg||'', proposerContact:sub.proposerContact||'', approvedBy:S.user?.email||'', approvedAt:new Date().toISOString()}));
    if(this.mode==='demo'){
      const a = LS.get('ping_subs', []); const s = a.find(x=>x._id===sub._id); if(s){ s.review='approved'; s.projectId=id; } LS.set('ping_subs', a);
      this.demoAudit('อนุมัติโครงการใหม่', id, proj.title);
      this.demoSave(o=>o.added.push(proj)); return id;
    }
    const b = this.db.batch();
    b.set(this.db.doc('projects/'+id), proj);
    b.update(this.db.doc('submissions/'+sub._id), {review:'approved', projectId:id, reviewedBy:S.user.email, reviewedAt:firebase.firestore.FieldValue.serverTimestamp()});
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'อนุมัติโครงการใหม่', id, detail:proj.title});
    await b.commit(); return id;
  },
  async reject(sub, reason){
    if(this.mode==='demo'){
      const a = LS.get('ping_subs', []); const s = a.find(x=>x._id===sub._id); if(s){ s.review='rejected'; s.reason=reason; } LS.set('ping_subs', a); SUBS=a.filter(s=>s.review==='pending');
      this.demoAudit('ไม่อนุมัติ', sub._id, sub.title+(reason?' — '+reason:'')); AUDIT=LS.get('ping_audit',[]); renderHeader(); renderView(); return;
    }
    const b = this.db.batch();
    b.update(this.db.doc('submissions/'+sub._id), {review:'rejected', reason:reason||'', reviewedBy:S.user.email, reviewedAt:firebase.firestore.FieldValue.serverTimestamp()});
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'ไม่อนุมัติ', id:sub._id, detail:sub.title+(reason?' — '+reason:'')});
    await b.commit();
  },
  async saveProject(id, data){
    const old = P.find(p=>p.id===id);
    const upd = Object.assign({}, old, pickProj(data), {updatedBy:S.user?.email||'', updatedAt:new Date().toISOString()});
    const changed = Object.keys(pickProj(data)).filter(k=>JSON.stringify(old[k]??'')!==JSON.stringify(upd[k]??''));
    if(this.mode==='demo'){
      this.demoAudit('แก้ไขโครงการ', id, changed.map(k=>FIELD_TH[k]||k).join(', '));
      this.demoSave(o=>{ const i=o.added.findIndex(x=>x.id===id); if(i>=0) o.added[i]=upd; else o.edited[id]=upd; }); return;
    }
    if(S.seedFallback) throw new Error('ยังไม่ได้นำเข้าข้อมูลตั้งต้นลงฐานข้อมูล กรุณานำเข้าที่หน้าผู้ดูแลระบบก่อน');
    const b = this.db.batch();
    b.set(this.db.doc('projects/'+id), upd);
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'แก้ไขโครงการ', id, detail:changed.map(k=>FIELD_TH[k]||k).join(', ')});
    await b.commit();
  },
  async deleteProject(id){
    const old = P.find(p=>p.id===id);
    if(this.mode==='demo'){
      this.demoAudit('ลบโครงการ', id, old?.title);
      this.demoSave(o=>{ const i=o.added.findIndex(x=>x.id===id); if(i>=0) o.added.splice(i,1); else o.deleted.push(id); }); return;
    }
    const b = this.db.batch();
    b.delete(this.db.doc('projects/'+id));
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'ลบโครงการ', id, detail:old?.title||''});
    await b.commit();
  },
  async seed(onProgress){
    if(this.mode!=='firebase') return;
    const all = SEED.map(normProj);
    const N = 15; // กฎความปลอดภัยตรวจสิทธิ์ทุกเอกสาร จึงส่งทีละชุดเล็ก
    for(let i=0;i<all.length;i+=N){
      const b = this.db.batch();
      all.slice(i,i+N).forEach(p=>b.set(this.db.doc('projects/'+p.id), p));
      await b.commit(); onProgress && onProgress(Math.min(i+N, all.length), all.length);
    }
    await this.db.collection('audit').add({ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'นำเข้าข้อมูลตั้งต้น', id:'-', detail:all.length+' โครงการ'});
  }
};
const PROJ_FIELDS = ['sb','ref','s','F','S','title','detail','tambons','agency','budget','yearStart','yearEnd','status','note'];
const FIELD_TH = {sb:'ลุ่มน้ำสาขา',ref:'ตารางอ้างอิง',s:'ยุทธศาสตร์',F:'แผนงาน',S:'มาตรการ',title:'ชื่อแนวทาง/โครงการ',detail:'รายละเอียด',tambons:'ตำบลเป้าหมาย',agency:'หน่วยงานรับผิดชอบ',budget:'งบประมาณ',yearStart:'ปีเริ่ม',yearEnd:'ปีสิ้นสุด',status:'สถานะ',note:'หมายเหตุ'};
function pickProj(d){ const o={}; PROJ_FIELDS.forEach(k=>{ if(k in d) o[k]=d[k]; }); return o; }

/* ================= INDEX & FILTER ================= */
function buildIndex(){
  IDX = {byTam:{}, byBasin:{}};
  P.forEach(p=>{
    (p.tambons||[]).forEach(t=>{ (IDX.byTam[t] ||= []).push(p); });
    (IDX.byBasin[p.sb] ||= []).push(p);
  });
}
/* ตำบลหนึ่งอยู่ได้ลุ่มน้ำสาขาเดียว = ลุ่มที่ครอบคลุมพื้นที่ตำบลมากที่สุด (sb[0]) */
const sbMain = t => t.sb[0] || '';
function tamInBasin(b){ return M.tambons.filter(t=>sbMain(t)===b); }
function tamInBasinAll(b){ return M.tambons.filter(t=>t.sb.includes(b)); }
function projGroups(p){
  const g = new Set();
  (p.tambons||[]).forEach(id=>(T[id]?.grp||[]).forEach(c=>g.add(c)));
  return g;
}
function matchGrp(codes, sel){ if(!sel) return true; for(const c of codes){ if(sel.length===1 ? c[0]===sel : c===sel) return true; } return false; }
function projMatch(p){
  const f = S.f;
  if(f.s.size && !f.s.has(p.s)) return false;
  if(f.F && !String(p.F).split(/,\s*/).includes(f.F)) return false;
  if(f.S && p.S!==f.S) return false;
  if(f.src && p.src!==f.src) return false;
  if(f.grp){
    let codes = projGroups(p);
    if(!codes.size && MEAS[p.S]) codes = new Set((MEAS[p.S].groups||'').match(/[WPREG]\d/g)||[]);
    if(!matchGrp(codes, f.grp)) return false;
  }
  if(f.q){
    const q = f.q.toLowerCase();
    const hay = (p.title+' '+p.detail+' '+p.sb+' '+p.id+' '+p.agency+' '+p.S+' '+(p.tambons||[]).map(id=>T[id]?.t+' '+T[id]?.a).join(' ')).toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}
const filt = list => list.filter(projMatch);
function filterActive(){ const f=S.f; return !!(f.q||f.s.size||f.F||f.S||f.grp||f.src); }

/* ================= COMPONENTS ================= */
const sPill = n => `<span class="pill s" style="background:${SCOL[n]}" title="${esc(STRAT[n]?.short)}">ยศ.${n}</span>`;
const tPill = t => t.target ? `<span class="pill tg">พื้นที่เป้าหมาย</span>` : `<span class="pill p0">ไม่ใช่พื้นที่เป้าหมาย</span>`;
const tamName = t => t ? `ต.${t.t} อ.${t.a} จ.${t.p}` : '';
function stratBar(list){
  const c = {1:0,2:0,3:0,4:0,5:0}; list.forEach(p=>c[p.s]++); const n = list.length||1;
  return `<div class="stackbar">${[1,2,3,4,5].map(i=>`<span style="width:${c[i]/n*100}%;background:${SCOL[i]}" title="ยศ.${i}: ${c[i]}"></span>`).join('')}</div>
  <div class="legend">${[1,2,3,4,5].map(i=>`<span><i class="dot" style="background:${SCOL[i]}"></i>ยศ.${i} ${fmt(c[i])}</span>`).join('')}</div>`;
}
const TABLES = {};
function projTable(key, list, opts={}){
  TABLES[key] = {list, n:PAGE, opts};
  return `<div data-table="${key}">${tableInner(key)}</div>`;
}
function projLoc(p){
  const ts = (p.tambons||[]).map(id=>T[id]).filter(Boolean);
  const uniq = a => [...new Set(a)];
  return {ts, prov: uniq(ts.map(t=>t.p)), amp: uniq(ts.map(t=>t.a)), tam: ts.map(t=>t.t)};
}
function projGrpList(p){
  const g = [...projGroups(p)];
  if(g.length) return {codes: sortGrp(g), fromMeasure:false};
  return {codes: sortGrp((MEAS[p.S]?.groups||'').match(/[WPREG]\d/g)||[]), fromMeasure:true};
}
function sortGrp(a){ return [...new Set(a)].sort((x,y)=>x[0]===y[0]? +x.slice(1)-+y.slice(1) : 'WPREG'.indexOf(x[0])-'WPREG'.indexOf(y[0])); }
function shortList(arr, pre, max=2){
  if(!arr.length) return '';
  const shown = arr.slice(0,max).map(x=>pre+esc(x)).join(', ');
  return arr.length>max ? `${shown} <span class="sub">+${arr.length-max}</span>` : shown;
}
function tableInner(key){
  const {list, n, opts} = TABLES[key];
  if(!list.length) return `<div class="empty">${opts.empty || 'ไม่มีโครงการ'}</div>`;
  const rows = list.slice(0, n).map(p=>{
    const L = projLoc(p); const G = projGrpList(p);
    const basinLvl = '<span class="sub">ระดับลุ่มน้ำ</span>';
    const full = G.codes.map(c=>`${c} ${M.groups[c]||''}`).join('\n');
    const grp = G.codes.length ? `<span class="gcodes" title="${esc(full)}">${G.codes.slice(0,6).map(c=>`<b style="color:${SCOL['WPREG'.indexOf(c[0])+1]}">${c}</b>`).join(' ')}${G.codes.length>6?` <span class="sub">+${G.codes.length-6}</span>`:''}</span>`+(G.fromMeasure?'<div class="sub">ตามมาตรการ</div>':'') : '–';
    return `<tr class="row" data-pid="${esc(p.id)}">
      <td class="num sub">${esc(p.id)}</td>
      <td>${sPill(p.s)}</td>
      <td class="t">${esc(p.title)}${p.src==='new'?' <span class="pill new">เพิ่มใหม่</span>':''}${p.status?`<div class="sub">${esc(p.status)}</div>`:''}</td>
      <td><span class="pill code">${esc(p.F)}</span> <span class="pill code">${esc(p.S)}</span></td>
      ${opts.noBasin?'':`<td class="b">${esc(p.sb)}</td>`}
      <td class="loc">${L.ts.length?shortList(L.prov,'จ.'):basinLvl}</td>
      <td class="loc">${L.ts.length?shortList(L.amp,'อ.'):''}</td>
      <td class="loc">${L.ts.length?shortList(L.tam,'ต.'):''}</td>
      <td class="grp">${grp}</td></tr>`;
  }).join('');
  return `<div class="tbl-tools"><span class="note">${fmt(list.length)} รายการ</span><button class="btn sm" data-act="xls" data-key="${key}">ดาวน์โหลด Excel</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>รหัส</th><th>ยศ.</th><th>แนวทาง/โครงการ</th><th>แผนงาน/มาตรการ</th>${opts.noBasin?'':'<th>ลุ่มน้ำสาขา</th>'}<th>จังหวัด</th><th>อำเภอ</th><th>ตำบล</th><th>กลุ่มพื้นที่</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${list.length>n?`<div class="more"><button class="btn sm" data-act="more" data-key="${key}">แสดงเพิ่ม (เหลืออีก ${fmt(list.length-n)} รายการ)</button></div>`:''}`;
}
function stratProblems(tg){ const sc={1:0,2:0,3:0,4:0,5:0}; tg.forEach(t=>t.strat.forEach(n=>sc[n]++)); return `<div class="legend" style="font-size:.84rem">${[1,2,3,4,5].map(i=>`<span>${sPill(i)} ${esc(shortS(i))} <b class="num">${sc[i]}</b></span>`).join('')}</div>`; }
function grpCounts(tams){
  const c = {}; tams.forEach(t=>t.grp.forEach(g=>c[g]=(c[g]||0)+1));
  const keys = Object.keys(c).sort((a,b)=>a[0]===b[0]? +a.slice(1)-+b.slice(1) : 'WPREG'.indexOf(a[0])-'WPREG'.indexOf(b[0]));
  if(!keys.length) return '<div class="note">ไม่มีตำบลที่จัดอยู่ในกลุ่มพื้นที่ปัญหา</div>';
  return `<div class="grp-list">${keys.map(k=>`<span class="grp-item" title="${esc(M.groupFamilies[k[0]]||'')}"><b class="c" style="color:${SCOL['WPREG'.indexOf(k[0])+1]}">${k}</b>${esc(M.groups[k]||'')}<span class="n">${c[k]}</span></span>`).join('')}</div>`;
}
function tamInfo(t, compact){
  const sbs = `<b>${esc(sbMain(t))}</b>${t.sbPct[0]!=null?` <span class="note">(${t.sbPct[0]}% ของพื้นที่ตำบล)</span>`:''}` + (t.sb.length>1 ? `<div class="note">คาบเกี่ยว: ${t.sb.slice(1).map((b,i)=>esc(b)+(t.sbPct[i+1]!=null?` ${t.sbPct[i+1]}%`:'')).join(', ')}</div>` : '');
  const grps = t.grp.length ? t.grp.map(g=>`<div><span class="pill code">${g}</span> ${esc(M.groups[g]||'')} <span class="note">· ${esc(M.groupFamilies[g[0]]||'')}</span></div>`).join('') : '<span class="note">ไม่อยู่ในกลุ่มพื้นที่ปัญหา</span>';
  return `<dl class="dl">
    <dt>สถานะเป้าหมาย</dt><dd>${tPill(t)} ${t.target?`<span class="note">พบปัญหา ${t.strat.length} ยุทธศาสตร์</span>`:'<span class="note">ไม่พบปัญหาเด่นตามเกณฑ์ 5 ยุทธศาสตร์</span>'}</dd>
    <dt>ยุทธศาสตร์ที่มีปัญหา</dt><dd>${t.strat.length ? t.strat.map(n=>`${sPill(n)} ${esc(STRAT[n]?.short)}`).join('<br>') : '–'}</dd>
    <dt>กลุ่มพื้นที่</dt><dd>${grps}</dd>
    ${compact?'':`<dt>แผนงานที่ควรใช้ (เสนอ)</dt><dd>${t.F.length ? t.F.map(f=>`<span class="pill code">${f}</span> ${esc(PROG[f]?.name||'')}`).join('<br>') : '–'}</dd>`}
    <dt>ลุ่มน้ำสาขา</dt><dd>${sbs||'–'}</dd>
    <dt>พื้นที่ตำบล</dt><dd class="num">${t.area!=null? fmt(t.area)+' ตร.กม.':'–'}</dd>
  </dl>`;
}

/* ================= HEADER / KPIs / FILTERS ================= */
function renderHeader(){
  $('#mode').outerHTML = `<span id="mode" class="mode ver" title="${Store.mode==='firebase'?'เชื่อมต่อฐานข้อมูลออนไลน์':'ยังไม่ได้เชื่อมต่อฐานข้อมูลออนไลน์ ข้อมูลที่เพิ่มเก็บในเบราว์เซอร์นี้'}"><i class="mdot ${Store.mode==='firebase'?'on':''}"></i>${esc(CFG.version||'')}</span>`;
  const ss = Sess.get();
  $('#authBtn').innerHTML = S.admin ? 'ผู้ดูแลระบบ · ออกจากระบบ' : (ss?.role==='user' ? 'ผู้ใช้ทั่วไป · เข้าสู่ระบบผู้ดูแล' : 'เข้าสู่ระบบ');
  const t = $('.tab[data-tab="admin"]'); t.innerHTML = `ผู้ดูแลระบบ${S.admin && SUBS.length ? `<span class="badge-n">${SUBS.length}</span>`:''}`;
}
const tip = t => `<button type="button" class="tip" aria-label="${esc(t)}" data-tip="${esc(t)}">i</button>`;
function statsBox(inner){ return `<details class="statsbox" ${S.statsOpen?'open':''}><summary>ดูสถิติพื้นที่ <span class="note">สัดส่วนโครงการ · ยุทธศาสตร์ที่มีปัญหา · กลุ่มพื้นที่</span></summary><div class="statsbox-in">${inner}</div></details>`; }
/* ปุ่ม "ล้าง" ในแต่ละช่องตัวกรอง */
function addClearButtons(root){
  if(!root) return;
  root.querySelectorAll('.fld').forEach(fld=>{
    fld.querySelector(':scope > .clr')?.remove();
    const ctl = fld.querySelector('select, input[type=search]');
    let on = false, target = '';
    if(ctl){ on = !ctl.disabled && ctl.value !== '' && !(ctl.tagName==='SELECT' && ctl.selectedIndex===0 && ctl.options[0]?.value!==''); target = ctl.id; }
    else if(fld.querySelector('[data-act="fs"]')){ on = S.f.s.size>0; target = '__strat'; }
    if(!on || !target) return;
    const b = document.createElement('button'); b.type='button'; b.className='clr'; b.dataset.act='clr'; b.dataset.v=target; b.title='ล้างตัวกรองนี้'; b.innerHTML='× ล้าง';
    fld.classList.add('has-clr'); fld.appendChild(b);
  });
}
function renderKPIs(){
  const tg = M.tambons.filter(t=>t.target);
  const amp = new Set(M.tambons.map(t=>t.p+'|'+t.a)).size;
  const k = [
    [M.provinces.length,'จังหวัด'],[amp,'อำเภอ'],[M.tambons.filter(t=>t.geo).length,'ตำบลในลุ่มน้ำปิง'],[M.basins.length,'ลุ่มน้ำสาขา'],
    [tg.length,'ตำบลเป้าหมาย'],[P.length,'แนวทาง/โครงการ',true]];
  $('#kpis').innerHTML = `<span class="kl">ภาพรวมลุ่มน้ำปิง</span>` + k.map(([v,l,p])=>`<span class="ki"><b class="${p?'pinkv':''}">${fmt(v)}</b> ${l}</span>`).join('<span class="ksep">·</span>');
}
function renderFilters(){
  const f = S.f;
  const Fopts = M.programmes.filter(p=>!f.s.size || f.s.has(p.s));
  const Sopts = M.measures.filter(m=>(!f.s.size || f.s.has(m.s)) && (!f.F || m.F.includes(f.F)));
  let loc = '';
  if(S.tab==='area'){
    const amps = S.prov ? [...new Set(M.tambons.filter(t=>t.p===S.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
    const tams = S.amp ? M.tambons.filter(t=>t.p===S.prov&&t.a===S.amp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
    loc = `<div class="locrow">
      <div class="fld"><label for="fLp">จังหวัด</label><select id="fLp"><option value="">ทั้ง 6 จังหวัดในลุ่มน้ำปิง</option>${M.provinces.map(p=>`<option ${S.prov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fLa">อำเภอ</label><select id="fLa" ${S.prov?'':'disabled'}><option value="">${S.prov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${S.amp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fLt">ตำบล</label><select id="fLt" ${S.amp?'':'disabled'}><option value="">${S.amp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${S.tam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div>
    </div>`;
  } else if(S.tab==='basin'){
    const pool = S.basin ? tamInBasin(S.basin) : [];
    const provs = [...new Set(pool.map(t=>t.p))].sort((a,b)=>a.localeCompare(b,'th'));
    const amps = S.bprov ? [...new Set(pool.filter(t=>t.p===S.bprov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
    const tams = S.bamp ? pool.filter(t=>t.p===S.bprov&&t.a===S.bamp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
    loc = `<div class="locrow"><div class="fld"><label for="fLb">ลุ่มน้ำสาขา</label><select id="fLb"><option value="">ทั้ง 30 ลุ่มน้ำสาขา</option>${M.basins.map(b=>`<option ${S.basin===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBp">จังหวัด (ในลุ่มน้ำนี้)</label><select id="fBp" ${S.basin?'':'disabled'}><option value="">${S.basin?`ทุกจังหวัดในลุ่มน้ำนี้ (${provs.length})`:'เลือกลุ่มน้ำสาขาก่อน'}</option>${provs.map(p=>`<option ${S.bprov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBa">อำเภอ</label><select id="fBa" ${S.bprov?'':'disabled'}><option value="">${S.bprov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${S.bamp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBt">ตำบล</label><select id="fBt" ${S.bamp?'':'disabled'}><option value="">${S.bamp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${S.btam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div></div>`;
  }
  $('#filters').innerHTML = loc + `
    <div class="fld search"><label for="fq">ค้นหา</label><input id="fq" type="search" placeholder="ชื่อโครงการ ตำบล อำเภอ ลุ่มน้ำ หรือรหัส" value="${esc(f.q)}"></div>
    <div class="fld"><span class="lbl">ยุทธศาสตร์</span><div class="chips"><button class="chip all" data-act="fsall" aria-pressed="${!f.s.size}">ทั้งหมด</button>${M.strategies.map(s=>`<button class="chip" data-act="fs" data-n="${s.n}" aria-pressed="${f.s.has(s.n)}" title="${esc(s.short)}"><i style="background:${SCOL[s.n]}"></i>${s.n} ${esc(shortS(s.n))}</button>`).join('')}</div></div>
    <div class="morebar"><button type="button" class="morebtn" data-act="morefilt" aria-expanded="${!!S.moreOpen}">ตัวกรองโครงการเพิ่มเติม${(f.F?1:0)+(f.S?1:0)+(f.grp?1:0)?` <span class="badge-n">${(f.F?1:0)+(f.S?1:0)+(f.grp?1:0)}</span>`:''} <span aria-hidden="true">${S.moreOpen?'▴':'▾'}</span></button><div class="fcount">${scopeCount()}</div></div><div class="morefilt" ${S.moreOpen?'':'hidden'}>
    <div class="fld"><label for="fF">แผนงานหลัก</label><select id="fF"><option value="">ทั้งหมด</option>${Fopts.map(p=>`<option value="${p.code}" ${f.F===p.code?'selected':''}>${p.code} ${esc(p.name)}</option>`).join('')}</select></div>
    <div class="fld"><label for="fS">มาตรการ</label><select id="fS"><option value="">ทั้งหมด</option>${Sopts.map(m=>`<option value="${m.code}" ${f.S===m.code?'selected':''}>${m.code} ${esc(m.name)}</option>`).join('')}</select></div>
    <div class="fld"><label for="fG">กลุ่มพื้นที่</label><select id="fG"><option value="">ทั้งหมด</option>${'WPREG'.split('').map(fm=>`<optgroup label="${fm} · ${esc(M.groupFamilies[fm])}"><option value="${fm}" ${f.grp===fm?'selected':''}>${fm} ทั้งกลุ่ม</option>${Object.keys(M.groups).filter(k=>k[0]===fm).sort((a,b)=>+a.slice(1)-+b.slice(1)).map(k=>`<option value="${k}" ${f.grp===k?'selected':''}>${k} ${esc(M.groups[k])}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
`;
  addClearButtons($('#filters'));
}
function scopeCount(){
  let base = P, label = '';
  if(S.tab==='area' && S.prov){
    const ids = new Set(M.tambons.filter(t=>t.p===S.prov && (!S.amp||t.a===S.amp) && (!S.tam||t.id===S.tam)).map(t=>t.id));
    base = P.filter(p=>(p.tambons||[]).some(id=>ids.has(id)));
    label = S.tam ? 'ต.'+T[S.tam].t : S.amp ? 'อ.'+S.amp : 'จ.'+S.prov;
  } else if(S.tab==='map' && typeof MS!=='undefined' && ((MS.kind==='basin' && MS.basin) || MS.prov)){
    const ids = new Set(M.tambons.filter(t=>inScope(t)).map(t=>t.id));
    base = P.filter(p=>(MS.kind!=='basin' || !MS.basin || p.sb===MS.basin) && ((p.tambons||[]).some(id=>ids.has(id)) || (MS.kind==='basin' && MS.basin && !MS.prov && p.sb===MS.basin && !(p.tambons||[]).length)));
    label = MS.kind==='basin' && MS.basin ? 'ลุ่มน้ำสาขา'+MS.basin+(MS.prov?' · '+(MS.tam?'ต.'+T[MS.tam].t:MS.amp?'อ.'+MS.amp:'จ.'+MS.prov):'') : (MS.tam?'ต.'+T[MS.tam].t:MS.amp?'อ.'+MS.amp:'จ.'+MS.prov);
  } else if(S.tab==='basin' && S.basin){
    base = P.filter(p=>p.sb===S.basin); label = 'ลุ่มน้ำสาขา'+S.basin;
    if(S.bprov){
      const ids = new Set(tamInBasin(S.basin).filter(t=>t.p===S.bprov && (!S.bamp||t.a===S.bamp) && (!S.btam||t.id===S.btam)).map(t=>t.id));
      base = base.filter(p=>(p.tambons||[]).some(id=>ids.has(id)));
      label += ' · ' + (S.btam ? 'ต.'+T[S.btam].t : S.bamp ? 'อ.'+S.bamp : 'จ.'+S.bprov);
    }
  }
  const n = filt(base).length;
  const where = label ? ` ใน${esc(label)}` : '';
  return filterActive()
    ? `พบ <b class="num">${fmt(n)}</b> จาก ${fmt(base.length)} โครงการ${where} · <button class="linkbtn" data-act="clear">ล้างตัวกรอง</button>`
    : `${fmt(base.length)} โครงการ${where}`;
}
function shortS(n){ return ({1:'อุปโภคบริโภค',2:'ภาคการผลิต',3:'ท่วม–แล้ง',4:'ระบบนิเวศ',5:'บริหารจัดการ'})[n]; }

/* ================= VIEW: AREA (จังหวัด-อำเภอ-ตำบล) ================= */
function renderArea(){
  const el = $('#view');
  const fl = filt(P);
  const projIn = tams => { const ids = new Set(tams.map(t=>t.id)); const seen=new Set(); const out=[]; fl.forEach(p=>{ if((p.tambons||[]).some(id=>ids.has(id)) && !seen.has(p.id)){ seen.add(p.id); out.push(p);} }); return out; };
  // tree
  let tree='', head='', crumbs = `<button data-act="goprov" data-v="">ทั้ง 6 จังหวัดในลุ่มน้ำปิง</button>`;
  if(!S.prov){
    head = 'จังหวัด';
    tree = M.provinces.map(pv=>{ const ts=M.tambons.filter(t=>t.p===pv); return `<button class="nav-chip" data-act="goprov" data-v="${esc(pv)}">จ.${esc(pv)}</button>`; }).join('');
  } else if(!S.amp){
    head = `อำเภอใน จ.${S.prov}`;
    const amps = [...new Set(M.tambons.filter(t=>t.p===S.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th'));
    tree = amps.map(a=>{ const ts=M.tambons.filter(t=>t.p===S.prov&&t.a===a); const tg=ts.filter(t=>t.target).length; return `<button class="nav-chip" data-act="goamp" data-v="${esc(a)}">อ.${esc(a)}</button>`; }).join('');
    crumbs += `<span class="sep">›</span><strong>จ.${esc(S.prov)}</strong>`;
  } else {
    head = `ตำบลใน อ.${S.amp}`;
    const ts = M.tambons.filter(t=>t.p===S.prov&&t.a===S.amp).sort((a,b)=>a.t.localeCompare(b.t,'th'));
    tree = ts.map(t=>{ const n = projIn([t]).length; return `<button class="nav-chip" data-act="gotam" data-v="${t.id}" aria-current="${S.tam===t.id}" title="${t.target?'พื้นที่เป้าหมาย':'ไม่ใช่พื้นที่เป้าหมาย'}"><i class="dot" style="background:${t.target?'var(--blue)':'var(--p0)'}"></i>ต.${esc(t.t)}</button>`; }).join('');
    crumbs += `<span class="sep">›</span><button data-act="goprov" data-v="${esc(S.prov)}">จ.${esc(S.prov)}</button><span class="sep">›</span>${S.tam?`<button data-act="goamp" data-v="${esc(S.amp)}">อ.${esc(S.amp)}</button><span class="sep">›</span><strong>ต.${esc(T[S.tam].t)}</strong>`:`<strong>อ.${esc(S.amp)}</strong>`}`;
  }
  // detail
  let detail='';
  if(S.tam){
    const t = T[S.tam];
    const pj = projIn([t]);
    const bl = filt(P).filter(p=>!(p.tambons||[]).length && t.sb.includes(p.sb));
    detail = `<div class="info"><h2>ต.${esc(t.t)} <span class="note" style="font-size:.9rem">อ.${esc(t.a)} จ.${esc(t.p)}</span></h2><!--NAV-->${tamInfo(t)}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="maptam" data-v="${t.id}">ดูบนแผนที่</button>${t.sb.map(b=>`<button class="btn sm" data-act="gobasin" data-v="${esc(b)}">ลุ่มน้ำสาขา${esc(b)}</button>`).join('')}</div></div>
      <div class="sec-h"><h3>โครงการที่มีตำบลนี้เป็นพื้นที่เป้าหมาย (${fmt(pj.length)})</h3><button class="btn sm pink" data-act="newproj" data-tam="${t.id}">+ เสนอโครงการในตำบลนี้</button></div>
      ${projTable('tam', pj, {name:`ต.${t.t}_อ.${t.a}_จ.${t.p}`, empty: t.target ? 'ยังไม่มีโครงการที่ระบุตำบลนี้เป็นพื้นที่เป้าหมาย' : 'ไม่มีโครงการ — ตำบลนี้ไม่ได้เป็นพื้นที่เป้าหมายของแผนแม่บท'})}
      <details class="basin-level"><summary>แนวทางระดับลุ่มน้ำสาขาที่ตำบลนี้อยู่ (ไม่ระบุตำบลเป้าหมาย) · ${fmt(bl.length)} รายการ</summary><div class="inner">${projTable('tambl', bl, {name:`ระดับลุ่มน้ำ_ต.${t.t}`})}</div></details>`;
  } else {
    const ts = M.tambons.filter(t=>(!S.prov||t.p===S.prov)&&(!S.amp||t.a===S.amp));
    const tg = ts.filter(t=>t.target); const pj = projIn(ts);
    const lvl = S.amp ? `อ.${S.amp} จ.${S.prov}` : S.prov ? `จ.${S.prov}` : 'ทั้ง 6 จังหวัดในลุ่มน้ำปิง';
    const sbs = [...new Set(ts.flatMap(t=>t.sb))];
    detail = `<div class="info"><h2>${esc(lvl)}</h2><!--NAV-->
      <div class="sumgrid" style="margin-top:10px">
        <div class="stat"><div class="v">${fmt(ts.filter(t=>t.geo).length)}</div><div class="l">ตำบลในลุ่มน้ำปิง</div></div>
        <div class="stat"><div class="v">${fmt(tg.length)}</div><div class="l">ตำบลเป้าหมาย</div></div>
        <div class="stat"><div class="v">${fmt(sbs.length)}</div><div class="l">ลุ่มน้ำสาขาที่เกี่ยวข้อง</div></div>
        <div class="stat"><div class="v" style="color:var(--pink)">${fmt(pj.length)}</div><div class="l">โครงการที่ลงตำบล${filterActive()?' (ตามตัวกรอง)':''}</div></div>
      </div>
      ${statsBox(`<div class="lbl">สัดส่วนโครงการรายยุทธศาสตร์</div>${stratBar(pj)}
        <div class="lbl" style="margin-top:12px">ยุทธศาสตร์ที่มีปัญหา (จำนวนตำบลเป้าหมาย)</div>${stratProblems(tg)}
        <div class="lbl" style="margin-top:12px">กลุ่มพื้นที่ที่พบ ${tip('ตัวเลขในวง = จำนวนตำบลเป้าหมายที่อยู่ในกลุ่มพื้นที่นั้น')}</div>${grpCounts(tg)}`)}
    </div>
    <div class="sec-h"><h3>โครงการในพื้นที่ (${fmt(pj.length)}) ${tip('นับเฉพาะโครงการที่ระบุตำบลเป้าหมายในพื้นที่นี้ · โครงการเดียวอาจลงหลายตำบล จึงนับครั้งเดียว')}</h3></div>
    ${projTable('area', pj, {name: lvl})}`;
  }
  const nav = `<div class="navbox"><span class="lbl">${esc(head)}${S.amp?' '+tip('จุดสีน้ำเงิน = ตำบลพื้นที่เป้าหมาย · จุดสีเทา = ไม่ใช่พื้นที่เป้าหมาย'):''}</span><div class="nav-chips">${tree}</div>${S.prov?`<button class="linkbtn" data-act="up">ย้อนกลับ</button>`:''}</div>`;
  el.innerHTML = `<div class="crumbs">${crumbs}</div>${detail.replace('<!--NAV-->', nav)}`;
}

/* ================= VIEW: BASIN ================= */
function renderBasin(){
  const el = $('#view');
  const fl = filt(P);
  if(!S.basin){
    el.innerHTML = `<div class="sec-h" style="margin-top:0"><h2>ลุ่มน้ำสาขา 30 ลุ่มน้ำ</h2><span class="note">เลือกลุ่มน้ำสาขาเพื่อดูกลุ่มพื้นที่ ตำบลเป้าหมาย และโครงการ</span></div>
    <div class="bgrid">${M.basins.map(b=>{ const ts=tamInBasin(b.name); const tg=ts.filter(t=>t.target); const n=fl.filter(p=>p.sb===b.name).length;
      return `<button class="bcard" data-act="gobasin" data-v="${esc(b.name)}"><span class="code">รหัส ${esc(b.code)} · ${fmt(b.area)} ตร.กม.</span><span class="nm">${esc(b.name)}</span>
      <span class="row2"><span>ตำบล <b>${ts.length}</b></span><span>เป้าหมาย <b>${tg.length}</b></span><span>โครงการ <b style="color:var(--pink)">${fmt(n)}</b></span></span>
      ${stratBar(fl.filter(p=>p.sb===b.name)).split('<div class="legend">')[0]}</button>`; }).join('')}</div>`;
    return;
  }
  const b = BAS[S.basin];
  const sub = !!S.bprov;
  const ts = tamInBasin(b.name).filter(t=>(!S.bprov||t.p===S.bprov)&&(!S.bamp||t.a===S.bamp)&&(!S.btam||t.id===S.btam)); const tg = ts.filter(t=>t.target);
  const tsIds = new Set(ts.map(t=>t.id));
  const pj = fl.filter(p=>p.sb===b.name && (!sub || (p.tambons||[]).some(id=>tsIds.has(id))));
  const subLbl = S.btam ? `ต.${T[S.btam].t} อ.${S.bamp} จ.${S.bprov}` : S.bamp ? `อ.${S.bamp} จ.${S.bprov}` : S.bprov ? `จ.${S.bprov}` : '';
  const sc = {1:0,2:0,3:0,4:0,5:0}; tg.forEach(t=>t.strat.forEach(n=>sc[n]++));
  const provs = [...new Set(ts.map(t=>t.p))];
  el.innerHTML = `<div class="crumbs"><button data-act="gobasin" data-v="">ลุ่มน้ำสาขาทั้งหมด</button><span class="sep">›</span>${subLbl?`<button data-act="gobasin" data-v="${esc(b.name)}">${esc(b.name)}</button><span class="sep">›</span><strong>${esc(subLbl)}</strong>`:`<strong>${esc(b.name)}</strong>`}</div>
  <div class="info"><h2>ลุ่มน้ำสาขา${esc(b.name)}${subLbl?` <span class="note" style="font-size:.95rem">· เฉพาะ ${esc(subLbl)}</span>`:''}</h2><div class="note">รหัส ${esc(b.code)} · พื้นที่ ${fmt(b.area)} ตร.กม. · จังหวัด ${provs.map(esc).join(', ')}</div>
    <div class="sumgrid" style="margin-top:10px">
      <div class="stat"><div class="v">${ts.length}</div><div class="l">${subLbl?'ตำบลในพื้นที่ที่เลือก':'ตำบลที่อยู่ในลุ่มน้ำ'}</div></div>
      <div class="stat"><div class="v">${tg.length}</div><div class="l">ตำบลเป้าหมาย</div></div>
      <div class="stat"><div class="v" style="color:var(--pink)">${fmt(pj.length)}</div><div class="l">แนวทาง/โครงการ${filterActive()?' (ตามตัวกรอง)':''}</div></div>
    </div>
    ${statsBox(`<div class="lbl">สัดส่วนโครงการรายยุทธศาสตร์</div>${stratBar(pj)}
      <div class="lbl" style="margin-top:12px">ยุทธศาสตร์ที่มีปัญหา (จำนวนตำบลเป้าหมาย)</div>${stratProblems(tg)}
      <div class="lbl" style="margin-top:12px">กลุ่มพื้นที่ในลุ่มน้ำนี้ ${tip('ตัวเลขในวง = จำนวนตำบลเป้าหมายที่อยู่ในกลุ่มพื้นที่นั้น')}</div>${grpCounts(tg)}`)}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="mapbasin" data-v="${esc(b.name)}">ดูบนแผนที่</button><button class="btn sm pink" data-act="newproj" data-sb="${esc(b.name)}">+ เสนอโครงการในลุ่มน้ำนี้</button></div>
  </div>
  ${Object.values(b.keyF||{}).some(Boolean)?`<div class="keyf-box"><div class="keyf-h"><span class="lbl">แนวทางสำคัญรายแผนงาน (สรุปจากแผนแม่บท) · กดหรือชี้ที่แผนงานเพื่อดูรายละเอียด</span></div>
    <div class="keyf-chips">${Object.entries(b.keyF).filter(([k,v])=>v).map(([k,v])=>`<button type="button" class="chip keyf-c" data-act="keyf" data-v="${k}" aria-expanded="false" title="${esc(k+' '+(PROG[k]?.name||'')+'\n'+v)}"><b>${k}</b> ${esc(PROG[k]?.name||'')}</button>`).join('')}<button type="button" class="linkbtn" data-act="keyfall">แสดงทั้งหมด</button></div>
    <div class="keyf-panel" id="keyfPanel" hidden></div>
    <template id="keyfData">${Object.entries(b.keyF).filter(([k,v])=>v).map(([k,v])=>`<div data-k="${k}"><b>${k} ${esc(PROG[k]?.name||'')}</b>${esc(v)}</div>`).join('')}</template></div>`:''}
  <div class="sec-h"><h3>${subLbl?'ตำบลใน'+esc(subLbl):'ตำบลในลุ่มน้ำ'} (${ts.length})</h3><span class="note">คลิกเพื่อดูข้อมูลตำบล</span></div>
  <div class="chips">${ts.sort((x,y)=>(y.target-x.target)||x.t.localeCompare(y.t,'th')).map(t=>`<button class="chip" data-act="gotamfull" data-v="${t.id}" title="${esc(tamName(t))}"><i style="background:${t.target?'var(--blue)':'var(--p0)'}"></i>ต.${esc(t.t)}</button>`).join('')}</div>
  <div class="sec-h"><h3>แนวทาง/โครงการ${subLbl?'ที่ลง'+esc(subLbl):'ในลุ่มน้ำ'} (${fmt(pj.length)})</h3>${subLbl?'<span class="note">เฉพาะโครงการที่ระบุตำบลเป้าหมายในพื้นที่นี้</span>':''}</div>
  ${projTable('basin', pj, {noBasin:true, name:'ลุ่มน้ำสาขา'+b.name+(subLbl?'_'+subLbl:'')})}`;
}

/* ================= VIEW: MAP ================= */
let MAP=null, L_T=null, L_SB=null, L_PV=null, L_AM=null, L_RV=null, L_HS=null, L_BASE=null, L_LBL=null, GEO={};
let mapMode='target', mapStrat='all', L_PIE=null, mapSel=null, mapOp=.55, MF={active:false,cnt:{}};
const MS = {kind:'basin', basin:'', prov:'', amp:'', tam:''};
const RIVER='#2a7fd4';
async function loadGeo(){
  if(GEO.t) return;
  const names=['tambon','subbasin','province','amphoe','river'];
  const res = await Promise.all(names.map(n=>fetch(DATA+n+'.geojson').then(r=>r.json())).concat([fetch(DATA+'hillshade_bounds.json').then(r=>r.json())]));
  GEO = {t:res[0], sb:res[1], pv:res[2], am:res[3], rv:res[4], hb:res[5]};
}
function projFilterActive(){ const f=S.f; return !!(f.q||f.s.size||f.F||f.S||f.src); }
function computeMF(){
  const cnt={}; filt(P).forEach(p=>(p.tambons||[]).forEach(id=>cnt[id]=(cnt[id]||0)+1));
  MF = {active: filterActive(), proj: projFilterActive(), cnt};
}
function tamMatch(t){
  if(!t) return false;
  const f=S.f;
  if(f.grp && !matchGrp(t.grp, f.grp)) return false;
  if(MF.proj && !MF.cnt[t.id]) return false;
  return true;
}
function inScope(t){
  if(!t) return false;
  if(MS.kind==='basin' && MS.basin && sbMain(t)!==MS.basin) return false;
  return (!MS.prov||t.p===MS.prov) && (!MS.amp||t.a===MS.amp) && (!MS.tam||t.id===MS.tam);
}
function pieSVG(list, d){
  const r = d/2, n = list.length;
  if(n===1) return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${r}" cy="${r}" r="${r-1}" fill="${SHEX[list[0]]}" stroke="#fff" stroke-width="1.5"/></svg>`;
  let a0 = -Math.PI/2, paths = '';
  list.forEach(k=>{ const a1 = a0 + 2*Math.PI/n; const rr = r-1;
    const x0 = r+rr*Math.cos(a0), y0 = r+rr*Math.sin(a0), x1 = r+rr*Math.cos(a1), y1 = r+rr*Math.sin(a1);
    paths += `<path d="M${r},${r} L${x0.toFixed(2)},${y0.toFixed(2)} A${rr},${rr} 0 ${a1-a0>Math.PI?1:0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${SHEX[k]}"/>`; a0 = a1; });
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">${paths}<circle cx="${r}" cy="${r}" r="${r-1}" fill="none" stroke="#fff" stroke-width="1.5"/></svg>`;
}
function refreshPies(){
  if(!MAP) return;
  if(L_PIE){ L_PIE.remove(); L_PIE=null; }
  if(!(mapMode==='strat' && mapStrat==='all')) return;
  const z = MAP.getZoom(); const d = z<8 ? 10 : z<9 ? 14 : z<10 ? 18 : 22;
  L_PIE = L.layerGroup();
  L_T.getLayers().forEach(l=>{ const t=T[l.feature.properties.id]; if(!t || !t.strat.length || !inScope(t) || !tamMatch(t)) return;
    L.marker(l.getBounds().getCenter(), {interactive:false, keyboard:false, icon:L.divIcon({className:'pie', html:pieSVG(t.strat,d), iconSize:[d,d], iconAnchor:[d/2,d/2]})}).addTo(L_PIE); });
  L_PIE.addTo(MAP);
}
function restyle(){ L_T.setStyle(tamStyle); refreshPies(); }
function tamStyle(f){
  const t = T[f.properties.id]; let fill='#cfd6e2', op=mapOp;
  if(mapMode==='target'){ fill = t?.target ? TGHEX : '#ffffff'; if(!t?.target) op = mapOp*.35; }
  else if(mapMode==='count'){ const n = MF.cnt[t.id]||0; const ramp=['#ffffff','#c6d7ee','#8fb0dd','#4f7fc2','#2c5ea5','#1d3766']; fill = ramp[n===0?0:n<=3?1:n<=6?2:n<=10?3:n<=15?4:5]; if(!n) op=mapOp*.35; }
  else if(mapMode==='strat' && mapStrat==='all'){ const n = t?.strat.length||0; fill = ['#ffffff','#e3e7ee','#c9d0dc','#a9b3c4','#8692a8','#6b7790'][n]; if(!n) op=mapOp*.35; }
  else if(mapMode==='strat'){ const on = t?.strat.includes(+mapStrat); fill = on ? SHEX[mapStrat] : '#ffffff'; if(!on) op=mapOp*.35; }
  if(!inScope(t) && mapSel!==f.properties.id) return {opacity:0, fillOpacity:0, weight:0};
  const live = tamMatch(t) || mapSel===f.properties.id;
  if(!live){ op = .04; }
  const sel = mapSel===f.properties.id;
  return {color: sel?'#c04a80':(live?'#ffffff':'#ffffff'), weight: sel?3:(live?.8:.3), opacity: live?.9:.35, fillColor:fill, fillOpacity:op};
}
function scopeBounds(){
  const lyr = L_T.getLayers().filter(l=>{ const t=T[l.feature.properties.id]; return inScope(t) && tamMatch(t); });
  if(!lyr.length) return null;
  return L.featureGroup(lyr).getBounds();
}
function fitScope(){ const b = scopeBounds(); if(b && b.isValid()) MAP.fitBounds(b, {padding:[20,20], maxZoom:11}); }
function mapLabels(){
  if(L_LBL) L_LBL.remove();
  L_LBL = L.layerGroup();
  const add = (layer, text)=>{ const c = layer.getBounds().getCenter(); L.tooltip({permanent:true, direction:'center', className:'tlbl', interactive:false}).setLatLng(c).setContent(esc(text)).addTo(L_LBL); };
  if(MS.kind==='basin'){
    L_SB.getLayers().forEach(l=>{ const n=l.feature.properties.name; if(!MS.basin || MS.basin===n) add(l, n); });
  } else if(MS.prov){
    L_AM.getLayers().forEach(l=>{ const [p,a]=l.feature.properties.key.split('|'); if(p===MS.prov && (!MS.amp||MS.amp===a)) add(l, 'อ.'+a); });
  } else {
    L_PV.getLayers().forEach(l=>add(l, 'จ.'+l.feature.properties.name));
  }
  L_LBL.addTo(MAP); labelZoom();
}
function labelZoom(){ if(!L_LBL) return; const crowded = MS.kind==='basin' ? !MS.basin : !MS.prov; const show = !crowded || MAP.getZoom()>=8.75; show ? L_LBL.addTo(MAP) : L_LBL.remove(); }
function mapBoundaryLayers(){
  const basin = MS.kind==='basin';
  [L_SB].forEach(l=> basin ? l.addTo(MAP) : l.remove());
  [L_PV, L_AM].forEach(l=> basin ? l.remove() : l.addTo(MAP));
  L_SB.setStyle(f=>{ const hide = MS.basin && MS.basin!==f.properties.name; return {color:'#1d3766', weight: MS.basin?3:1.6, opacity: hide?0:1, fill:false}; });
  L_AM.setStyle(f=>{ const [p,a]=f.properties.key.split('|'); const hide = (MS.prov && MS.prov!==p) || (MS.amp && MS.amp!==a); return {color:'#1d3766', weight: MS.amp===a?3:.9, opacity: hide?0:.8, fill:false}; });
  L_PV.setStyle(f=>{ const hide = MS.prov && MS.prov!==f.properties.name; return {color:'#1d3766', weight: MS.prov?3:2, opacity: hide?0:1, dashArray:'6 4', fill:false}; });
  L_RV.bringToFront();
}
function scopeTools(){
  const pool = M.tambons.filter(t=>t.geo && (MS.kind!=='basin' || !MS.basin || sbMain(t)===MS.basin));
  const provs = [...new Set(pool.map(t=>t.p))].sort((a,b)=>a.localeCompare(b,'th'));
  const amps = MS.prov ? [...new Set(pool.filter(t=>t.p===MS.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
  const tams = MS.amp ? pool.filter(t=>t.p===MS.prov&&t.a===MS.amp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
  const inB = MS.kind==='basin' && MS.basin;
  const basinSel = MS.kind==='basin' ? `<div class="fld"><label for="msBasin">ลุ่มน้ำสาขา</label><select id="msBasin"><option value="">ทั้ง 30 ลุ่มน้ำสาขา</option>${M.basins.map(b=>`<option ${MS.basin===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>` : '';
  return basinSel + `<div class="fld"><label for="msProv">จังหวัด${inB?' (ในลุ่มน้ำนี้)':''}</label><select id="msProv"><option value="">${inB?`ทุกจังหวัดในลุ่มน้ำนี้ (${provs.length})`:'ทั้ง 6 จังหวัดในลุ่มน้ำปิง'}</option>${provs.map(p=>`<option ${MS.prov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
  <div class="fld"><label for="msAmp">อำเภอ</label><select id="msAmp" ${MS.prov?'':'disabled'}><option value="">${MS.prov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${MS.amp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
  <div class="fld"><label for="msTam">ตำบล</label><select id="msTam" ${MS.amp?'':'disabled'}><option value="">${MS.amp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${MS.tam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div>`;
}
function bindScope(){
  const on = (id, fn)=>{ const el=$('#'+id); if(el) el.onchange = e=>{ fn(e.target.value); afterScope(); }; };
  on('msBasin', v=>{ MS.basin=v; MS.prov=''; MS.amp=''; MS.tam=''; mapSel=null; });
  on('msProv', v=>{ MS.prov=v; MS.amp=''; MS.tam=''; mapSel=null; });
  on('msAmp', v=>{ MS.amp=v; MS.tam=''; mapSel=null; });
  on('msTam', v=>{ MS.tam=v; if(!v) mapSel=null; });
}
function afterScope(){
  $('#mScope').innerHTML = scopeTools(); bindScope(); addClearButtons($('#mScope'));
  if(MS.kind!=='admin' || !MS.tam){ if(mapSel && !inScope(T[mapSel])) mapSel=null; }
  mapBoundaryLayers(); restyle(); mapLabels(); fitScope(); mapLegend(); mapProjects();
  const fc=$('#filters .fcount'); if(fc) fc.innerHTML = scopeCount();
  if(L_HS) L_HS.setOpacity((MS.basin && MS.kind==='basin') || MS.prov ? .5 : 1);
  if(MS.tam){ const l=L_T.getLayers().find(x=>x.feature.properties.id===MS.tam); if(l) MAP.fitBounds(l.getBounds(), {maxZoom:11, padding:[30,30]}); mapPick(MS.tam, true); }
}
async function renderMap(){
  const el = $('#view');
  computeMF();
  if(!$('#map')){
    el.innerHTML = `<div class="map-tools">
        <div class="fld"><span class="lbl">ดูตามขอบเขตพื้นที่</span><div class="seg" role="radiogroup">
          <button type="button" class="seg-b" data-act="mkind" data-v="basin" aria-pressed="${MS.kind==='basin'}">ลุ่มน้ำสาขา</button>
          <button type="button" class="seg-b" data-act="mkind" data-v="admin" aria-pressed="${MS.kind==='admin'}">จังหวัด › อำเภอ › ตำบล</button></div></div>
        <div id="mScope" style="display:contents"></div>
      </div>
      <div class="map-tools">
        <div class="fld"><label for="mMode">ระบายสีตำบลตาม</label><select id="mMode"><option value="target">พื้นที่เป้าหมาย</option><option value="count">จำนวนโครงการ</option><option value="strat">ยุทธศาสตร์ที่มีปัญหา</option></select></div>
        <div class="fld" id="mStratWrap" hidden><label for="mStrat">ยุทธศาสตร์</label><select id="mStrat"><option value="all" selected>แสดงครบทั้ง 5 ยุทธศาสตร์</option>${M.strategies.map(s=>`<option value="${s.n}">${s.n} ${esc(s.short)}</option>`).join('')}</select></div>
        <div class="fld"><label for="mOp">ความเข้มสีตำบล</label><input id="mOp" type="range" min="0" max="90" value="${Math.round(mapOp*100)}"></div>
        <label class="chip"><input type="checkbox" id="mHS" checked> ภูมิประเทศ (DEM)</label>
        ${CFG.basemap?`<div class="fld"><label for="mBase">แผนที่ฐาน</label><select id="mBase"><option value="gray">แผนที่สีเทา</option><option value="osm">OpenStreetMap</option><option value="sat">ภาพถ่ายดาวเทียม</option><option value="none">ไม่แสดง</option></select></div>`:''}
      </div>
      <div class="mapbox"><div style="min-width:0">
      <div id="map" role="region" aria-label="แผนที่ลุ่มน้ำปิง"></div>
      <div class="map-legend" id="mLegend"></div></div>
      <div id="mapSide" class="panel" style="min-width:0"><div class="panel-h"><h3>ข้อมูลตำบล</h3></div><div style="padding:14px" class="note">คลิกตำบลบนแผนที่เพื่อดูข้อมูลพื้นที่</div></div></div>
      <div id="mapProj"></div>`;
    $('#mScope').innerHTML = scopeTools();
    await loadGeo();
    MAP = L.map('map', {zoomSnap:.25, preferCanvas:true}).setView([17.6,99.1], 7.5);
    if(CFG.basemap){ setBase('gray'); }
    L_HS = L.imageOverlay(DATA+'hillshade.webp', GEO.hb, {opacity:1}).addTo(MAP);
    L_T = L.geoJSON(GEO.t, {style:tamStyle, onEachFeature:(f,l)=>{ const t=T[f.properties.id]; l.bindTooltip(t?`ต.${t.t} อ.${t.a}`:'', {sticky:true}); l.on('tooltipopen',()=>{ if(!inScope(t)) l.closeTooltip(); }); l.on('click',e=>{ if(inScope(t)) mapPick(f.properties.id, true, false, e.latlng); }); }}).addTo(MAP);
    L_PV = L.geoJSON(GEO.pv, {interactive:false});
    L_AM = L.geoJSON(GEO.am, {interactive:false});
    L_SB = L.geoJSON(GEO.sb, {interactive:false});
    L_RV = L.geoJSON(GEO.rv, {style:{color:RIVER, weight:2.2, opacity:.95}, interactive:false}).addTo(MAP);
    $('#mMode').onchange = e=>{ mapMode=e.target.value; $('#mStratWrap').hidden = mapMode!=='strat'; restyle(); mapLegend(); };
    $('#mStrat').onchange = e=>{ mapStrat=e.target.value; restyle(); mapLegend(); };
    $('#mOp').oninput = e=>{ mapOp = e.target.value/100; restyle(); };
    $('#mHS').onchange = e=> e.target.checked ? L_HS.addTo(MAP) : L_HS.remove();
    if($('#mBase')) $('#mBase').onchange = e=> setBase(e.target.value);
    MAP.on('zoomend', ()=>{ labelZoom(); refreshPies(); });
    afterScope();
    if(mapSel && !MS.tam) mapPick(mapSel, false);
  } else {
    restyle(); mapLegend(); mapProjects();
    if(MF.active) fitScope();
    setTimeout(()=>MAP.invalidateSize(),50);
  }
}
const BASES = {
  gray:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}','แผนที่ฐาน © Esri',16],
  osm:['https://tile.openstreetmap.org/{z}/{x}/{y}.png','© OpenStreetMap contributors',19],
  sat:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}','ภาพถ่ายดาวเทียม © Esri, Maxar, Earthstar Geographics',18]
};
function setBase(k){
  if(L_BASE){ L_BASE.remove(); L_BASE=null; }
  const b = BASES[k]; if(!b) return;
  L_BASE = L.tileLayer(b[0], {attribution:b[1], maxZoom:b[2]}).addTo(MAP); L_BASE.bringToBack();
}
function mapProjects(){
  const el = $('#mapProj'); if(!el) return;
  let list, title;
  if(mapSel && T[mapSel]){
    const t = T[mapSel]; list = filt(IDX.byTam[mapSel]||[]);
    title = `โครงการที่ลง ต.${esc(t.t)} อ.${esc(t.a)} จ.${esc(t.p)}`;
  } else {
    const ids = new Set(M.tambons.filter(t=>inScope(t)).map(t=>t.id));
    list = filt(P).filter(p=>(MS.kind!=='basin' || !MS.basin || p.sb===MS.basin) && ((p.tambons||[]).some(id=>ids.has(id)) || (MS.kind==='basin' && MS.basin && !MS.prov && p.sb===MS.basin && !(p.tambons||[]).length)));
    const adm = MS.tam ? 'ต.'+esc(T[MS.tam].t)+' อ.'+esc(MS.amp) : MS.amp ? 'อ.'+esc(MS.amp)+' จ.'+esc(MS.prov) : MS.prov ? 'จ.'+esc(MS.prov) : '';
    const where = MS.kind==='basin' && MS.basin ? 'ลุ่มน้ำสาขา'+esc(MS.basin)+(adm?' · '+adm:'') : (adm || 'ทั้ง 6 จังหวัดในลุ่มน้ำปิง');
    title = `โครงการใน${where}`;
  }
  el.innerHTML = `<div class="sec-h"><h3>${title} (${fmt(list.length)})</h3><span class="note">${MF.active?'ตามตัวกรองด้านบน · ':''}${mapSel?'<button class="linkbtn" data-act="mapunsel">ดูโครงการทั้งพื้นที่ที่เลือก</button>':'คลิกตำบลบนแผนที่เพื่อดูเฉพาะตำบล'}</span></div>${projTable('map', list, {name: title.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&')})}`;
}
function mapLegend(){
  let h='';
  if(mapMode==='target') h = `<span><i style="background:${TGHEX}"></i>พื้นที่เป้าหมาย (212 ตำบล)</span><span><i style="background:#ffffff"></i>ไม่ใช่พื้นที่เป้าหมาย</span>`;
  if(mapMode==='count') h = [['#ffffff','0'],['#c6d7ee','1–3'],['#8fb0dd','4–6'],['#4f7fc2','7–10'],['#2c5ea5','11–15'],['#1d3766','มากกว่า 15']].map(([c,l])=>`<span><i style="background:${c}"></i>${l} โครงการ</span>`).join('');
  if(mapMode==='strat' && mapStrat==='all') h = M.strategies.map(st=>`<span><i style="background:${SHEX[st.n]};border-radius:50%"></i>ยศ.${st.n} ${esc(st.short)}</span>`).join('') + `<span class="note">วงกลมในตำบลแบ่งสีตามยุทธศาสตร์ที่มีปัญหา · พื้นตำบลยิ่งเข้มยิ่งมีปัญหาหลายด้าน</span>`;
  else if(mapMode==='strat') h = `<span><i style="background:${SHEX[mapStrat]}"></i>มีปัญหาด้าน${esc(STRAT[mapStrat].short)}</span><span><i style="background:#ffffff"></i>ไม่พบปัญหาด้านนี้</span>`;
  h += `<span><i style="background:${RIVER};height:3px;border:0"></i>แม่น้ำปิงและลำน้ำสายหลัก</span><span><i style="background:transparent;border:2px solid #1d3766"></i>${MS.kind==='basin'?'ขอบเขตลุ่มน้ำสาขา':'ขอบเขตจังหวัด/อำเภอ'}</span>`;
  const n = M.tambons.filter(t=>t.geo && inScope(t) && tamMatch(t)).length;
  const fl = filt(P);
  const basinOnly = fl.filter(p=>!(p.tambons||[]).length && (MS.kind!=='basin' || !MS.basin || p.sb===MS.basin)).length;
  const note = MF.active
    ? `<div class="map-note">ตัวกรองทำงานอยู่ · แสดง <b>${fmt(n)}</b> ตำบลที่ตรงเงื่อนไข${MF.proj?` (มีโครงการตรงตัวกรอง)`:''} · ตำบลอื่นจางลง${MF.proj&&basinOnly?` · มีแนวทางระดับลุ่มน้ำที่ไม่ระบุตำบลอีก ${fmt(basinOnly)} รายการ`:''} <button class="linkbtn" data-act="clear">ล้างตัวกรอง</button></div>`
    : `<div class="map-note">แสดง ${fmt(n)} ตำบล · ใช้ตัวกรองด้านบน (ยุทธศาสตร์ แผนงาน มาตรการ กลุ่มพื้นที่ หรือคำค้น) เพื่อไฮไลต์ตำบลบนแผนที่</div>`;
  $('#mLegend').innerHTML = note + `<div style="display:flex;flex-wrap:wrap;gap:4px 14px">${h}</div>`;
}
function tamPopup(t){
  const n = (IDX.byTam[t.id]||[]).length, nf = MF.cnt[t.id]||0;
  return `<div class="pop"><b class="pop-t">ต.${esc(t.t)}</b><div class="pop-s">อ.${esc(t.a)} จ.${esc(t.p)}</div>
    <div class="pop-r">${tPill(t)}</div>
    ${t.strat.length?`<div class="pop-r">${t.strat.map(sPill).join(' ')}</div>`:''}
    ${t.grp.length?`<div class="pop-r"><span class="pop-k">กลุ่มพื้นที่</span> ${t.grp.join(', ')}</div>`:''}
    <div class="pop-r"><span class="pop-k">ลุ่มน้ำสาขา</span> ${esc(sbMain(t))}</div>
    <div class="pop-r"><span class="pop-k">โครงการ</span> <b>${fmt(n)}</b> รายการ${MF.proj?` · ตรงตัวกรอง ${fmt(nf)}`:''}</div>
    <button class="btn sm primary" data-act="gotamfull" data-v="${t.id}" style="margin-top:6px">เปิดหน้าตำบล</button></div>`;
}
function mapPick(id, noZoom, noPopup, latlng){
  mapSel = id; restyle();
  const t = T[id]; const pj = filt(IDX.byTam[id]||[]);
  const lyr = L_T.getLayers().find(l=>l.feature.properties.id===id);
  if(lyr){ lyr.bringToFront(); L_RV.bringToFront(); }
  if(lyr && !noZoom && !MAP.getBounds().contains(lyr.getBounds())) MAP.fitBounds(lyr.getBounds(), {maxZoom:11});
  if(lyr){ L.popup({maxWidth:280, autoPanPadding:[20,20]}).setLatLng(latlng || lyr.getBounds().getCenter()).setContent(tamPopup(t)).openOn(MAP); }
  $('#mapSide').innerHTML = `<div class="panel-h"><h3>ต.${esc(t.t)} อ.${esc(t.a)} จ.${esc(t.p)}</h3></div><div style="padding:4px 14px 14px">${tamInfo(t, true)}
    <div class="lbl" style="margin-top:10px">โครงการ</div><div><b class="num">${fmt(pj.length)}</b> รายการ${MF.proj?' (ตามตัวกรอง)':''} · <button class="linkbtn" data-act="mapgoproj">ดูรายการใต้แผนที่</button></div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" data-act="gotamfull" data-v="${id}">เปิดหน้าตำบล</button><button class="btn sm" data-act="newproj" data-tam="${id}">+ เสนอโครงการ</button></div></div>`;
  mapProjects();
}

/* ================= VIEW: ADMIN ================= */
function renderAdmin(){
  const el = $('#view');
  if(!S.admin){
    el.innerHTML = `<div class="info" style="max-width:640px"><h2>สำหรับผู้ดูแลระบบ</h2>
      <p>หน้านี้ใช้คัดกรองและอนุมัติโครงการที่มีผู้เสนอเข้ามา รวมทั้งแก้ไขข้อมูลโครงการที่มีอยู่แล้ว ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลก่อน</p>
      <button class="btn primary" data-act="login">เข้าสู่ระบบผู้ดูแล</button>
</div>`;
    return;
  }
  const subs = SUBS.map(s=>`<div class="sub-card" data-sid="${esc(s._id)}">
    <div style="display:flex;gap:8px;align-items:start;flex-wrap:wrap"><span class="pill pending">รอพิจารณา</span>${sPill(s.s)}<b style="flex:1;min-width:200px">${esc(s.title)}</b></div>
    <div class="meta">ลุ่มน้ำ${esc(s.sb)} · ${esc(s.F)} / ${esc(s.S)} · ${(s.tambons||[]).length ? (s.tambons||[]).map(id=>'ต.'+(T[id]?.t||id)).join(', ') : 'ไม่ระบุตำบล'}</div>
    ${s.detail?`<div style="font-size:.88rem">${esc(s.detail)}</div>`:''}
    <div class="meta">เสนอโดย ${esc(s.proposer)} · ${esc(s.proposerOrg)}${s.proposerContact?' · '+esc(s.proposerContact):''} · ${s.createdAt?.seconds?new Date(s.createdAt.seconds*1000).toLocaleString('th-TH'):''}</div>
    <div class="acts"><button class="btn sm primary" data-act="approve" data-sid="${esc(s._id)}">อนุมัติ</button><button class="btn sm" data-act="review" data-sid="${esc(s._id)}">ตรวจ/แก้ไขก่อนอนุมัติ</button><button class="btn sm danger" data-act="reject" data-sid="${esc(s._id)}">ไม่อนุมัติ</button></div>
    <div class="rej" hidden><div class="confirm-box"><input id="rr_${esc(s._id)}" placeholder="เหตุผล (ถ้ามี)" style="flex:1;min-width:160px;border:1px solid var(--line-2);border-radius:6px;padding:5px 8px"><button class="btn sm danger" data-act="rejectok" data-sid="${esc(s._id)}">ยืนยันไม่อนุมัติ</button><button class="btn sm" data-act="rejectno">ยกเลิก</button></div></div>
  </div>`).join('');
  const aud = AUDIT.slice(0,40).map(a=>{ const ts = a.ts?.seconds ? a.ts.seconds*1000 : a.ts; return `<tr><td class="num sub">${ts?new Date(ts).toLocaleString('th-TH'):''}</td><td>${esc(a.by)}</td><td>${esc(a.action)}</td><td class="num">${esc(a.id)}</td><td>${esc(a.detail)}</td></tr>`; }).join('');
  el.innerHTML = `<div class="sec-h" style="margin-top:0"><h2>กล่องรอพิจารณา (${SUBS.length})</h2><span class="note">โครงการที่มีผู้เสนอเข้ามาจะยังไม่แสดงให้ทุกคนเห็น จนกว่าผู้ดูแลจะอนุมัติ</span></div>
  <div class="stack">${subs || '<div class="empty">ไม่มีโครงการรอพิจารณา</div>'}</div>
  ${S.seedFallback?`<div class="info" style="margin-top:18px;border-color:var(--pink)"><h3>ฐานข้อมูลออนไลน์ยังว่าง</h3><p class="note">ตอนนี้หน้าเว็บแสดงข้อมูลตั้งต้นจากไฟล์ Excel แบบอ่านอย่างเดียว กดปุ่มนี้หนึ่งครั้งเพื่อนำเข้า ${fmt(SEED.length)} โครงการลงฐานข้อมูล ก่อนจึงจะแก้ไขได้</p><button class="btn pink" data-act="seed">นำเข้าข้อมูลตั้งต้น</button> <span id="seedProg" class="note"></span></div>`:''}
  <div class="sec-h"><h2>เครื่องมือข้อมูล</h2></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export">ส่งออกโครงการเป็น Excel</button>${Store.mode==='demo'?'<button class="btn danger" data-act="demoreset">ล้างข้อมูลทดลองในเบราว์เซอร์นี้</button>':''}</div>
  <div id="resetBox"></div>
  <div class="sec-h"><h2>ประวัติการแก้ไขล่าสุด</h2></div>
  ${aud?`<div class="tbl-wrap"><table><thead><tr><th>เวลา</th><th>ผู้ดำเนินการ</th><th>การดำเนินการ</th><th>รหัส</th><th>รายละเอียด</th></tr></thead><tbody>${aud}</tbody></table></div>`:'<div class="empty">ยังไม่มีประวัติ</div>'}`;
}

/* ================= PROJECT DETAIL & FORM ================= */
function modal(html, cls='', locked=false){
  closeModal();
  const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='modalBg';
  bg.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  if(locked) bg.dataset.locked='1';
  bg.addEventListener('click', e=>{ if(e.target===bg && !locked) closeModal(); });
  document.body.appendChild(bg);
  const f = bg.querySelector('input,select,textarea,button.btn'); if(f) f.focus();
}
function closeModal(){ $('#modalBg')?.remove(); }
function openProject(id){
  const p = P.find(x=>x.id===id); if(!p) return;
  const tams = (p.tambons||[]).map(i=>T[i]).filter(Boolean);
  const grp = [...projGroups(p)].sort();
  modal(`<div class="modal-h"><div><div class="note">${esc(p.id)} · ${p.src==='new'?'เพิ่มใหม่':'จากแผนแม่บท'}</div><h2>${esc(p.title)}</h2></div><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="modal-b">
    <dl class="dl" style="margin:0">
      <dt>ยุทธศาสตร์</dt><dd>${sPill(p.s)} ${esc(STRAT[p.s]?.short||'')}</dd>
      <dt>แผนงานหลัก</dt><dd>${String(p.F).split(/,\s*/).map(f=>`<span class="pill code">${esc(f)}</span> ${esc(PROG[f]?.name||'')}`).join('<br>')}</dd>
      <dt>มาตรการเชิงยุทธศาสตร์</dt><dd><span class="pill code">${esc(p.S)}</span> ${esc(MEAS[p.S]?.name||'')}${MEAS[p.S]?.desc?`<div class="note">${esc(MEAS[p.S].desc)}</div>`:''}</dd>
      <dt>ลุ่มน้ำสาขา</dt><dd><button class="linkbtn" data-act="gobasin" data-v="${esc(p.sb)}">${esc(p.sb)}</button></dd>
      ${p.ref?`<dt>ตารางอ้างอิง</dt><dd>${esc(p.ref)}</dd>`:''}
      <dt>รายละเอียด</dt><dd style="white-space:pre-line">${esc(p.detail||p.title)}</dd>
      <dt>ตำบลเป้าหมาย</dt><dd>${tams.length ? tams.map(t=>`<button class="linkbtn" data-act="gotamfull" data-v="${t.id}">${esc(tamName(t))}</button>`).join('<br>') : 'ไม่มีตำบลเป้าหมายตามยุทธศาสตร์นี้ (แนวทางระดับลุ่มน้ำสาขา)'}</dd>
      <dt>กลุ่มพื้นที่</dt><dd>${grp.length ? grp.map(g=>`<span class="pill code" title="${esc(M.groups[g]||'')}">${g}</span>`).join(' ') : (MEAS[p.S]?.groups?`<span class="note">ตามมาตรการ: ${esc(MEAS[p.S].groups)}</span>`:'–')}</dd>
      <dt>หน่วยงานรับผิดชอบ</dt><dd>${esc(p.agency)||'–'}</dd>
      <dt>งบประมาณ</dt><dd class="num">${p.budget!=null&&p.budget!==''?fmt(p.budget)+' ล้านบาท':'–'}</dd>
      <dt>ระยะเวลา</dt><dd class="num">${p.yearStart||p.yearEnd?`พ.ศ. ${esc(p.yearStart||'?')} – ${esc(p.yearEnd||'?')}`:'–'}</dd>
      <dt>สถานะ</dt><dd>${esc(p.status)||'–'}</dd>
      ${p.note?`<dt>หมายเหตุ</dt><dd>${esc(p.note)}</dd>`:''}
      ${p.proposer?`<dt>ผู้เสนอ</dt><dd>${esc(p.proposer)} · ${esc(p.proposerOrg)}</dd>`:''}
      ${p.updatedBy?`<dt>แก้ไขล่าสุด</dt><dd class="note">${esc(p.updatedBy)} · ${new Date(p.updatedAt).toLocaleString('th-TH')}</dd>`:''}
    </dl>
    <div id="delBox"></div>
  </div>
  <div class="modal-f">${S.admin?`<button class="btn danger" data-act="del" data-pid="${p.id}">ลบโครงการ</button><button class="btn primary" data-act="edit" data-pid="${p.id}">แก้ไขข้อมูล</button>`:`<span class="note" style="margin-right:auto">ผู้ดูแลระบบเท่านั้นที่แก้ไขข้อมูลได้</span>`}<button class="btn" data-act="close">ปิด</button></div>`);
}
function openForm(mode, data={}, sub=null){
  // mode: new | edit | review
  const d = Object.assign({sb:'', s:'', F:'', S:'', title:'', detail:'', tambons:[], agency:'', budget:'', yearStart:'', yearEnd:'', status:'', note:'', ref:'', proposer:'', proposerOrg:'', proposerContact:''}, data);
  const title = mode==='new' ? 'เสนอแนวทาง/โครงการใหม่' : mode==='edit' ? `แก้ไขโครงการ ${d.id}` : 'ตรวจและแก้ไขก่อนอนุมัติ';
  modal(`<div class="modal-h"><div><h2>${title}</h2>${mode==='new'?'<div class="note">ผู้ดูแลระบบจะตรวจสอบก่อนแสดงในระบบ</div>':''}</div><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <form id="pform" class="modal-b" novalidate>
    ${mode!=='edit'?`<div class="formsec">ผู้เสนอ</div><div class="form-grid">
      <div class="fld"><label class="req" for="ff_proposer">ชื่อ–นามสกุล</label><input id="ff_proposer" value="${esc(d.proposer)}" ${mode==='review'?'readonly':''}></div>
      <div class="fld"><label class="req" for="ff_proposerOrg">หน่วยงาน</label><input id="ff_proposerOrg" value="${esc(d.proposerOrg)}" ${mode==='review'?'readonly':''}></div>
      <div class="fld full"><label for="ff_proposerContact">อีเมลหรือโทรศัพท์</label><input id="ff_proposerContact" value="${esc(d.proposerContact)}" ${mode==='review'?'readonly':''}></div></div>`:''}
    <div class="formsec">ตำแหน่งในแผนแม่บท</div><div class="form-grid">
      <div class="fld full"><label class="req" for="ff_sb">ลุ่มน้ำสาขา (ลุ่มน้ำปิง)</label><select id="ff_sb"><option value="">เลือกลุ่มน้ำสาขา</option>${M.basins.map(b=>`<option ${d.sb===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="fld full"><label class="req" for="ff_s">ยุทธศาสตร์</label><select id="ff_s"><option value="">เลือกยุทธศาสตร์</option>${M.strategies.map(s=>`<option value="${s.n}" ${+d.s===s.n?'selected':''}>ยุทธศาสตร์ที่ ${s.n} ${esc(s.short)}</option>`).join('')}</select></div>
      <div class="fld"><label class="req" for="ff_F">แผนงานหลัก</label><select id="ff_F"></select></div>
      <div class="fld"><label class="req" for="ff_S">มาตรการเชิงยุทธศาสตร์</label><select id="ff_S"></select></div>
      <div class="fld full note" id="ff_Sdesc"></div>
    </div>
    <div class="formsec">รายละเอียดแนวทาง/โครงการ</div><div class="form-grid">
      <div class="fld full"><label class="req" for="ff_title">ชื่อแนวทาง/โครงการ</label><input id="ff_title" maxlength="300" value="${esc(d.title)}"></div>
      <div class="fld full"><label for="ff_detail">รายละเอียดเพิ่มเติม</label><textarea id="ff_detail" rows="3" maxlength="3000">${esc(d.detail)}</textarea></div>
      <div class="fld full"><span class="lbl">ตำบลเป้าหมาย <span class="note">(แสดงเฉพาะตำบลในลุ่มน้ำสาขาที่เลือก · ★ = มีปัญหาตามยุทธศาสตร์ที่เลือก)</span></span>
        <label class="chip" style="align-self:start;margin:4px 0"><input type="checkbox" id="ff_none" ${mode!=='new'&&!(d.tambons||[]).length?'checked':''}> ไม่มีตำบลเป้าหมาย (แนวทางระดับลุ่มน้ำสาขา)</label>
        <div class="tam-pick" id="ff_tams"></div><div class="note" id="ff_grp"></div></div>
    </div>
    <div class="formsec">ข้อมูลประกอบ</div><div class="form-grid">
      <div class="fld"><label for="ff_agency">หน่วยงานรับผิดชอบ</label><input id="ff_agency" value="${esc(d.agency)}"></div>
      <div class="fld"><label for="ff_budget">งบประมาณ (ล้านบาท)</label><input id="ff_budget" type="number" min="0" step="0.01" value="${esc(d.budget??'')}"></div>
      <div class="fld"><label for="ff_yearStart">ปีเริ่ม (พ.ศ.)</label><input id="ff_yearStart" type="number" min="2560" max="2600" value="${esc(d.yearStart??'')}"></div>
      <div class="fld"><label for="ff_yearEnd">ปีสิ้นสุด (พ.ศ.)</label><input id="ff_yearEnd" type="number" min="2560" max="2600" value="${esc(d.yearEnd??'')}"></div>
      <div class="fld"><label for="ff_status">สถานะ</label><select id="ff_status"><option value="">ไม่ระบุ</option>${STATUS_OPTS.map(o=>`<option ${d.status===o?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="fld"><label for="ff_ref">ตารางอ้างอิง</label><input id="ff_ref" value="${esc(d.ref)}" placeholder="เช่น 13-11"></div>
      <div class="fld full"><label for="ff_note">หมายเหตุ</label><input id="ff_note" value="${esc(d.note)}"></div>
    </div>
    <div class="err" id="ff_err" role="alert"></div>
  </form>
  <div class="modal-f"><button class="btn" data-act="close">ยกเลิก</button><button class="btn ${mode==='new'?'pink':'primary'}" id="ff_save">${mode==='new'?'ส่งให้ผู้ดูแลพิจารณา':mode==='edit'?'บันทึกการแก้ไข':'อนุมัติและบันทึกลงระบบ'}</button></div>`);
  let picked = new Set(d.tambons||[]);
  const fillF = ()=>{ const s=+$('#ff_s').value; const opts=M.programmes.filter(p=>p.s===s); $('#ff_F').innerHTML = `<option value="">เลือก</option>`+opts.map(p=>`<option value="${p.code}" ${d.F===p.code?'selected':''}>${p.code} ${esc(p.name)}</option>`).join(''); fillS(); };
  const fillS = ()=>{ const s=+$('#ff_s').value, F=$('#ff_F').value; const opts=M.measures.filter(m=>m.s===s && (!F||m.F.includes(F))); $('#ff_S').innerHTML = `<option value="">เลือก</option>`+opts.map(m=>`<option value="${m.code}" ${d.S===m.code?'selected':''}>${m.code} ${esc(m.name)}</option>`).join(''); descS(); };
  const descS = ()=>{ const m=MEAS[$('#ff_S').value]; $('#ff_Sdesc').textContent = m ? `${m.desc||''} · กลุ่มพื้นที่เป้าหมาย: ${m.groups||'-'}` : ''; };
  const fillT = ()=>{
    const sb=$('#ff_sb').value, s=+$('#ff_s').value, none=$('#ff_none').checked;
    const box=$('#ff_tams');
    if(!sb){ box.innerHTML='<div class="note" style="padding:6px 10px">เลือกลุ่มน้ำสาขาก่อน</div>'; grpShow(); return; }
    const ts = tamInBasinAll(sb).sort((a,b)=>(b.strat.includes(s)-a.strat.includes(s))||(b.target-a.target)||a.t.localeCompare(b.t,'th'));
    box.innerHTML = ts.map(t=>`<label><input type="checkbox" value="${t.id}" ${picked.has(t.id)?'checked':''} ${none?'disabled':''}> ${t.strat.includes(s)?'★ ':''}ต.${esc(t.t)} อ.${esc(t.a)} จ.${esc(t.p)} ${t.target?'<span class="pill tg">เป้าหมาย</span>':''}</label>`).join('');
    grpShow();
  };
  const grpShow = ()=>{ const g=new Set(); if(!$('#ff_none').checked) picked.forEach(id=>(T[id]?.grp||[]).forEach(c=>g.add(c))); $('#ff_grp').textContent = g.size ? 'กลุ่มพื้นที่ (คำนวณจากตำบลที่เลือก): '+[...g].sort().join(', ') : ''; };
  $('#ff_s').onchange = ()=>{ d.F=''; d.S=''; fillF(); fillT(); };
  $('#ff_F').onchange = ()=>{ d.S=''; fillS(); };
  $('#ff_S').onchange = descS;
  $('#ff_sb').onchange = ()=>{ const sb=$('#ff_sb').value; picked = new Set([...picked].filter(id=>T[id]?.sb.includes(sb))); fillT(); };
  $('#ff_none').onchange = fillT;
  $('#ff_tams').addEventListener('change', e=>{ if(e.target.type==='checkbox'){ e.target.checked?picked.add(e.target.value):picked.delete(e.target.value); grpShow(); } });
  fillF(); fillT();
  $('#ff_save').onclick = async ()=>{
    const v = id=>($('#ff_'+id)?.value||'').trim();
    const rec = {sb:v('sb'), s:+v('s')||null, F:v('F'), S:v('S'), title:v('title'), detail:v('detail'),
      tambons: $('#ff_none').checked ? [] : [...picked], agency:v('agency'), budget: v('budget')===''?null:+v('budget'),
      yearStart: v('yearStart')===''?null:+v('yearStart'), yearEnd: v('yearEnd')===''?null:+v('yearEnd'), status:v('status'), note:v('note'), ref:v('ref')};
    const miss = [];
    if(mode==='new'){ if(!v('proposer')) miss.push('ชื่อผู้เสนอ'); if(!v('proposerOrg')) miss.push('หน่วยงานผู้เสนอ'); }
    if(!rec.sb) miss.push('ลุ่มน้ำสาขา'); if(!rec.s) miss.push('ยุทธศาสตร์'); if(!rec.F) miss.push('แผนงานหลัก'); if(!rec.S) miss.push('มาตรการ');
    if(rec.title.length<5) miss.push('ชื่อแนวทาง/โครงการ (อย่างน้อย 5 ตัวอักษร)');
    if(!$('#ff_none').checked && !rec.tambons.length) miss.push('ตำบลเป้าหมาย หรือเลือก "ไม่มีตำบลเป้าหมาย"');
    if(rec.yearStart && rec.yearEnd && rec.yearEnd<rec.yearStart) miss.push('ปีสิ้นสุดต้องไม่น้อยกว่าปีเริ่ม');
    if(miss.length){ $('#ff_err').textContent = 'กรุณากรอก: '+miss.join(', '); return; }
    const btn = $('#ff_save'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try{
      if(mode==='new'){ await Store.submit(Object.assign(rec, {proposer:v('proposer'), proposerOrg:v('proposerOrg'), proposerContact:v('proposerContact')})); closeModal(); toast('ส่งโครงการแล้ว รอผู้ดูแลระบบพิจารณา'); }
      else if(mode==='edit'){ await Store.saveProject(d.id, rec); closeModal(); toast('บันทึกการแก้ไขแล้ว'); }
      else { const id = await Store.approve(sub, rec); closeModal(); toast(`อนุมัติแล้ว บันทึกเป็นโครงการ ${id}`); }
    }catch(e){ console.error(e); $('#ff_err').textContent = 'บันทึกไม่สำเร็จ: '+(e.message||e); btn.disabled=false; btn.textContent='ลองอีกครั้ง'; }
  };
}
function openLogin(start){ openWelcome(start||'admin'); }
function openWelcome(start){
  const ss = Sess.get() || {};
  const fb = Store.mode==='firebase';
  const locked = !ss.role;
  modal(`<div class="modal-h"><div><h2>เข้าใช้งานระบบ</h2><div class="note">โครงการศึกษาจัดทำแผนแม่บทการบริหารจัดการทรัพยากรน้ำในเขตลุ่มน้ำปิง ปรับปรุงช่วงที่ 1 (พ.ศ. 2566-2580)</div></div>${locked?'':'<button class="x" data-act="close" aria-label="ปิด">×</button>'}</div>
  <div class="modal-b">
    <div class="role-pick" role="tablist">
      <button type="button" class="role-b" data-act="enteruser"><b>ผู้ใช้ทั่วไป</b><span>ดูข้อมูล ค้นหา และเสนอโครงการ กดเพื่อเข้าใช้งานได้ทันที</span></button>
      <button type="button" class="role-b" data-act="role" data-v="admin" aria-pressed="${start==='admin'}"><b>ผู้ดูแลระบบ</b><span>อนุมัติ แก้ไข และลบโครงการ ต้องใช้รหัสผู้ดูแล</span></button>
    </div>
    <form id="wf_admin" class="stack" ${start==='admin'?'':'hidden'}>
      ${fb && !CFG.adminEmail ? `<div class="fld"><label for="lg_email">อีเมลผู้ดูแล</label><input id="lg_email" type="email" autocomplete="username"></div>` : ''}
      <div class="fld"><label for="lg_pass">รหัสผู้ดูแลระบบ</label><input id="lg_pass" type="password" autocomplete="current-password"></div>
      <label class="remember"><input type="checkbox" id="lg_rem" checked> จดจำในเครื่องนี้ (${SESSION_DAYS} วัน) · ไม่ควรเลือกถ้าเป็นเครื่องสาธารณะ</label>
      <div class="err" id="lg_err" role="alert"></div>
      <button class="btn pink" type="submit">เข้าสู่ระบบผู้ดูแล</button>
      ${fb && !CFG.adminEmail ? '<button class="linkbtn" type="button" data-act="forgot">ลืมรหัสผ่าน ส่งลิงก์ตั้งรหัสใหม่ทางอีเมล</button>' : ''}
    </form>
  </div>`, 'center welcome', locked);
  $('#wf_admin').onsubmit = async e=>{ e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try{
      const rem = $('#lg_rem').checked;
      await Store.login($('#lg_email')?.value.trim(), $('#lg_pass').value, rem);
      Sess.set({role:'admin'}, rem);
      closeModal(); renderHeader(); toast('เข้าสู่ระบบผู้ดูแลแล้ว');
    }catch(err){ btn.disabled=false; const code=(err.code||'')+' '+(err.message||''); $('#lg_err').textContent = /too-many-requests/i.test(code) ? 'ใส่รหัสผิดหลายครั้ง ระบบพักการเข้าสู่ระบบชั่วคราว ลองใหม่ในอีกไม่กี่นาที' : /network-request-failed/i.test(code) ? 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่' : /user-not-found|user-disabled/i.test(code) ? 'ไม่พบบัญชีผู้ดูแล หรือบัญชีถูกปิดใช้งาน' : /invalid|wrong|password|credential|ไม่ถูกต้อง/i.test(code) ? 'รหัสผู้ดูแลไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ: '+(err.message||''); $('#lg_pass').select(); }
  };
}
function exportXlsx(list, name){
  if(!window.XLSX){ toast('ยังโหลดตัวส่งออกไม่เสร็จ ลองใหม่อีกครั้ง'); return; }
  list = list || filt(P);
  const rows = list.map(p=>{ const L = projLoc(p); const G = projGrpList(p); return {
    'รหัส':p.id,'ยุทธศาสตร์':`${p.s} ${STRAT[p.s]?.short||''}`,'แผนงาน':`${p.F} ${PROG[p.F]?.name||''}`,'มาตรการ':`${p.S} ${MEAS[p.S]?.name||''}`,
    'แนวทาง/โครงการ':p.title,'รายละเอียด':p.detail,'ลุ่มน้ำสาขา':p.sb,
    'จังหวัด':L.prov.join(', '),'อำเภอ':L.amp.join(', '),'ตำบล':L.tam.join(', ')||'ไม่มีตำบลเป้าหมาย (ระดับลุ่มน้ำ)',
    'ตำบลเป้าหมาย (เต็ม)':L.ts.map(tamName).join(', '),
    'กลุ่มพื้นที่':G.codes.join(', '),'คำอธิบายกลุ่มพื้นที่':G.codes.map(c=>`${c} ${M.groups[c]||''}`).join('; '),'ที่มากลุ่มพื้นที่':G.codes.length?(G.fromMeasure?'ตามมาตรการ':'ตามตำบลเป้าหมาย'):'',
    'หน่วยงานรับผิดชอบ':p.agency,'งบประมาณ (ล้านบาท)':p.budget,'ปีเริ่ม (พ.ศ.)':p.yearStart,'ปีสิ้นสุด (พ.ศ.)':p.yearEnd,'สถานะ':p.status,'หมายเหตุ':p.note,
    }; });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [8,22,30,40,60,50,22,16,20,30,50,18,40,16,22,14,10,10,16,24].map(w=>({wch:w}));
  ws['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:rows.length, c:Object.keys(rows[0]||{a:1}).length-1}})};
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'โครงการ');
  const fn = ('โครงการ_' + String(name||'ลุ่มน้ำปิง').replace(/^โครงการ(ที่ลง|ใน)?\s*/,'')).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,'_').slice(0,90);
  XLSX.writeFile(wb, fn + '.xlsx');
  toast(`ดาวน์โหลด ${fmt(rows.length)} รายการแล้ว`);
}

/* ================= ROUTING & EVENTS ================= */
function setTab(t){ S.tab=t; $$('.tab').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===t)); try{ history.replaceState(null,'','#'+t); }catch(e){} renderFilters(); renderView(); }
function renderView(){
  if(!M) return;
  $('#filters').hidden = S.tab==='admin';
  if(S.tab==='area') renderArea(); else if(S.tab==='basin') renderBasin(); else if(S.tab==='map') renderMap(); else renderAdmin();
}
function onData(){ buildIndex(); renderKPIs(); renderFilters(); renderHeader(); renderView(); }
function bind(){
  document.addEventListener('click', async e=>{
    const pr = e.target.closest('[data-pid]:not([data-act])'); if(pr){ openProject(pr.dataset.pid); return; }
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act, v = a.dataset.v;
    const sub = ()=>SUBS.find(s=>s._id===a.dataset.sid);
    switch(act){
      case 'close': closeModal(); break;
      case 'goprov': S.prov=v||null; S.amp=null; S.tam=null; renderFilters(); renderView(); break;
      case 'goamp': S.amp=v; S.tam=null; renderFilters(); renderView(); break;
      case 'gotam': S.tam=v; renderFilters(); renderView(); break;
      case 'gotamfull': { const t=T[v]; S.prov=t.p; S.amp=t.a; S.tam=v; closeModal(); setTab('area'); window.scrollTo({top:0}); break; }
      case 'up': if(S.tam) S.tam=null; else if(S.amp) S.amp=null; else S.prov=null; renderFilters(); renderView(); break;
      case 'gobasin': S.basin=v||null; S.bprov=S.bamp=S.btam=null; closeModal(); setTab('basin'); window.scrollTo({top:0}); break;
      case 'maptam': { const t=T[v]; mapSel=v; Object.assign(MS,{kind:'admin',prov:t.p,amp:t.a,tam:v}); setTab('map'); if(MAP){ $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='admin')); afterScope(); } break; }
      case 'mapbasin': Object.assign(MS,{kind:'basin',basin:v}); setTab('map'); if(MAP){ $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='basin')); afterScope(); } break;
      case 'mapunsel': mapSel=null; MAP && MAP.closePopup(); restyle(); $('#mapSide').innerHTML='<div class="panel-h"><h3>ข้อมูลตำบล</h3></div><div style="padding:14px" class="note">คลิกตำบลบนแผนที่เพื่อดูข้อมูลพื้นที่</div>'; mapProjects(); break;
      case 'mapgoproj': $('#mapProj')?.scrollIntoView({behavior:'smooth'}); break;
      case 'keyf': { const pnl=$('#keyfPanel'); const open = a.getAttribute('aria-expanded')==='true';
        $$('.keyf-c').forEach(c=>c.setAttribute('aria-expanded','false'));
        if(open){ pnl.hidden=true; break; }
        a.setAttribute('aria-expanded','true'); pnl.innerHTML = $('#keyfData').content.querySelector(`[data-k="${v}"]`).outerHTML; pnl.hidden=false; break; }
      case 'keyfall': { const pnl=$('#keyfPanel'); const showing = pnl.dataset.all==='1' && !pnl.hidden;
        $$('.keyf-c').forEach(c=>c.setAttribute('aria-expanded', showing?'false':'true'));
        if(showing){ pnl.hidden=true; pnl.dataset.all=''; a.textContent='แสดงทั้งหมด'; break; }
        pnl.innerHTML = `<div class="keyf">${$('#keyfData').innerHTML}</div>`; pnl.dataset.all='1'; pnl.hidden=false; a.textContent='ซ่อน'; break; }
      case 'mkind': if(MS.kind!==v){ MS.prov=''; MS.amp=''; MS.tam=''; mapSel=null; } MS.kind=v; $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===v)); afterScope(); break;
      case 'clr': { if(v==='__strat'){ S.f.s.clear(); renderFilters(); renderView(); break; }
        const el2 = document.getElementById(v); if(!el2) break;
        el2.value = '';
        if(el2.tagName==='INPUT'){ S.f.q=''; renderFilters(); renderView(); }
        else el2.dispatchEvent(new Event('change', {bubbles:true}));
        break; }
      case 'morefilt': S.moreOpen=!S.moreOpen; renderFilters(); break;
      case 'fsall': S.f.s.clear(); S.f.F=''; S.f.S=''; renderFilters(); renderView(); break;
      case 'more': { TABLES[a.dataset.key].n += PAGE*2; a.closest('[data-table]').innerHTML = tableInner(a.dataset.key); break; }
      case 'fs': { const n=+a.dataset.n; S.f.s.has(n)?S.f.s.delete(n):S.f.s.add(n); S.f.F=''; S.f.S=''; renderFilters(); renderView(); break; }
      case 'clear': S.f={q:'',s:new Set(),F:'',S:'',grp:'',src:''}; renderFilters(); renderView(); break;
      case 'newproj': { const d={}; if(a.dataset.tam){ const t=T[a.dataset.tam]; d.sb=t.sb[0]||''; d.tambons=[t.id]; } if(a.dataset.sb) d.sb=a.dataset.sb; openForm('new', d); break; }
      case 'edit': openForm('edit', P.find(p=>p.id===a.dataset.pid)); break;
      case 'del': $('#delBox').innerHTML = `<div class="confirm-box"><span>ลบโครงการ ${esc(a.dataset.pid)} ออกจากระบบถาวร?</span><button class="btn sm danger" data-act="delok" data-v="${esc(a.dataset.pid)}">ยืนยันลบ</button><button class="btn sm" data-act="delno">ยกเลิก</button></div>`; break;
      case 'delno': $('#delBox').innerHTML=''; break;
      case 'delok': try{ await Store.deleteProject(v); closeModal(); toast('ลบโครงการแล้ว'); }catch(err){ toast('ลบไม่สำเร็จ: '+err.message); } break;
      case 'login': openLogin(); break;
      case 'auth': { if(S.admin||S.user){ await Store.logout(); Sess.set({role:'user'}, true); renderHeader(); toast('ออกจากระบบผู้ดูแลแล้ว ใช้งานต่อในฐานะผู้ใช้ทั่วไป'); } else openWelcome('admin'); break; }
      case 'role': { $$('.role-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='admin')); $('#wf_admin').hidden=false; $('#lg_pass').focus(); break; }
      case 'enteruser': { if(S.admin) await Store.logout(); Sess.set({role:'user'}, true); closeModal(); renderHeader(); toast('เข้าใช้งานในฐานะผู้ใช้ทั่วไป'); break; }
      case 'forgot': { const em=$('#lg_email').value.trim(); if(!em){ $('#lg_err').textContent='กรอกอีเมลก่อน'; break; } try{ await Store.resetPassword(em); $('#lg_err').textContent='ส่งลิงก์ไปที่อีเมลแล้ว'; }catch(err){ $('#lg_err').textContent=err.message; } break; }
      case 'approve': { const s=sub(); a.disabled=true; try{ const id=await Store.approve(s, s); toast(`อนุมัติแล้ว บันทึกเป็นโครงการ ${id}`); }catch(err){ a.disabled=false; toast('อนุมัติไม่สำเร็จ: '+err.message); } break; }
      case 'review': { const s=sub(); openForm('review', s, s); break; }
      case 'reject': a.closest('.sub-card').querySelector('.rej').hidden=false; break;
      case 'rejectno': a.closest('.rej').hidden=true; break;
      case 'rejectok': { const s=sub(); try{ await Store.reject(s, $('#rr_'+CSS.escape(s._id)).value.trim()); toast('บันทึกว่าไม่อนุมัติแล้ว'); }catch(err){ toast('ไม่สำเร็จ: '+err.message); } break; }
      case 'seed': { a.disabled=true; try{ await Store.seed((n,t)=>{ const el=$('#seedProg'); if(el) el.textContent=`นำเข้าแล้ว ${n}/${t}`; }); toast('นำเข้าข้อมูลตั้งต้นแล้ว'); }catch(err){ a.disabled=false; toast('นำเข้าไม่สำเร็จ: '+err.message); } break; }
      case 'export': exportXlsx(); break;
      case 'xls': { const T0=TABLES[a.dataset.key]; exportXlsx(T0.list, T0.opts.name); break; }
      case 'demoreset': $('#resetBox').innerHTML = `<div class="confirm-box" style="margin-top:8px"><span>ล้างโครงการที่เพิ่ม/แก้ไขในโหมดทดลองทั้งหมด?</span><button class="btn sm danger" data-act="demoresetok">ยืนยัน</button><button class="btn sm" data-act="demoresetno">ยกเลิก</button></div>`; break;
      case 'demoresetno': $('#resetBox').innerHTML=''; break;
      case 'demoresetok': ['ping_overrides','ping_subs','ping_audit'].forEach(k=>{ try{localStorage.removeItem(k);}catch(e){} }); Store.initDemo(); toast('ล้างข้อมูลทดลองแล้ว'); break;
    }
  });
  document.addEventListener('toggle', e=>{ if(e.target.classList && e.target.classList.contains('statsbox')) S.statsOpen = e.target.open; }, true);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !$('#modalBg')?.dataset.locked) closeModal(); });
  $$('.tab').forEach(b=>b.onclick = ()=>setTab(b.dataset.tab));
  $('#newBtn').onclick = ()=>openForm('new');
  $('#authBtn').dataset.act = 'auth';
  let qt;
  $('#filters').addEventListener('input', e=>{
    if(e.target.id==='fq'){ clearTimeout(qt); qt=setTimeout(()=>{ S.f.q=e.target.value.trim(); renderView(); const fc=$('.fcount'); if(fc){ const pos=e.target.selectionStart; renderFilters(); const q=$('#fq'); q.focus(); q.setSelectionRange(pos,pos);} }, 250); }
  });
  $('#filters').addEventListener('change', e=>{
    const id=e.target.id; if(id==='fq') return;
    if(id==='fLp'){ S.prov=e.target.value||null; S.amp=null; S.tam=null; }
    if(id==='fLa'){ S.amp=e.target.value||null; S.tam=null; }
    if(id==='fLt'){ S.tam=e.target.value||null; }
    if(id==='fLb'){ S.basin=e.target.value||null; S.bprov=S.bamp=S.btam=null; }
    if(id==='fBp'){ S.bprov=e.target.value||null; S.bamp=S.btam=null; }
    if(id==='fBa'){ S.bamp=e.target.value||null; S.btam=null; }
    if(id==='fBt'){ S.btam=e.target.value||null; }
    if(id==='fF'){ S.f.F=e.target.value; S.f.S=''; } if(id==='fS') S.f.S=e.target.value; if(id==='fG') S.f.grp=e.target.value;
    renderFilters(); renderView();
  });
}

/* ================= BOOT ================= */
async function boot(){
  bind();
  try{
    const [m, seed] = await Promise.all([fetch(DATA+'master.json').then(r=>r.json()), fetch(DATA+'projects_seed.json').then(r=>r.json())]);
    M = m; SEED = seed;
    M.tambons.forEach(t=>T[t.id]=t);
    M.measures.forEach(x=>MEAS[x.code]=x); M.programmes.forEach(x=>PROG[x.code]=x); M.strategies.forEach(x=>STRAT[x.n]=x); M.basins.forEach(x=>BAS[x.name]=x);
  }catch(e){ $('#view').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ (${esc(e.message)}) ตรวจว่าโฟลเดอร์ data อยู่ข้างไฟล์ index.html</div>`; return; }
  const h = (location.hash||'').slice(1); if(['area','basin','map','admin'].includes(h)) S.tab=h;
  $$('.tab').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===S.tab));
  await Store.init();
  const ss = Sess.get();
  if(!ss) openWelcome();
  else if(ss.role==='admin' && Store.mode==='firebase'){ setTimeout(()=>{ if(!S.admin && !Store.auth.currentUser){ Sess.clear(); openWelcome('admin'); } }, 2500); }
}
/* ปรับขนาดชื่อระบบให้พอดีบรรทัดเดียวตามฟอนต์จริงที่โหลด */
function fitTitle(){
  const h = document.querySelector('.brand h1'); if(!h) return;
  h.style.fontSize = '';
  let size = parseFloat(getComputedStyle(h).fontSize);
  const max = 38; size = Math.min(max, size * (h.clientWidth / Math.max(1, h.scrollWidth)) * 1.15);
  h.style.fontSize = size + 'px';
  let guard = 40;
  while(h.scrollWidth > h.clientWidth + 1 && guard-- > 0){ size -= 0.5; h.style.fontSize = size + 'px'; }
}
let fitT; window.addEventListener('resize', ()=>{ clearTimeout(fitT); fitT = setTimeout(fitTitle, 80); });
if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
window.addEventListener('load', fitTitle);
setTimeout(fitTitle, 50); setTimeout(fitTitle, 1200); setTimeout(fitTitle, 3500);
if(window.ResizeObserver){ const ro = new ResizeObserver(()=>{ clearTimeout(fitT); fitT = setTimeout(fitTitle, 60); }); document.addEventListener('DOMContentLoaded', ()=>{ const b=document.querySelector('.brand'); if(b) ro.observe(b); }); const b0=document.querySelector('.brand'); if(b0) ro.observe(b0); }
document.readyState==='loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
