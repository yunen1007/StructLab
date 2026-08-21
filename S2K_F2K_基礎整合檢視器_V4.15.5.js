// v2.3.6: 停用 F12 開發者工具快捷鍵；首頁鎖右鍵選單(僅限首頁，模型畫面右鍵為攝影機平移功能，不受影響)。
document.addEventListener('keydown', function(e){
  if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); }
});
document.getElementById('drop-screen').addEventListener('contextmenu', function(e){
  e.preventDefault();
});

/* ===== 主程式（原 type="module"） ===== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ════════ S2K PARSER (v27 表格式) ════════ */
function parseS2K(text){
  const raw = text.split(/\r?\n/);
  const lines=[]; let buf='';
  for(const l of raw){
    const t=l.replace(/\s+$/,'');
    if(/ _$/.test(t)) buf += t.slice(0,-1);
    else { lines.push(buf+t); buf=''; }
  }
  if(buf) lines.push(buf);
  const tables={}; let cur=null;
  for(const l0 of lines){
    const line=l0.trim();
    if(!line) continue;
    if(/^TABLE:/i.test(line)){
      const m=line.match(/TABLE:\s*"([^"]+)"/i);
      cur=m?(tables[m[1]]=tables[m[1]]||[]):null; continue;
    }
    if(/^END TABLE DATA/i.test(line)){cur=null;continue;}
    if(!cur) continue;
    const rec={}; const rx=/([A-Za-z0-9_#$.\-]+)=(?:"([^"]*)"|(\S+))/g; let m;
    while((m=rx.exec(line))) rec[m[1]]=m[2]!==undefined?m[2]:m[3];
    if(Object.keys(rec).length) cur.push(rec);
  }
  return tables;
}

function buildModel(T){
  const m={joints:{},frames:[],areas:[],sections:{},areaSections:{},restraints:{},releases:{},
           frameLoads:[],areaLoads:[],loadPats:[],grids:[],constraints:{},overwrites:{},steelPrefs:{},owCode:'',units:'',version:'',materials:{}};
  const pc=(T['PROGRAM CONTROL']||[])[0]||{};
  m.units=pc.CurrUnits||''; m.version=(pc.ProgramName||'')+' '+(pc.Version||'');
  const z0=v=>Object.is(v,-0)?0:v;
  for(const r of T['JOINT COORDINATES']||[]) m.joints[r.Joint]={id:r.Joint,
    x:z0(+(r.GlobalX??r.XorR??0)), y:z0(+(r.GlobalY??r.Y??0)), z:z0(+(r.GlobalZ??r.Z??0))};
  for(const r of T['CONNECTIVITY - FRAME']||[]) m.frames.push({id:r.Frame,i:r.JointI,j:r.JointJ,len:+r.Length||0,sect:null,angle:0,groups:[]});
  for(const r of T['CONNECTIVITY - AREA']||[]){const js=[];for(let k=1;k<=9;k++) if(r['Joint'+k])js.push(r['Joint'+k]); m.areas.push({id:r.Area,joints:js,sect:null});}
  for(const r of T['FRAME SECTION PROPERTIES 01 - GENERAL']||[]) m.sections[r.SectionName]={name:r.SectionName,mat:r.Material,shape:r.Shape||'Rectangular',
    t3:+r.t3||0.3,t2:+r.t2||0.3,tf:+r.tf||0,tw:+r.tw||0,t2b:+(r.t2b??r.t2)||0,tfb:+(r.tfb??r.tf)||0,z33:+r.Z33||0,z22:+r.Z22||0,area:+r.Area||0};
  for(const r of T['AREA SECTION PROPERTIES']||[]) m.areaSections[r.Section]={name:r.Section,mat:r.Material,th:+r.Thickness||0.1,type:r.AreaType||''};
  const fmap={}; m.frames.forEach(f=>fmap[f.id]=f);
  const amap={}; m.areas.forEach(a=>amap[a.id]=a);
  for(const r of T['FRAME SECTION ASSIGNMENTS']||[]){const f=fmap[r.Frame]; if(f){f.sect=r.AnalSect||r.DesignSect||null; f.designSect=r.DesignSect||r.AnalSect||null;}}
  for(const r of T['AREA SECTION ASSIGNMENTS']||[]){const a=amap[r.Area]; if(a) a.sect=r.Section||null;}
  for(const r of T['FRAME LOCAL AXES ASSIGNMENTS 1 - TYPICAL']||[]){const f=fmap[r.Frame]; if(f) f.angle=+r.Angle||0;}
  for(const r of T['JOINT RESTRAINT ASSIGNMENTS']||[]) m.restraints[r.Joint]=[r.U1,r.U2,r.U3,r.R1,r.R2,r.R3].map(v=>v==='Yes');
  for(const r of T['FRAME RELEASE ASSIGNMENTS 1 - GENERAL']||[]) m.releases[r.Frame]={mi:r.M2I==='Yes'||r.M3I==='Yes',mj:r.M2J==='Yes'||r.M3J==='Yes',raw:r};
  /* v9 匯出的載重表欄位叫 LoadCase(無獨立 LoadPat 概念)，故 fallback */
  for(const r of T['FRAME LOADS - DISTRIBUTED']||[]) m.frameLoads.push({
    frame:r.Frame,pat:r.LoadPat??r.LoadCase,dir:r.Dir||'Gravity',distType:r.DistType||'RelDist',
    a:+(r.RelDistA??0),b:+(r.RelDistB??1),absA:+(r.AbsDistA??0),absB:+(r.AbsDistB??0),
    va:+r.FOverLA||0,vb:+r.FOverLB||0
  });
  for(const r of T['AREA LOADS - UNIFORM TO FRAME']||[]) m.areaLoads.push({area:r.Area,pat:r.LoadPat??r.LoadCase,dir:r.Dir||'Gravity',v:+r.UnifLoad||0,dist:r.DistType||''});
  for(const r of T['AREA LOADS - UNIFORM']||[]) m.areaLoads.push({area:r.Area,pat:r.LoadPat??r.LoadCase,dir:r.Dir||'Gravity',v:+r.UnifLoad||0,dist:''});
  for(const r of T['LOAD PATTERN DEFINITIONS']||[]) m.loadPats.push({name:r.LoadPat,type:r.DesignType||'',selfWtMult:+r.SelfWtMult||0});
  for(const r of T['GRID LINES']||[]) m.grids.push({dir:r.AxisDir,id:r.GridID,c:+r.XRYZCoord||0});
  for(const r of T['GROUPS 2 - ASSIGNMENTS']||[]){ if(r.ObjectType==='Frame'){const f=fmap[r.ObjectLabel]; if(f) f.groups.push(r.GroupName);} }
  for(const r of T['JOINT CONSTRAINT ASSIGNMENTS']||[]) (m.constraints[r.Joint]=m.constraints[r.Joint]||[]).push(r.Constraint);
  for(const k of Object.keys(T)) if(k.startsWith('OVERWRITES - STEEL DESIGN')){
    m.owCode=k.replace('OVERWRITES - STEEL DESIGN - ','');
    for(const r of T[k]) m.overwrites[r.Frame]=r;
  }
  for(const k of Object.keys(T)) if(k.startsWith('PREFERENCES - STEEL DESIGN')) m.steelPrefs=T[k][0]||{};
  /* v2.4.2：桿件自重試算所需材料單位重(tf/m³)，來自「02 - BASIC MECHANICAL PROPERTIES」之 UnitWeight；與下方 fy/fu 合併寫入(Object.assign)避免互相覆蓋 */
  for(const r of T['MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES']||[]) m.materials[r.Material]=Object.assign(m.materials[r.Material]||{},{unitWt:+r.UnitWeight||0});
  /* v2.0.0：SAP2000 v9 匯出的鋼材降伏強度表叫「03 - DESIGN STEEL」(無「A」)，欄位(Material/Fy/Fu)與 v27+ 的「03A - STEEL DATA」相同，故 fallback 讀取 */
  for(const r of T['MATERIAL PROPERTIES 03A - STEEL DATA']||T['MATERIAL PROPERTIES 03 - DESIGN STEEL']||[]) m.materials[r.Material]=Object.assign(m.materials[r.Material]||{},{fy:+r.Fy||0,fu:+r.Fu||0});
  /* v9 沒有「LOAD PATTERN DEFINITIONS」表(該版尚無獨立 Load Pattern 概念，也沒有 DesignType)，
     改由實際出現的 LoadCase 值推回選單，並用常見命名慣例猜 type 以恢復 Dead/Live/Wind/Quake 上色區分(猜不出時維持空字串走預設色，不影響既有行為) */
  if(!m.loadPats.length){
    const seen=new Set();
    for(const l of m.frameLoads) if(l.pat) seen.add(l.pat);
    for(const l of m.areaLoads) if(l.pat) seen.add(l.pat);
    const guessType=name=>{
      const n=(name||'').toUpperCase();
      if(n.includes('DEAD')||/^DL\d*$/.test(n)||n==='D') return 'Dead';
      if(n.includes('LIVE')||/^LL\d*$/.test(n)||n==='L') return 'Live';
      if(n.includes('WIND')||/^W[PN]?[XYZ]/.test(n)) return 'Wind';
      if(n.includes('QUAKE')||n.includes('SEIS')||/^EQ/.test(n)) return 'Quake';
      return '';
    };
    for(const p of seen) m.loadPats.push({name:p,type:guessType(p),selfWtMult:0});
  }
  return m;
}

/* ════════ GLOBALS ════════ */
let tables=null, model=null;
let currentS2KText='', currentS2KFileName='';
let scene, camera, renderer, controls;
let gFrames, gAreas, gJoints, gSupports, gGrid, gLoads, gFLabels, gJLabels, gReleases;
let gFoundations=null, foundationState=null;
let pickables=[];
let bbox=null, modelCenter=new THREE.Vector3(), modelRadius=10;
let activeCam=null, orthoCam=null, orthoH=20;
let labelScale=1;
const toThree=(x,y,z)=>new THREE.Vector3(x,z,-y);
const jPos=id=>{const j=model.joints[id]; return j?toThree(j.x,j.y,j.z):null;};

const PALETTE=[0x4da3ff,0xf0a500,0x3ecf8e,0xff6b8a,0xc792ea,0x6be7e0,0xffd866,0xff8c42,0x8aff80,0x7e9cff,0xff7eb6,0xa2e8ab];
const sectColor={}, areaSectColor={};
const sectVisible={}, areaSectVisible={};
const $=id=>document.getElementById(id);

/* V4.15.0：側邊欄改為靜態卡片＋<details> 進階區（不再於執行期重組 DOM）；
   僅保留展開/收合狀態記憶，key 依 data-mem 命名。純顯示用膠水，無業務邏輯。 */
function initSidebarCollapse(){
  document.querySelectorAll('#sidebar details[data-mem]').forEach(d=>{
    const key='s2k-v400-sb-'+d.dataset.mem;
    try{const saved=localStorage.getItem(key); if(saved!==null) d.open=(saved==='1');}catch(_){}
    d.addEventListener('toggle',()=>{try{localStorage.setItem(key,d.open?'1':'0');}catch(_){}});
  });
  initModuleBadges();
}
/* V4.15.0：模組卡狀態 badge —— 純鏡射既有 status 元素文字，不新增任何業務判斷；
   完整狀態文字仍原樣顯示在卡片內，badge 只是視覺摘要。 */
function initModuleBadges(){
  const map=[['foundation-summary','bdg-foundation'],['pm-summary','bdg-pm'],
             ['scwb-status','bdg-scwb'],['pjz-status','bdg-pjz']];
  for(const [srcId,bId] of map){
    const src=document.getElementById(srcId),bdg=document.getElementById(bId);
    if(!src||!bdg) continue;
    const sync=()=>{
      const t=(src.textContent||'').trim();
      const m=t.match(/NG\D*(\d+)/);            /* 對應 "NG 3"／"NG 柱數 0" 兩種既有寫法 */
      let cls='b-idle',label='未執行';
      if(!t||/尚未|無可檢核/.test(t)){cls='b-idle';label='未執行';}
      else if(t.charAt(0)==='✗'){cls='b-ng';label='錯誤';}
      else if(m&&+m[1]>0){cls='b-ng';label='NG '+m[1];}
      else if(m||t.charAt(0)==='✓'){cls='b-ok';label='完成';}
      else{cls='b-live';label='已執行';}
      bdg.className='badge '+cls; bdg.textContent=label;
    };
    new MutationObserver(sync).observe(src,{childList:true,subtree:true,characterData:true});
    sync();
  }
}

/* v2.4.3：側邊欄拖曳調寬 */
(function(){
  const handle=$('sidebar-resize'), sidebar=$('sidebar');
  if(!handle||!sidebar) return;
  let dragging=false;
  handle.addEventListener('pointerdown',e=>{dragging=true;handle.classList.add('dragging');handle.setPointerCapture(e.pointerId);e.preventDefault();});
  handle.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const rect=sidebar.getBoundingClientRect();
    const w=Math.min(560,Math.max(200,e.clientX-rect.left));
    sidebar.style.width=w+'px';
  });
  const stop=()=>{dragging=false;handle.classList.remove('dragging');};
  handle.addEventListener('pointerup',stop);
  handle.addEventListener('pointercancel',stop);
})();

/* ════════ FILE LOAD ════════ */
const dz=$('drop-zone'), fi=$('file-input');
dz.addEventListener('click',()=>fi.click());
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);});
fi.addEventListener('change',()=>{if(fi.files[0])loadFile(fi.files[0]);});

function loadFile(file){
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      currentS2KText=String(e.target.result||''); currentS2KFileName=file.name; foundationSyncAttempted=false;
      WIND4.project=null;WIND4.draft=null;WIND4.result=null;windState=null;
      tables=parseS2K(currentS2KText);
      if(!Object.keys(tables).length){$('upload-error').textContent='解析失敗：未找到任何 TABLE 結構';return;}
      model=buildModel(tables);
      if(!Object.keys(model.joints).length){$('upload-error').textContent='解析成功但無節點座標（JOINT COORDINATES）';return;}
      startApp(file.name,file.size);
    }catch(err){$('upload-error').textContent='解析錯誤：'+err.message;console.error(err);}
  };
  rd.readAsText(file);
}

function startApp(fname,fsize){
  $('drop-screen').style.display='none';
  $('app').classList.add('on');
  $('file-name').textContent=fname;
  const unitUpper = String(model.units || '').toUpperCase();
  const isTonMeter = unitUpper.includes('TON') && unitUpper.includes('M') && unitUpper.includes('C');
  let unitWarning = '';
  if (!isTonMeter) {
    unitWarning = `<div style="margin-top:6px;padding:5px 8px;background:#fff3cd;border:1px solid #ffeeba;color:#856404;border-radius:4px;font-size:0.64rem;font-weight:600;line-height:1.4;text-align:left;">⚠️ 偵測到單位非 Tonf,m,C。設計檢核需在此單位下才能正確計量，建議重新以 Tonf,m,C 匯出 s2k。</div>`;
  }
  $('file-meta').innerHTML=`${(fsize/1024).toFixed(0)} KB · ${model.version}<br>單位：${model.units}<br>`+
    `節點 ${Object.keys(model.joints).length} · 桿件 ${model.frames.length} · 面 ${model.areas.length}` + unitWarning;
  $('tb-info').textContent=`${model.version} | ${model.units} | 表 ${Object.keys(tables).length} 個`;
  areaIndex={}; model.areas.forEach(a=>areaIndex[a.id]=a);
  assignColors();
  buildLegend();
  buildZFilter();
  lcPreloadS2kLoads();
  lcLoadDescriptionState();
  buildLoadPatSelect();
  buildViewControls();
  buildDISelect();
  buildTableDropdown();
  initThree();
  rebuild(true);
  setTimeout(()=>wind4RestoreForSource().catch(console.error),0);
}

function assignColors(){
  let i=0;
  for(const s of Object.keys(model.sections)){sectColor[s]=PALETTE[i++%PALETTE.length];sectVisible[s]=true;}
  for(const s of Object.keys(model.areaSections)){areaSectColor[s]=PALETTE[(i++)%PALETTE.length];areaSectVisible[s]=true;}
  /* v2.4.3：部分面元素的斷面名稱(如 SAP2000 未指定斷面時的 "None")不在 AREA SECTION PROPERTIES 定義表裡，
     之前沒有對應的顏色/可見度項目，會被 areaVisible() 誤判為隱藏。這裡補上，確保這類面仍會顯示、也能在圖例中切換。 */
  for(const a of model.areas){
    if(a.sect && !(a.sect in areaSectVisible)){areaSectColor[a.sect]=PALETTE[(i++)%PALETTE.length];areaSectVisible[a.sect]=true;}
  }
}

/* v2.5.3：台灣鋼結構極限設計法4.5節四級斷面分類。
   無桿件內力時採強軸受撓分類；H/I型依翼板與腹板、箱型依兩方向壁板取最不利者。
   SAP未提供箱型柱銲接型式，名稱以BOX開頭者暫按全滲透銲組合箱型柱判定。 */
const TW_SECTION_CLASSES=[
  {key:'plastic',label:'塑性斷面',short:'塑性'},
  {key:'compact',label:'結實斷面',short:'結實'},
  {key:'noncompact',label:'半結實斷面',short:'半結實'},
  {key:'slender',label:'細長肢材斷面',short:'細長'},
];
function twElementClass(lambda,limits){
  const eps=1e-9;
  let rank=3;
  if(lambda<=limits.pd+eps) rank=0;
  else if(lambda<=limits.p+eps) rank=1;
  else if(lambda<=limits.r+eps) rank=2;
  const c=TW_SECTION_CLASSES[rank];
  return {rank,key:c.key,label:c.label,short:c.short};
}
function twSectionClassify(secName){
  const s=model&&model.sections&&model.sections[secName], m=s&&model.materials&&model.materials[s.mat];
  if(!s) return {applicable:false,rank:99,key:'na',label:'無斷面資料',short:'—',items:[]};
  if(!m||!m.fy) return {applicable:false,rank:99,key:'na',label:'不適用（非鋼材）',short:'不適用',items:[],shape:s.shape||'—'};
  const fy=m.fy/1e4;
  if(!(fy>0)) return {applicable:false,rank:99,key:'na',label:'無Fy資料',short:'—',items:[],shape:s.shape||'—'};
  const sqrtFy=Math.sqrt(fy), shapeRaw=(s.shape||'').toUpperCase(), nameRaw=(secName||'').toUpperCase();
  const items=[];
  let basis='', assumption='';
  const pushItem=(name,lambda,limits)=>{
    if(!isFinite(lambda)||lambda<0||!isFinite(limits.pd)||!isFinite(limits.p)||!isFinite(limits.r)) return;
    const cls=twElementClass(lambda,limits);
    items.push({name,lambda,limits,...cls});
  };
  if(shapeRaw.includes('I/')||shapeRaw.includes('WIDE FLANGE')||shapeRaw==='I'){
    const d=s.t3*100, bf=s.t2*100, tf=s.tf*100, tw=s.tw*100;
    if(!(d>0&&bf>0&&tf>0&&tw>0)) return {applicable:false,rank:99,key:'na',label:'斷面尺寸不足',short:'—',items:[],shape:'I/H型'};
    const welded=/^(BH|WH|WELD|BUILT)/.test(nameRaw);
    const fr=welded?1.16:0.70;
    basis=welded?'銲接I型梁（強軸受撓）':'熱軋I型梁（強軸受撓）';
    pushItem('翼板 b/2tf',bf/(2*tf),{
      pd:14/sqrtFy,
      p:17/sqrtFy,
      r:(welded?28:37)/Math.sqrt(Math.max(fy-fr,1e-9)),
    });
    pushItem('腹板 h/tw',(d-2*tf)/tw,{pd:138/sqrtFy,p:170/sqrtFy,r:260/sqrtFy});
  }else if(shapeRaw.includes('BOX')||shapeRaw.includes('TUBE')){
    const d=s.t3*100, b=s.t2*100, tf=s.tf*100, tw=s.tw*100;
    if(!(d>0&&b>0&&tf>0&&tw>0)) return {applicable:false,rank:99,key:'na',label:'斷面尺寸不足',short:'—',items:[],shape:'箱型'};
    const cjp=/^BOX/.test(nameRaw);
    const co=cjp?{pd:45,p:50,r:63}:{pd:30,p:50,r:63};
    basis=cjp?'全滲透銲組合箱型柱':'矩形／方形中空斷面';
    assumption=cjp?'S2K無銲接型式欄位；依BOX名稱暫按全滲透銲接。':'';
    pushItem('翼板淨寬/tf',(b-2*tw)/tf,{pd:co.pd/sqrtFy,p:co.p/sqrtFy,r:co.r/sqrtFy});
    pushItem('腹板淨深/tw',(d-2*tf)/tw,{pd:co.pd/sqrtFy,p:co.p/sqrtFy,r:co.r/sqrtFy});
  }else{
    return {applicable:false,rank:99,key:'na',label:'不適用（未支援形狀）',short:'不適用',items:[],shape:s.shape||'—'};
  }
  if(!items.length) return {applicable:false,rank:99,key:'na',label:'無法判定',short:'—',items:[],shape:s.shape||'—'};
  const rank=Math.max(...items.map(i=>i.rank)), c=TW_SECTION_CLASSES[rank];
  return {applicable:true,rank,key:c.key,label:c.label,short:c.short,items,fy,basis,assumption,shape:shapeRaw.includes('BOX')||shapeRaw.includes('TUBE')?'箱型':'I/H型'};
}
function twSectionClassTitle(secName,w){
  if(!w||!w.applicable) return `${secName}\n${w?w.label:'無法判定'}`;
  const lines=[`${secName}｜${w.label}`,`Fy=${w.fy.toFixed(3)} tf/cm²｜${w.basis}`];
  for(const it of w.items) lines.push(`${it.name}：λ=${it.lambda.toFixed(3)}；λpd=${it.limits.pd.toFixed(3)}、λp=${it.limits.p.toFixed(3)}、λr=${it.limits.r.toFixed(3)} → ${it.label}`);
  if(w.assumption) lines.push(`註：${w.assumption}`);
  lines.push('整體分類取最不利受壓肢。');
  return lines.join('\n');
}

function buildLegend(){
  const cnt={}, acnt={};
  model.frames.forEach(f=>cnt[f.sect]=(cnt[f.sect]||0)+1);
  model.areas.forEach(a=>acnt[a.sect]=(acnt[a.sect]||0)+1);
  const mk=(holder,names,colors,visMap,counts)=>{
    holder.innerHTML='';
    for(const n of names){
      const row=document.createElement('label'); row.className='leg-row';
      const tw=holder.id==='leg-frame'?twSectionClassify(n):null;
      const badge=tw?`<span class="sect-class ${tw.key}" title="${lcEscape(twSectionClassTitle(n,tw))}">${lcEscape(tw.label)}</span>`:'';
      row.innerHTML=`<input type="checkbox" checked><span class="leg-sw" style="background:#${colors[n].toString(16).padStart(6,'0')}"></span>`+
        `<span class="leg-n" title="${lcEscape(n)}">${lcEscape(n)}</span>${badge}<span class="leg-c">${counts[n]||0}</span>`;
      row.querySelector('input').addEventListener('change',ev=>{visMap[n]=ev.target.checked;rebuild(false);});
      holder.appendChild(row);
    }
  };
  const areaSectNames=[...new Set([...Object.keys(model.areaSections),...model.areas.map(a=>a.sect).filter(Boolean)])];
  mk($('leg-frame'),Object.keys(model.sections),sectColor,sectVisible,cnt);
  mk($('leg-area'),areaSectNames,areaSectColor,areaSectVisible,acnt);
}

let zLevels=[];
function buildZFilter(){
  const set=new Set(Object.values(model.joints).map(j=>+j.z.toFixed(3)));
  zLevels=[...set].sort((a,b)=>a-b);
  const mk=(sel,defIdx)=>{
    sel.innerHTML='';
    zLevels.forEach((z,i)=>{const o=document.createElement('option');o.value=z;o.textContent='Z = '+z;if(i===defIdx)o.selected=true;sel.appendChild(o);});
    sel.addEventListener('change',()=>rebuild(false));
  };
  mk($('z-min'),0); mk($('z-max'),zLevels.length-1);
}

function buildLoadPatSelect(){
  const sel=$('load-pat');
  for(const p of model.loadPats){
    const o=document.createElement('option');o.value=p.name;o.textContent=`${p.name} (${p.type})`;sel.appendChild(o);
  }
  sel.addEventListener('change',()=>rebuild(false));
  $('tg-loadlbl').addEventListener('change',()=>rebuild(false));
}

/* ── 視圖（平/立面）── */
const viewState={mode:'3d',c:0};
function buildViewControls(){
  const vm=$('view-mode'), vp=$('view-plane');
  const fill=()=>{
    const mode=vm.value;
    vp.innerHTML='';
    if(mode==='3d'){vp.style.display='none';return;}
    vp.style.display='block';
    let opts=[];
    if(mode==='plan') opts=zLevels.map(z=>({v:z,t:'Z = '+z}));
    else{
      const ax=mode==='elevx'?'X':'Y';
      const gs=model.grids.filter(g=>g.dir===ax);
      if(gs.length) opts=gs.map(g=>({v:g.c,t:`${g.id}（${ax} = ${g.c}）`}));
      else{
        const set=new Set(Object.values(model.joints).map(j=>+(mode==='elevx'?j.x:j.y).toFixed(2)));
        opts=[...set].sort((a,b)=>a-b).map(c=>({v:c,t:ax+' = '+c}));
      }
    }
    opts.forEach((o,i)=>{const e=document.createElement('option');e.value=o.v;e.textContent=o.t;if(i===0)e.selected=true;vp.appendChild(e);});
  };
  vm.addEventListener('change',()=>{fill();applyView();});
  vp.addEventListener('change',()=>applyView());
  fill();
}
function applyView(){
  viewState.mode=$('view-mode').value;
  viewState.c=+$('view-plane').value||0;
  rebuild(false);
  setCameraForView();
}
function planeOK(j){
  const tol=0.05, m=viewState.mode;
  if(m==='plan')  return Math.abs(j.z-viewState.c)<=tol;
  if(m==='elevx') return Math.abs(j.x-viewState.c)<=tol;
  if(m==='elevy') return Math.abs(j.y-viewState.c)<=tol;
  return true;
}
function setCameraForView(){
  const m=viewState.mode;
  if(m==='3d'){
    activeCam=camera;
    remakeControls();
    controls.enableRotate=true;
    fitCamera();
    return;
  }
  // bbox of visible joints (three coords)
  const bb=new THREE.Box3(); let any=false;
  for(const j of Object.values(model.joints)){
    if(!zOK(j.z)||!planeOK(j)) continue;
    bb.expandByPoint(toThree(j.x,j.y,j.z)); any=true;
  }
  if(!any) bb.copy(bbox);
  const c=bb.getCenter(new THREE.Vector3()), sz=bb.getSize(new THREE.Vector3());
  let w,h,pos,up;
  const D=modelRadius*3+10;
  if(m==='plan'){ w=sz.x; h=sz.z; pos=c.clone().add(new THREE.Vector3(0,D,0)); up=new THREE.Vector3(0,0,-1); }
  else if(m==='elevx'){ w=sz.z; h=sz.y; pos=c.clone().add(new THREE.Vector3(D,0,0)); up=new THREE.Vector3(0,1,0); }
  else{ w=sz.x; h=sz.y; pos=c.clone().add(new THREE.Vector3(0,0,D)); up=new THREE.Vector3(0,1,0); }
  orthoH=Math.max(h,w*0.6,2)*1.15;
  const holder=$('canvas-holder');
  const asp=holder.clientWidth/Math.max(holder.clientHeight,1);
  if(!orthoCam) orthoCam=new THREE.OrthographicCamera(-1,1,1,-1,-2000,4000);
  orthoCam.left=-orthoH*asp/2; orthoCam.right=orthoH*asp/2;
  orthoCam.top=orthoH/2; orthoCam.bottom=-orthoH/2;
  orthoCam.position.copy(pos); orthoCam.up.copy(up); orthoCam.zoom=1;
  orthoCam.lookAt(c); orthoCam.updateProjectionMatrix();
  activeCam=orthoCam;
  remakeControls();
  controls.target.copy(c);
  controls.enableRotate=false;
  controls.update();
}
function remakeControls(){
  const t=controls?controls.target.clone():modelCenter.clone();
  if(controls) controls.dispose();
  controls=new OrbitControls(activeCam,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.1;
  controls.target.copy(t);
}

/* ── Design Input ── */
const DI_ITEMS=[
  {k:'',label:'（無）'},
  {k:'DesignSect',label:'設計斷面 Design Sections',cat:1},
  {k:'FrameType',label:'構架類型 Design Framing Type',cat:1},
  {k:'RLLF',label:'活載折減 Live Load Red Factor'},
  {k:'XLMajor',label:'無支撐長度比 Major'},
  {k:'XLMinor',label:'無支撐長度比 Minor'},
  {k:'XLLTB',label:'無支撐長度比 LTB'},
  {k:'K1Major',label:'有效長度係數 K1 Major'},
  {k:'K1Minor',label:'有效長度係數 K1 Minor'},
  {k:'K2Major',label:'有效長度係數 K2 Major'},
  {k:'K2Minor',label:'有效長度係數 K2 Minor'},
  {k:'KLTB',label:'有效長度係數 KLTB'},
  {k:'CmMajor',label:'Cm Major'},
  {k:'CmMinor',label:'Cm Minor'},
  {k:'Cb',label:'Cb'},
  {k:'B1Major',label:'B1 Major'},
  {k:'B1Minor',label:'B1 Minor'},
  {k:'B2Major',label:'B2 Major'},
  {k:'B2Minor',label:'B2 Minor'},
  {k:'AreaRatio',label:'淨斷面比 Net Area Ratio'},
  {k:'Omega0',label:'Omega0'},
  {k:'Fy',label:'降伏強度 Fy'},
  {k:'Pnc',label:'受壓強度 Pnc'},
  {k:'Pnt',label:'受拉強度 Pnt'},
  {k:'Mn3',label:'彎矩強度 Mn3'},
  {k:'Mn2',label:'彎矩強度 Mn2'},
  {k:'Vn2',label:'剪力強度 Vn2'},
  {k:'Vn3',label:'剪力強度 Vn3'},
];
const PROG='程式決定';
function buildDISelect(){
  const sel=$('di-select');
  for(const it of DI_ITEMS){const o=document.createElement('option');o.value=it.k;o.textContent=it.label;sel.appendChild(o);}
  if(!Object.keys(model.overwrites).length && model.frames.every(f=>!f.designSect)) sel.disabled=true;
  sel.addEventListener('change',()=>rebuild(false));
}
function diValue(f,it){
  const ow=model.overwrites[f.id]||{};
  if(it.cat){
    const v=ow[it.k];
    const explicit=v!==undefined&&v!=='Program Determined';
    if(it.k==='DesignSect') return {v:explicit?v:(f.designSect||f.sect||'—'),explicit};
    return {v:explicit?v:(model.steelPrefs.FrameType?model.steelPrefs.FrameType+'（預設）':PROG),explicit};
  }
  const v=+ow[it.k]||0;
  return {v:v||PROG,explicit:v!==0};
}
/* diState：rebuild 時計算，回傳 frame→color/label */
let diState=null;
function computeDI(){
  diState=null;
  $('di-legend').innerHTML='';
  const k=$('di-select').value;
  if(!k) return;
  const it=DI_ITEMS.find(x=>x.k===k);
  const vals={}, colorOf={};
  for(const f of model.frames){ const r=diValue(f,it); vals[f.id]=r; }
  const leg=$('di-legend');
  if(it.cat){
    const cnt={};
    for(const f of model.frames){const v=vals[f.id].v; cnt[v]=(cnt[v]||0)+1;}
    const names=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]);
    names.forEach((n,i)=>colorOf[n]=n===PROG?0x4a5260:PALETTE[i%PALETTE.length]);
    leg.innerHTML=names.map(n=>`<div class="leg-row"><span class="leg-sw" style="background:#${colorOf[n].toString(16).padStart(6,'0')}"></span><span class="leg-n" title="${n}">${n}</span><span class="leg-c">${cnt[n]}</span></div>`).join('');
    diState={get:id=>({color:colorOf[vals[id].v],label:vals[id].explicit?String(vals[id].v):null})};
  }else{
    const ex=model.frames.filter(f=>vals[f.id].explicit);
    if(!ex.length){
      leg.innerHTML=`<div class="leg-row"><span class="leg-sw" style="background:#4a5260"></span><span class="leg-n">全部：${PROG}（無覆寫）</span></div>`;
      diState={get:id=>({color:0x4a5260,label:null})};
    }else{
      const nums=ex.map(f=>vals[f.id].v);
      const mn=Math.min(...nums), mx=Math.max(...nums);
      leg.innerHTML=`<div class="grad"></div><div class="grad-l"><span>${fmt(mn)}</span><span>${fmt(mx)}</span></div>`+
        `<div class="leg-row"><span class="leg-sw" style="background:#4a5260"></span><span class="leg-n">${PROG}</span><span class="leg-c">${model.frames.length-ex.length}</span></div>`;
      diState={get:id=>{
        const r=vals[id];
        if(!r.explicit) return {color:0x4a5260,label:null};
        return {color:heatColor(mx>mn?(r.v-mn)/(mx-mn):0.5),label:fmt(r.v)};
      }};
    }
  }
}
/* 熱力圖色帶（與 CSS .grad 同步）*/
const HEAT_STOPS=[[0x27,0x50,0xa8],[0x3e,0xcf,0x8e],[0xff,0xd8,0x66],[0xff,0x55,0x44]];
function heatColor(t){
  t=Math.min(1,Math.max(0,t));
  const seg=t*(HEAT_STOPS.length-1), i=Math.min(HEAT_STOPS.length-2,Math.floor(seg)), u=seg-i;
  const a=HEAT_STOPS[i], b=HEAT_STOPS[i+1];
  return (Math.round(a[0]+(b[0]-a[0])*u)<<16)|(Math.round(a[1]+(b[1]-a[1])*u)<<8)|Math.round(a[2]+(b[2]-a[2])*u);
}

/* ════════ THREE INIT ════════ */
function initThree(){
  const holder=$('canvas-holder');
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x14171c);
  camera=new THREE.PerspectiveCamera(50,1,0.1,5000);
  activeCam=camera;
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  holder.appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.1;
  scene.add(new THREE.AmbientLight(0xffffff,0.75));
  const d1=new THREE.DirectionalLight(0xffffff,1.1); d1.position.set(1,2,1.2); scene.add(d1);
  const d2=new THREE.DirectionalLight(0xffffff,0.4); d2.position.set(-1,-0.5,-1); scene.add(d2);
  const resize=()=>{
    const w=holder.clientWidth,h=holder.clientHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    if(orthoCam){const asp=w/Math.max(h,1);orthoCam.left=-orthoH*asp/2;orthoCam.right=orthoH*asp/2;orthoCam.top=orthoH/2;orthoCam.bottom=-orthoH/2;orthoCam.updateProjectionMatrix();}
    renderer.setSize(w,h);
  };
  new ResizeObserver(resize).observe(holder); resize();
  renderer.setAnimationLoop(()=>{
    controls.update();
    renderer.render(scene,activeCam);
    if(typeof updateAxes === 'function') updateAxes();
  });
  window.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')fitCamera();});
  initPicking();
  initAxes();
}

let axesScene, axesCamera, axesRenderer;
function initAxes(){
  const holder = document.createElement('div');
  holder.id = 'axes-canvas';
  holder.style.position = 'absolute';
  holder.style.bottom = '15px';
  holder.style.right = '15px';
  holder.style.width = '110px';
  holder.style.height = '110px';
  holder.style.zIndex = '100';
  holder.style.pointerEvents = 'none';
  const holder3d = $('canvas-holder') || document.body;
  holder3d.appendChild(holder);

  axesScene = new THREE.Scene();
  axesCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
  axesCamera.position.set(0, 0, 3);
  
  axesRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  axesRenderer.setSize(110, 110);
  axesRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  holder.appendChild(axesRenderer.domElement);

  const arrowX = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 0.95, 0xff3b30, 0.24, 0.09);
  axesScene.add(arrowX);
  const arrowY = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(0,0,0), 0.95, 0x34c759, 0.24, 0.09);
  axesScene.add(arrowY);
  const arrowZ = new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,0), 0.95, 0x007aff, 0.24, 0.09);
  axesScene.add(arrowZ);

  function makeTextSprite(message, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 44px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.42, 0.42, 1);
    return sprite;
  }

  const sx = makeTextSprite('X', '#ff3b30'); sx.position.set(1.18, 0, 0); axesScene.add(sx);
  const sy = makeTextSprite('Y', '#34c759'); sy.position.set(0, 0, -1.18); axesScene.add(sy);
  const sz = makeTextSprite('Z', '#007aff'); sz.position.set(0, 1.18, 0); axesScene.add(sz);
}

function updateAxes(){
  if(!axesScene || !axesCamera || !axesRenderer || !activeCam) return;
  const dir = new THREE.Vector3();
  if (typeof controls !== 'undefined' && controls) {
    dir.copy(activeCam.position).sub(controls.target).normalize();
  } else {
    dir.copy(activeCam.position).normalize();
  }
  axesCamera.up.copy(activeCam.up);
  axesCamera.position.copy(dir).multiplyScalar(3);
  axesCamera.lookAt(0, 0, 0);
  axesRenderer.render(axesScene, axesCamera);
}

function clearGroup(g){if(!g)return;scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(mt=>{if(mt.map)mt.map.dispose();mt.dispose();});}});}

/* ── visibility filter ── */
function zOK(z){const lo=+$('z-min').value, hi=+$('z-max').value; return z>=lo-1e-4 && z<=hi+1e-4;}
function frameVisible(f){
  if(f.sect && !sectVisible[f.sect]) return false;
  const a=model.joints[f.i], b=model.joints[f.j];
  return a&&b&&zOK(a.z)&&zOK(b.z)&&planeOK(a)&&planeOK(b);
}
function areaVisible(a){
  if(a.sect && !areaSectVisible[a.sect]) return false;
  return a.joints.every(id=>{const j=model.joints[id];return j&&zOK(j.z)&&planeOK(j);});
}
/* v2.0.0：CONNECTIVITY-AREA 的 Joint1..N 並非保證依周界順序排列(部份 SAP2000 v9 匯出檔會用格點順序)，
   若直接扇形三角化(pts[0],pts[i],pts[i+1])會連錯線變成蝴蝶結；改成先按質心角度排序再三角化，各版本通用 */
function sortAreaVerts(pts){
  if(pts.length<=3) return pts;
  const center=pts.reduce((s,p)=>s.add(p.clone()),new THREE.Vector3()).multiplyScalar(1/pts.length);
  const v1=pts[1].clone().sub(pts[0]), v2=pts[2].clone().sub(pts[0]);
  const normal=new THREE.Vector3().crossVectors(v1,v2).normalize();
  const u=pts[0].clone().sub(center).normalize();
  const v=new THREE.Vector3().crossVectors(normal,u).normalize();
  return pts.slice().sort((a,b)=>{
    const va=a.clone().sub(center), vb=b.clone().sub(center);
    return Math.atan2(va.dot(v),va.dot(u))-Math.atan2(vb.dot(v),vb.dot(u));
  });
}
/* v2.0.1：支承符號改空心線條，逐軸(R1,R2)判斷是否釋放彎矩——比照舊版 SAP2000v9_S2K_3D_v1_3_2.html 的 createSupportSymbol()，
   但拿掉其固定側的對角/中心線，維持單純空心矩形。R1/R2釋放→該平面畫空心三角形(頂點在節點)；未釋放→畫空心矩形。R3(繞豎向軸)不畫。*/
function makeSupportSymbol(dof){
  const R1=dof[3], R2=dof[4];
  const s=0.28;
  const seg=[];
  if(!R2){ // 三角形：頂點(0,0,0)在節點，底邊在下方
    seg.push(-s,-s,0, 0,0,0,  s,-s,0, 0,0,0,  -s,-s,0, s,-s,0);
  }else{ // 矩形，無對角線
    seg.push(-s,-s,0, s,-s,0,  s,-s,0, s,0,0,  s,0,0, -s,0,0,  -s,0,0, -s,-s,0);
  }
  if(!R1){
    seg.push(0,-s,-s, 0,0,0,  0,-s,s, 0,0,0,  0,-s,-s, 0,-s,s);
  }else{
    seg.push(0,-s,-s, 0,-s,s,  0,-s,s, 0,0,s,  0,0,s, 0,0,-s,  0,0,-s, 0,-s,-s);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(seg,3));
  return new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x3ecf8e}));
}

/* ── section 2D shape (x=local3 寬, y=local2 深) ── */
function sectionShape(s){
  const sh=new THREE.Shape();
  const shape=(s.shape||'').toUpperCase();
  if(shape.includes('I/WIDE')||shape.includes('I-')||shape==='I'){
    const d=s.t3,bf=s.t2,tf=s.tf||d*0.06,tw=s.tw||bf*0.05,bfb=s.t2b||bf,tfb=s.tfb||tf;
    sh.moveTo(-bf/2,d/2);sh.lineTo(bf/2,d/2);sh.lineTo(bf/2,d/2-tf);sh.lineTo(tw/2,d/2-tf);
    sh.lineTo(tw/2,-d/2+tfb);sh.lineTo(bfb/2,-d/2+tfb);sh.lineTo(bfb/2,-d/2);sh.lineTo(-bfb/2,-d/2);
    sh.lineTo(-bfb/2,-d/2+tfb);sh.lineTo(-tw/2,-d/2+tfb);sh.lineTo(-tw/2,d/2-tf);sh.lineTo(-bf/2,d/2-tf);
    sh.closePath();
  }else if(shape.includes('BOX')||shape.includes('TUBE')){
    const d=s.t3,b=s.t2,tf=s.tf||d*0.05,tw=s.tw||b*0.05;
    sh.moveTo(-b/2,-d/2);sh.lineTo(b/2,-d/2);sh.lineTo(b/2,d/2);sh.lineTo(-b/2,d/2);sh.closePath();
    const hole=new THREE.Path();
    hole.moveTo(-b/2+tw,-d/2+tf);hole.lineTo(b/2-tw,-d/2+tf);hole.lineTo(b/2-tw,d/2-tf);hole.lineTo(-b/2+tw,d/2-tf);hole.closePath();
    sh.holes.push(hole);
  }else if(shape.includes('PIPE')||shape.includes('CIRCLE')){
    const r=s.t3/2; sh.absarc(0,0,r,0,Math.PI*2,false);
    if(shape.includes('PIPE')&&s.tw>0&&s.tw<r){const hole=new THREE.Path();hole.absarc(0,0,r-s.tw,0,Math.PI*2,true);sh.holes.push(hole);}
  }else{ // Rectangular / fallback
    const d=s.t3,b=s.t2;
    sh.moveTo(-b/2,-d/2);sh.lineTo(b/2,-d/2);sh.lineTo(b/2,d/2);sh.lineTo(-b/2,d/2);sh.closePath();
  }
  return sh;
}

/* ── SAP 局部軸（SAP 座標系內計算） ── */
function localAxes(f){
  const a=model.joints[f.i], b=model.joints[f.j];
  const ax=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize(); // local 1
  let l2;
  if(Math.abs(ax.z)>0.999) l2=new THREE.Vector3(1,0,0);
  else{
    const Z=new THREE.Vector3(0,0,1);
    l2=Z.clone().sub(ax.clone().multiplyScalar(Z.dot(ax))).normalize();
  }
  if(f.angle){
    const q=new THREE.Quaternion().setFromAxisAngle(ax,f.angle*Math.PI/180);
    l2.applyQuaternion(q);
  }
  const l3=new THREE.Vector3().crossVectors(ax,l2).normalize();
  return {l1:ax,l2,l3};
}
const sapVecToThree=v=>new THREE.Vector3(v.x,v.z,-v.y);

/* ════════ BUILD SCENE ════════ */
function rebuild(resetCam){
  if(!model) return;
  [gFrames,gAreas,gJoints,gSupports,gGrid,gLoads,gFLabels,gJLabels,gReleases].forEach(clearGroup);
  pickables=[];
  gFrames=new THREE.Group(); gAreas=new THREE.Group(); gJoints=new THREE.Group();
  gSupports=new THREE.Group(); gGrid=new THREE.Group(); gLoads=new THREE.Group();
  gFLabels=new THREE.Group(); gJLabels=new THREE.Group(); gReleases=new THREE.Group();

  const extrude=$('tg-extrude').checked;
  labelScale=parseFloat($('lbl-size').value)||1;
  computeDI();
  // 面載重熱力圖資料
  const hmPat=$('load-pat').value;
  let hm=null;
  if(loadCalc.colorOn){
    const map={};
    for(const a of model.areas){
      const lv=loadCalc.vals[a.id]; if(!lv) continue;
      const tot=Object.values(lv).reduce((s,w)=>s+w,0);
      if(tot>0) map[a.id]=tot;
    }
    const vs=Object.values(map);
    if(vs.length) hm={map,min:Math.min(...vs),max:Math.max(...vs)};
  }else if(hmPat){
    const map={};
    for(const l of model.areaLoads) if(l.pat===hmPat) map[l.area]=(map[l.area]||0)+Math.abs(l.v);
    const vs=Object.values(map);
    if(vs.length) hm={map,min:Math.min(...vs),max:Math.max(...vs)};
  }
  $('load-legend').style.display=(hm&&!loadCalc.colorOn)?'block':'none';
  if(hm){$('ll-min').textContent=fmt(hm.min);$('ll-max').textContent=fmt(hm.max);}
  if(loadCalc.colorOn){
    const lcl=$('lc-legend');
    if(hm){lcl.style.display='block';lcl.innerHTML=`<div class="grad"></div><div class="grad-l"><span>${fmt(hm.min)} tf/m²</span><span>${fmt(hm.max)} tf/m²</span></div>`;}
    else{lcl.style.display='none';}
  }
  const shapeCache={};
  const matCache={};
  const lineMatCache={};
  const getMat=c=>matCache[c]||(matCache[c]=new THREE.MeshLambertMaterial({color:c}));
  const getLineMat=c=>lineMatCache[c]||(lineMatCache[c]=new THREE.LineBasicMaterial({color:c}));

  // bbox
  bbox=new THREE.Box3();
  for(const j of Object.values(model.joints)) bbox.expandByPoint(toThree(j.x,j.y,j.z));
  bbox.getCenter(modelCenter);
  modelRadius=Math.max(bbox.getSize(new THREE.Vector3()).length()/2,5);

  /* frames */
  if($('tg-frames').checked){
    for(const f of model.frames){
      if(!frameVisible(f)) continue;
      const p1=jPos(f.i), p2=jPos(f.j);
      if(!p1||!p2) continue;
      const col=(scwbState&&scwbState.active)?scwbState.frameColor(f):(diState?diState.get(f.id).color:(sectColor[f.sect]??0x999999));
      let obj;
      let drawP1 = p1.clone();
      let drawP2 = p2.clone();
      let len = p1.distanceTo(p2);
      const rel = model.releases[f.id];
      const offsetDist = Math.min(0.32, f.len * 0.1);
      
      if (rel) {
        const dirv = p2.clone().sub(p1).normalize();
        if (rel.mi) drawP1.add(dirv.clone().multiplyScalar(offsetDist));
        if (rel.mj) drawP2.sub(dirv.clone().multiplyScalar(offsetDist));
        len = drawP1.distanceTo(drawP2);
      }

      if(extrude && model.sections[f.sect]){
        const s=model.sections[f.sect];
        const sh=sectionShape(s);
        const g=new THREE.ExtrudeGeometry(sh,{depth:len,bevelEnabled:false,curveSegments:12});
        const {l1,l2,l3}=localAxes(f);
        const M=new THREE.Matrix4().makeBasis(sapVecToThree(l3),sapVecToThree(l2),sapVecToThree(l1));
        M.setPosition(drawP1);
        g.applyMatrix4(M);
        obj=new THREE.Mesh(g,getMat(col));
      }else{
        const g=new THREE.BufferGeometry().setFromPoints([drawP1, drawP2]);
        obj=new THREE.Line(g,getLineMat(col));
      }
      obj.userData={type:'frame',ref:f};
      gFrames.add(obj); pickables.push(obj);

      if($('tg-releases').checked && rel){
        const sg=new THREE.SphereGeometry(0.12,8,8);
        const rm=new THREE.MeshBasicMaterial({color:0x3ecf8e});
        if(rel.mi){const mh=new THREE.Mesh(sg,rm);mh.position.copy(drawP1);gReleases.add(mh);}
        if(rel.mj){const mh=new THREE.Mesh(sg,rm);mh.position.copy(drawP2);gReleases.add(mh);}
      }
      if($('tg-flabels').checked){
        const mid=p1.clone().add(p2).multiplyScalar(0.5);
        gFLabels.add(makeLabel(f.id,'#f0a500',mid));
      }
      if(diState){
        const dl=diState.get(f.id).label;
        if(dl){const mid=p1.clone().add(p2).multiplyScalar(0.5).add(new THREE.Vector3(0,0.25,0));
          gFLabels.add(makeLabel(dl,'#ffd866',mid,0.7));}
      }
    }
  }

  /* areas */
  if($('tg-areas').checked){
    for(const a of model.areas){
      if(!areaVisible(a)) continue;
      let pts=a.joints.map(jPos).filter(Boolean);
      if(pts.length<3) continue;
      pts=sortAreaVerts(pts);
      let col=areaSectColor[a.sect]??0x888888, op=0.32;
      if(hm){
        const v=hm.map[a.id];
        if(v!==undefined){col=heatColor(hm.max>hm.min?(v-hm.min)/(hm.max-hm.min):0.5);op=0.8;}
        else{col=0x3a4250;op=0.12;}
      }
      const isSel=loadCalc.selected.has(a.id);
      if(isSel) op=Math.max(op,0.85);
      const geo=new THREE.BufferGeometry();
      const verts=[];
      for(let i=1;i<pts.length-1;i++){verts.push(pts[0].x,pts[0].y,pts[0].z,pts[i].x,pts[i].y,pts[i].z,pts[i+1].x,pts[i+1].y,pts[i+1].z);}
      geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
      geo.computeVertexNormals();
      const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:col,transparent:true,opacity:op,side:THREE.DoubleSide,depthWrite:false}));
      mesh.userData={type:'area',ref:a};
      gAreas.add(mesh); pickables.push(mesh);
      // edges (選取中的面以黃色高亮邊框標示)
      const eg=new THREE.BufferGeometry().setFromPoints([...pts,pts[0]]);
      gAreas.add(new THREE.Line(eg,new THREE.LineBasicMaterial({color:isSel?0xffee00:col,transparent:true,opacity:isSel?1:0.7})));
      if(hm&&hm.map[a.id]!==undefined&&$('tg-loadlbl').checked){
        const c=pts.reduce((s2,q)=>s2.add(q),new THREE.Vector3()).multiplyScalar(1/pts.length);
        gAreas.add(makeLabel(fmt(hm.map[a.id]),'#fff',c,0.7));
      }
    }
  }

  /* joints */
  const jointArr=Object.values(model.joints).filter(j=>zOK(j.z)&&planeOK(j));
  if($('tg-joints').checked){
    const pg=new THREE.BufferGeometry();
    pg.setAttribute('position',new THREE.Float32BufferAttribute(jointArr.flatMap(j=>{const p=toThree(j.x,j.y,j.z);return[p.x,p.y,p.z];}),3));
    const isL=document.documentElement.classList.contains('light-theme');
    const pts=new THREE.Points(pg,new THREE.PointsMaterial({color:isL?0x46546a:0xffffff,size:0.14}));
    pts.userData={type:'joints',list:jointArr};
    gJoints.add(pts); pickables.push(pts);
  }
  if($('tg-jlabels').checked){
    for(const j of jointArr) gJLabels.add(makeLabel(j.id,'#9ad0ff',toThree(j.x,j.y,j.z).add(new THREE.Vector3(0,0.15,0))));
  }

  /* supports */
  if($('tg-supports').checked){
    for(const [jid,dof] of Object.entries(model.restraints)){
      const j=model.joints[jid]; if(!j||!zOK(j.z)||!planeOK(j)) continue;
      const p=toThree(j.x,j.y,j.z);
      const sym=makeSupportSymbol(dof);
      sym.position.copy(p);
      gSupports.add(sym);
    }
  }

  /* grid lines */
  if($('tg-grid').checked && model.grids.length){
    const gm=new THREE.LineBasicMaterial({color:0x39424f});
    /* v2.0.1：平/立面時隱藏與目前切面垂直方向的格線標籤，避免重疊 */
    const vm=viewState.mode, showX=vm!=='elevx', showY=vm!=='elevy', showZList=vm!=='plan';
    const xs=model.grids.filter(g=>g.dir==='X').sort((a,b)=>a.c-b.c);
    const ys=model.grids.filter(g=>g.dir==='Y').sort((a,b)=>a.c-b.c);
    const zs=model.grids.filter(g=>g.dir==='Z');
    const xMin=Math.min(...xs.map(g=>g.c),0), xMax=Math.max(...xs.map(g=>g.c),1);
    const yMin=Math.min(...ys.map(g=>g.c),0), yMax=Math.max(...ys.map(g=>g.c),1);
    const zBase=zs.length?Math.min(...zs.map(g=>g.c)):0;
    const zGrid=zBase-0.04; // 格線及氣泡向下微調 4cm，防平面圖格線遮擋支承
    const pad=2;
    if(showX){
      for(const g of xs){
        const geo=new THREE.BufferGeometry().setFromPoints([toThree(g.c,yMin-pad,zGrid),toThree(g.c,yMax+pad,zGrid)]);
        gGrid.add(new THREE.Line(geo,gm));
        gGrid.add(makeGridBubble(g.id,'#8a97ab',toThree(g.c,yMax+pad+0.8,zGrid)));
      }
      const isL=document.documentElement.classList.contains('light-theme');
      const distColor = isL ? '#b25900' : '#e0a840';
      for(let i=1;i<xs.length;i++){
        const d=xs[i].c-xs[i-1].c, mid=(xs[i].c+xs[i-1].c)/2;
        gGrid.add(makeLabel(fmt(d),distColor,toThree(mid,yMax+pad+1.8,zGrid),0.55));
      }
    }
    if(showY){
      const isL=document.documentElement.classList.contains('light-theme');
      const distColor = isL ? '#b25900' : '#e0a840';
      for(const g of ys){
        const geo=new THREE.BufferGeometry().setFromPoints([toThree(xMin-pad,g.c,zGrid),toThree(xMax+pad,g.c,zGrid)]);
        gGrid.add(new THREE.Line(geo,gm));
        gGrid.add(makeGridBubble(g.id,'#8a97ab',toThree(xMin-pad-0.8,g.c,zGrid)));
      }
      for(let i=1;i<ys.length;i++){
        const d=ys[i].c-ys[i-1].c, mid=(ys[i].c+ys[i-1].c)/2;
        gGrid.add(makeLabel(fmt(d),distColor,toThree(xMin-pad-1.8,mid,zGrid),0.55));
      }
    }
    if(showZList){
      for(const g of zs){
        const isL=document.documentElement.classList.contains('light-theme');
        gGrid.add(makeLabel(g.id+' ('+g.c+')',isL?'#46546a':'#aab4c2',toThree(xMin-pad-1.6,yMin-pad,g.c)));
      }
    }
  }

  /* 交會區 NG 節點高亮球 */
  if(pjzState&&pjzState.active&&pjzData){
    for(const J in pjzData.res){
      const j=model.joints[J]; if(!j||!zOK(j.z)||!planeOK(j)) continue;
      const s=pjzJointNG(J); if(!s) continue;
      const col=s.ng?0xff5252:0x2e9e5e;
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(s.ng?0.22:0.14,12,12),new THREE.MeshLambertMaterial({color:col,transparent:true,opacity:0.85}));
      mesh.position.copy(toThree(j.x,j.y,j.z));
      gSupports.add(mesh);
    }
  }
  /* loads */
  buildLoads();
  if(scwbState&&scwbState.active) drawSCWBLabels();
  if(pjzState&&pjzState.active) pjzDrawLabels();

  scene.add(gFrames,gAreas,gJoints,gSupports,gGrid,gLoads,gFLabels,gJLabels,gReleases);
  renderFoundationOverlay();
  if(resetCam) fitCamera();
}

/* ── loads ── */
function dirToThree(dirStr,sign){
  const d=(dirStr||'').toUpperCase();
  let v;
  if(d==='GRAVITY'||d==='GRAV') v=new THREE.Vector3(0,-1,0);
  else if(d==='Z'||d==='GZ') v=new THREE.Vector3(0,1,0);
  else if(d==='X'||d==='GX') v=new THREE.Vector3(1,0,0);
  else if(d==='Y'||d==='GY') v=new THREE.Vector3(0,0,-1);
  else v=new THREE.Vector3(0,-1,0);
  return sign<0?v.negate():v;
}
const PAT_COLOR={Dead:0x6be7e0,Live:0x8aff80,Quake:0xff6b6b,Wind:0xffd866};
function patColor(pat){
  const p=model.loadPats.find(x=>x.name===pat);
  return PAT_COLOR[p?.type]??0xf0a500;
}

function buildLoads(){
  const pat=$('load-pat').value;
  if(!pat) return;
  const showLbl=$('tg-loadlbl').checked;
  const fmap={}; model.frames.forEach(f=>fmap[f.id]=f);
  const amap={}; model.areas.forEach(a=>amap[a.id]=a);
  const fl=model.frameLoads.filter(l=>l.pat===pat&&fmap[l.frame]&&frameVisible(fmap[l.frame]));
  const maxV=Math.max(...fl.flatMap(l=>[Math.abs(l.va),Math.abs(l.vb)]),1e-9);
  // frame distributed
  for(const l of fl){
    const f=fmap[l.frame];
    const p1=jPos(f.i),p2=jPos(f.j); if(!p1||!p2)continue;
    const col=patColor(pat);
    const lm=new THREE.LineBasicMaterial({color:col});
    const A=p1.clone().lerp(p2,l.a), B=p1.clone().lerp(p2,l.b);
    const segLen=A.distanceTo(B);
    const n=Math.max(2,Math.min(14,Math.ceil(segLen/1.2)));
    const tails=[];
    for(let k=0;k<=n;k++){
      const t=k/n;
      const v=l.va+(l.vb-l.va)*t;
      if(Math.abs(v)<1e-12){tails.push(A.clone().lerp(B,t));continue;}
      const dir=dirToThree(l.dir,Math.sign(v));
      const h=0.5+1.0*Math.abs(v)/maxV;
      const tip=A.clone().lerp(B,t);
      const tail=tip.clone().sub(dir.clone().multiplyScalar(h));
      tails.push(tail);
      const g=new THREE.BufferGeometry().setFromPoints([tail,tip]);
      gLoads.add(new THREE.Line(g,lm));
      // arrowhead
      const ah=new THREE.Mesh(new THREE.ConeGeometry(0.055,0.18,6),new THREE.MeshBasicMaterial({color:col}));
      ah.position.copy(tip.clone().sub(dir.clone().multiplyScalar(0.09)));
      ah.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
      gLoads.add(ah);
    }
    const tg=new THREE.BufferGeometry().setFromPoints(tails);
    gLoads.add(new THREE.Line(tg,lm));
    if(showLbl){
      const mid=tails[Math.floor(tails.length/2)].clone();
      const val=(l.va===l.vb)?fmt(l.va):fmt(l.va)+'~'+fmt(l.vb);
      gLoads.add(makeLabel(val,'#'+col.toString(16).padStart(6,'0'),mid.add(new THREE.Vector3(0,0.3,0)),0.65));
    }
  }
  // 面載重：以熱力圖呈現（見 rebuild 內 hm），此處不畫箭頭
}
const fmt=v=>Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=1?v.toFixed(2):v.toFixed(3);

/* ════════ 樓層載重試算 (v2.4.0+ / v2.4.2 新增桿件自重) ════════ */
let areaIndex={};
const areaM2Cache={};
let loadCalc={types:[],vals:{},selected:new Set(),pickMode:false,colorOn:false,floors:{},floorM2:{},
  floorAreaDetail:{},floorLineDetail:{},frameSelfWt:true,floorFrameDetail:{},selfWtMult:1,nextId:1};
const LC_DESC_HEADERS=['Primary','Load Case','Load Pattern','Description(chinese)'];
const LC_DESC_DEFAULTS=[
  ['Load 1','DL','DEAD','結構鋼構材自重（模型SelfWtMult）'],
  ['','','DL1','樓板／Deck混凝土、鋼承板及RC牆結構固定載重'],
  ['','','DL2','高架地板、輕質混凝土及磁磚等裝修固定載重'],
  ['','','DL3','天花、吊架、機電管線等固定載重'],
  ['','','DL4','固定設備、水箱、基座及設備集中反力'],
  ['','','DL5','帷幕牆、女兒牆及其他外牆固定載重'],
  ['Load 2','LL','LL1','辦公室、工作間、一般會議室活載重'],
  ['','','LL2','走道、樓梯與平台、梯廳、廁所及茶水間活載重'],
  ['','','LL3','多功能集會室及陽台活載重'],
  ['','','LL4','檔案室、書庫及儲藏空間活載重'],
  ['','','LL5','電器、控制及設備機房活載重'],
  ['Load 3','LR','LR','屋頂活載重（本案先採0.20 tf/m²）'],
  ['Load 4','EXP','EXP','X向地震力考慮+5%偏心'],
  ['Load 5','EXN','EXN','X向地震力考慮-5%偏心'],
  ['Load 6','EYP','EYP','Y向地震力考慮+5%偏心'],
  ['Load 7','EYN','EYN','Y向地震力考慮-5%偏心'],
  ['Load 8','EV','DEAD','垂直地震力：結構自重部分'],
  ['','','DL1','垂直地震力：樓板／RC牆固定載重部分'],
  ['','','DL2','垂直地震力：裝修固定載重部分'],
  ['','','DL3','垂直地震力：天花機電固定載重部分'],
  ['','','DL4','垂直地震力：設備與水箱固定載重部分'],
  ['','','DL5','垂直地震力：外牆與女兒牆固定載重部分'],
  ['Load 9','WXP','WXP','結構體正X向風力'],
  ['Load 10','WXN','WXN','結構體負X向風力'],
  ['Load 11','WYP','WYP','結構體正Y向風力'],
  ['Load 12','WYN','WYN','結構體負Y向風力'],
];
let lcLoadDescriptions=[];
function lcDescProjectKey(){return 's2k-v252-load-desc:'+(currentS2KFileName||'default');}
function lcNormalizeDescRows(rows){
  return (rows||[]).map(r=>[0,1,2,3].map(i=>String((r&&r[i])??'').trim())).filter(r=>r.some(Boolean));
}
function lcEnsureDescriptionPatterns(){
  const have=new Set(lcLoadDescriptions.map(r=>String(r[2]||'').toUpperCase()));
  for(const p of model?.loadPats||[]){
    const name=String(p.name||'').trim(); if(!name||have.has(name.toUpperCase())) continue;
    const typ=String(p.type||'').toLowerCase();
    const loadCase=typ==='dead'?'DL':typ==='live'?(name==='LR'?'LR':'LL'):name;
    lcLoadDescriptions.push(['',loadCase,name,`${name} 載重`]);
    have.add(name.toUpperCase());
  }
}
function lcSaveDescriptions(statusText){
  const rows=lcNormalizeDescRows(lcLoadDescriptions);
  lcLoadDescriptions=rows;
  try{
    const raw=JSON.stringify(rows);
    localStorage.setItem('s2k-v252-load-desc-global',raw);
    localStorage.setItem(lcDescProjectKey(),raw);
  }catch(_){}
  renderLoadDescEditor(statusText||`已儲存 ${rows.length} 列`);
}
function lcLoadDescriptionState(){
  let rows=null,source='內建預設';
  try{
    const project=localStorage.getItem(lcDescProjectKey());
    const global=localStorage.getItem('s2k-v252-load-desc-global');
    if(project){rows=JSON.parse(project);source='本專案記憶';}
    else if(global){rows=JSON.parse(global);source='最近匯入記憶';}
  }catch(_){}
  lcLoadDescriptions=lcNormalizeDescRows(rows||LC_DESC_DEFAULTS);
  lcEnsureDescriptionPatterns();
  renderLoadDescEditor(`${source}｜${lcLoadDescriptions.length} 列`);
}
function renderLoadDescEditor(statusText){
  const box=$('lc-desc-table'),status=$('lc-desc-status'); if(!box) return;
  if(status) status.textContent=statusText||`${lcLoadDescriptions.length} 列`;
  const widths=['72px','58px','75px','210px'];
  let h='<table style="width:100%;border-collapse:collapse;"><thead><tr>'+
    LC_DESC_HEADERS.map((x,i)=>`<th style="padding:3px;border-bottom:1px solid var(--border);text-align:left;min-width:${widths[i]};">${lcEscape(x)}</th>`).join('')+
    '<th style="width:24px;"></th></tr></thead><tbody>';
  lcLoadDescriptions.forEach((r,i)=>{
    h+='<tr>'+r.map((v,k)=>`<td style="padding:2px;"><input data-i="${i}" data-k="${k}" value="${lcEscape(v)}" style="width:100%;min-width:${widths[k]};background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:3px 4px;font-size:.66rem;"></td>`).join('')+
      `<td><button data-desc-del="${i}" title="刪除此列" style="border:0;background:transparent;color:var(--warn);cursor:pointer;">×</button></td></tr>`;
  });
  box.innerHTML=h+'</tbody></table>';
}
function lcImportDescriptionFile(file){
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array'});
      const preferred=['上構','載重內容描述'].find(n=>wb.SheetNames.includes(n));
      const sheetName=preferred||wb.SheetNames[0];
      const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});
      let hi=aoa.findIndex(r=>r.some(v=>/load\s*pattern|載重.*(型式|樣式|模式)/i.test(String(v))));
      if(hi<0) hi=0;
      const hdr=(aoa[hi]||[]).map(v=>String(v).trim().toLowerCase());
      const col=(rx,fallback)=>{const i=hdr.findIndex(v=>rx.test(v));return i>=0?i:fallback;};
      const idx=[
        col(/^primary$|主要/i,0),
        col(/load\s*case|載重.*案例/i,1),
        col(/load\s*pattern|載重.*(型式|樣式|模式)/i,2),
        col(/description|描述|說明/i,3),
      ];
      const rows=aoa.slice(hi+1).map(r=>idx.map(i=>r[i]??''));
      const clean=lcNormalizeDescRows(rows);
      if(!clean.length) throw new Error('找不到可用的載重描述資料列');
      lcLoadDescriptions=clean; lcEnsureDescriptionPatterns();
      lcSaveDescriptions(`已匯入「${sheetName}」${lcLoadDescriptions.length} 列｜${file.name}`);
    }catch(err){alert('載重內容描述匯入失敗：'+err.message);}
  };
  rd.readAsArrayBuffer(file);
}
/* v2.4.5：桿件「基本單位重」與「自重係數」分離；基本單位重 = 斷面積(m²) × 材料單位重(tf/m³) */
/* v2.4.3：自重係數(selfWtMult)可由使用者於側邊欄手動調整，載入模型時預設帶入 s2k「LOAD PATTERN DEFINITIONS」裡 SelfWtMult>0 的第一筆數值 */
function frameUnitWt(f){
  const s=model.sections[f.sect]; if(!s||!s.area) return 0;
  const mat=model.materials[s.mat]; if(!mat||!mat.unitWt) return 0;
  return s.area*mat.unitWt;
}
function lcDetectSelfWtMult(){
  const p=(model.loadPats||[]).find(p=>p.selfWtMult>0);
  loadCalc.selfWtMult=p?p.selfWtMult:1;
  const inp=$('lc-selfwtmult'), lbl=$('lc-selfwtmult-lbl');
  if(inp) inp.value=loadCalc.selfWtMult;
  if(lbl) lbl.textContent=p?`桿件自重係數 (讀自 ${p.name})`:'桿件自重係數 (模型無此值，預設1)';
}
/* 端點 Z 相同(誤差1mm內)視為水平桿件(梁)，歸屬其樓層；否則視為柱/斜撐，歸屬其下端(柱腳)所在樓層 */
function frameIsHorizontal(f){
  const ji=model.joints[f.i], jj=model.joints[f.j];
  if(!ji||!jj) return true;
  return Math.abs(ji.z-jj.z)<1e-3;
}
/* v2.4.4：柱/斜撐自重改為歸入其下端(柱腳)所在樓層，不再另列不分樓層合計——
   梁：以I端Z判斷樓層；柱/斜撐：取兩端Z較低者(柱腳)判斷樓層，與梁合併計入同一樓層的桿件自重 */
function recalcFrameSelfWt(){
  const floorDetail={};
  if(loadCalc.frameSelfWt && model && model.frames){
    for(const f of model.frames){
      const uw=frameUnitWt(f); const len=f.len||0;
      if(!uw||!len) continue;
      const wt=uw*len*loadCalc.selfWtMult;
      const ji=model.joints[f.i], jj=model.joints[f.j];
      const baseZ=frameIsHorizontal(f)?(ji?ji.z:0):Math.min(ji?ji.z:0,jj?jj.z:0);
      const z=nearestZLevel(baseZ);
      const d=floorDetail[z]||(floorDetail[z]={});
      const e=d[f.sect]||(d[f.sect]={len:0,uw,factor:loadCalc.selfWtMult,wt:0});
      e.len+=len; e.wt+=wt;
    }
  }
  loadCalc.floorFrameDetail=floorDetail;
}
function computeAreaM2(a){
  const pts=a.joints.map(id=>model.joints[id]).filter(Boolean);
  if(pts.length<3) return 0;
  let nx=0,ny=0,nz=0;
  for(let i=0;i<pts.length;i++){
    const p1=pts[i], p2=pts[(i+1)%pts.length];
    nx+=(p1.y-p2.y)*(p1.z+p2.z); ny+=(p1.z-p2.z)*(p1.x+p2.x); nz+=(p1.x-p2.x)*(p1.y+p2.y);
  }
  return 0.5*Math.sqrt(nx*nx+ny*ny+nz*nz);
}
function areaM2(a){return areaM2Cache[a.id]??(areaM2Cache[a.id]=computeAreaM2(a));}
function areaFloorZ(a){
  const pts=a.joints.map(id=>model.joints[id]).filter(Boolean);
  if(!pts.length) return 0;
  return pts.reduce((s,p)=>s+p.z,0)/pts.length;
}
function nearestZLevel(z){
  if(!zLevels.length) return +z.toFixed(3);
  let best=zLevels[0], bd=Math.abs(z-zLevels[0]);
  for(const zl of zLevels){const d=Math.abs(z-zl); if(d<bd){bd=d;best=zl;}}
  return best;
}
function polyArea3D(pts){
  if(pts.length<3) return 0;
  let nx=0,ny=0,nz=0;
  for(let i=0;i<pts.length;i++){
    const p1=pts[i],p2=pts[(i+1)%pts.length];
    nx+=(p1.y-p2.y)*(p1.z+p2.z);
    ny+=(p1.z-p2.z)*(p1.x+p2.x);
    nz+=(p1.x-p2.x)*(p1.y+p2.y);
  }
  return 0.5*Math.sqrt(nx*nx+ny*ny+nz*nz);
}
function clipPolyAtZ(poly,zCut,keepAbove){
  if(!poly.length) return [];
  const eps=1e-8, inside=p=>keepAbove?p.z>=zCut-eps:p.z<=zCut+eps;
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ain=inside(a),bin=inside(b);
    if(ain) out.push(a);
    if(ain!==bin){
      const dz=b.z-a.z;
      if(Math.abs(dz)>eps){
        const t=(zCut-a.z)/dz;
        out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:zCut});
      }
    }
  }
  return out;
}
/* v2.4.5：水平面維持歸屬所在Z；跨樓層面依各樓層帶裁切後的實際3D面積分攤，並歸入該帶下端樓層 */
function areaFloorShares(a){
  const pts=a.joints.map(id=>model.joints[id]).filter(Boolean);
  if(pts.length<3) return [];
  const zs=pts.map(p=>p.z),zMin=Math.min(...zs),zMax=Math.max(...zs),total=polyArea3D(pts);
  if(!total) return [];
  if(zMax-zMin<1e-3) return [{z:nearestZLevel(areaFloorZ(a)),m2:total}];
  const cuts=[zMin,...zLevels.filter(z=>z>zMin+1e-6&&z<zMax-1e-6),zMax].sort((x,y)=>x-y);
  const shares=[];
  for(let i=0;i<cuts.length-1;i++){
    const lo=cuts[i],hi=cuts[i+1];
    let band=clipPolyAtZ(pts,lo,true);
    band=clipPolyAtZ(band,hi,false);
    const m2=polyArea3D(band);
    if(m2>1e-8) shares.push({z:nearestZLevel(lo),m2});
  }
  const sum=shares.reduce((s,e)=>s+e.m2,0);
  if(shares.length&&Math.abs(sum-total)>1e-7) shares[shares.length-1].m2+=total-sum;
  return shares;
}
function lcTypeName(tid){const t=loadCalc.types.find(t=>t.id===tid); return t?t.name:tid;}
function lcEnsureType(name){
  let t=loadCalc.types.find(x=>x.name===name);
  if(!t){t={id:'s2k:'+name,name,lastValue:null};loadCalc.types.push(t);}
  return t;
}
function isWeightLoadDirection(dir){
  const d=String(dir||'').trim().toLowerCase().replace(/\s+/g,'');
  return d==='gravity'||d==='z'||d==='globalz';
}
function lcPreloadS2kLoads(){
  const byPat={};
  for(const l of model.areaLoads){
    if(!l.pat) continue;
    let t=byPat[l.pat];
    if(!t){
      t=lcEnsureType(l.pat);
      byPat[l.pat]=t;
    }
    if(!loadCalc.vals[l.area]) loadCalc.vals[l.area]={};
    loadCalc.vals[l.area][t.id]=(loadCalc.vals[l.area][t.id]||0)+l.v;
  }
  for(const l of model.frameLoads) if(l.pat&&isWeightLoadDirection(l.dir)) lcEnsureType(l.pat);
  renderLcTypeSelect();
  renderLcSectSelect();
  lcDetectSelfWtMult();
  recalcLoadCalc();
}
function lcSectOptions(){
  const counts={};
  for(const a of model.areas) if(a.sect) counts[a.sect]=(counts[a.sect]||0)+1;
  return Object.keys(counts).sort().map(s=>({sect:s,n:counts[s]}));
}
function renderLcSectSelect(){
  const sel=$('lc-sect-select'); if(!sel) return;
  const opts=lcSectOptions();
  sel.innerHTML=opts.length?opts.map(o=>`<option value="${lcEscape(o.sect)}">${lcEscape(o.sect)} (${o.n}面)</option>`).join(''):'<option value="">(無面斷面資料)</option>';
}
function lcEscape(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
initSidebarCollapse();
function frameLoadResultant(l,f){
  const len=f.len||0;
  if(!len) return {len:0,wt:0};
  let loadedLen=0;
  if(/abs/i.test(l.distType||'')){
    const a=Math.max(0,Math.min(len,l.absA||0));
    const b=Math.max(0,Math.min(len,l.absB||0));
    loadedLen=Math.max(0,b-a);
  }else{
    const a=Math.max(0,Math.min(1,isFinite(l.a)?l.a:0));
    const b=Math.max(0,Math.min(1,isFinite(l.b)?l.b:1));
    loadedLen=len*Math.max(0,b-a);
  }
  return {len:loadedLen,wt:loadedLen*((l.va||0)+(l.vb||0))/2};
}
function recalcLineLoads(){
  const detail={},fmap={};
  for(const f of model.frames) fmap[f.id]=f;
  for(const l of model.frameLoads){
    if(!l.pat||!isWeightLoadDirection(l.dir)) continue;
    const f=fmap[l.frame]; if(!f) continue;
    const r=frameLoadResultant(l,f); if(!r.len||!r.wt) continue;
    const t=loadCalc.types.find(x=>x.name===l.pat); if(!t) continue;
    const ji=model.joints[f.i],jj=model.joints[f.j];
    const baseZ=frameIsHorizontal(f)?(ji?ji.z:0):Math.min(ji?ji.z:0,jj?jj.z:0);
    const z=nearestZLevel(baseZ),floor=detail[z]||(detail[z]={});
    const e=floor[t.id]||(floor[t.id]={len:0,wt:0,count:0});
    e.len+=r.len; e.wt+=r.wt; e.count++;
  }
  return detail;
}
function recalcLoadCalc(){
  const floors={},floorM2={},floorAreaDetail={};
  for(const a of model.areas){
    const lv=loadCalc.vals[a.id]; if(!lv) continue;
    for(const share of areaFloorShares(a)){
      const z=share.z,m2=share.m2;
      if(!floors[z]) floors[z]={};
      if(!floorM2[z]) floorM2[z]={};
      if(!floorAreaDetail[z]) floorAreaDetail[z]={};
      for(const tid in lv){
        const wt=m2*lv[tid];
        floors[z][tid]=(floors[z][tid]||0)+wt;
        floorM2[z][tid]=(floorM2[z][tid]||0)+m2;
        const e=floorAreaDetail[z][tid]||(floorAreaDetail[z][tid]={m2:0,wt:0});
        e.m2+=m2; e.wt+=wt;
      }
    }
  }
  const floorLineDetail=recalcLineLoads();
  for(const z of Object.keys(floorLineDetail)){
    if(!floors[z]) floors[z]={};
    for(const tid of Object.keys(floorLineDetail[z])) floors[z][tid]=(floors[z][tid]||0)+floorLineDetail[z][tid].wt;
  }
  loadCalc.floors=floors;
  loadCalc.floorM2=floorM2;
  loadCalc.floorAreaDetail=floorAreaDetail;
  loadCalc.floorLineDetail=floorLineDetail;
  recalcFrameSelfWt();
  renderLoadCalcUI();
  if(loadCalc.colorOn) rebuild();
}
function updateLcSelInfo(){
  const n=loadCalc.selected.size;
  let m2sum=0; loadCalc.selected.forEach(id=>{const a=areaIndex[id]; if(a) m2sum+=areaM2(a);});
  $('lc-sel-info').textContent=n?`已選取 ${n} 個面，總面積 ${m2sum.toFixed(2)} m²`:'尚未選取面';
  $('lc-sel-clear').style.display=n?'inline':'none';
}
function renderLcTypeSelect(){
  const sel=$('lc-type-select'); const cur=sel.value;
  sel.innerHTML=loadCalc.types.length?loadCalc.types.map(t=>`<option value="${t.id}">${lcEscape(t.name)}</option>`).join(''):'<option value="">(尚無載重類型)</option>';
  if(loadCalc.types.some(t=>t.id===cur)) sel.value=cur;
}
function renderLoadCalcTable(){
  const el=$('lc-table'); const floors=loadCalc.floors||{};
  const frameDetail=loadCalc.floorFrameDetail||{};
  const hasFrameSW=!!(loadCalc.frameSelfWt&&Object.keys(frameDetail).length);
  const zSet=new Set([...Object.keys(floors).map(Number),...Object.keys(frameDetail).map(Number)]);
  const zKeys=[...zSet].sort((a,b)=>b-a);
  if(!zKeys.length||(!loadCalc.types.length&&!hasFrameSW)){el.innerHTML='尚無資料，請先選面套用載重';return;}
  const tids=loadCalc.types.map(t=>t.id);
  const floorFrameWt=z=>Object.values(frameDetail[z]||{}).reduce((s,e)=>s+e.wt,0);
  let h='<table style="width:100%;border-collapse:collapse;"><tr><th style="text-align:left;padding:3px 4px;border-bottom:1px solid var(--border);">樓層Z</th>'+
    tids.map(tid=>`<th style="text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);">${lcEscape(lcTypeName(tid))}</th>`).join('')+
    (hasFrameSW?'<th style="text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);">桿件自重</th>':'')+
    '<th style="text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);">合計</th></tr>';
  const grand={}; let grandTotal=0, grandFrame=0;
  for(const z of zKeys){
    const row=floors[z]||{}; let rowTotal=0;
    h+=`<tr><td style="padding:3px 4px;">${fmt(z)}</td>`;
    for(const tid of tids){
      const v=row[tid]||0,aw=loadCalc.floorAreaDetail[z]?.[tid]?.wt||0,lw=loadCalc.floorLineDetail[z]?.[tid]?.wt||0;
      const trace=v?`面載 ${aw.toFixed(2)} tf + 線載 ${lw.toFixed(2)} tf`:'';
      rowTotal+=v; grand[tid]=(grand[tid]||0)+v;
      h+=`<td title="${trace}" style="text-align:right;padding:3px 4px;">${v?v.toFixed(2):'—'}</td>`;
    }
    if(hasFrameSW){const fw=floorFrameWt(z); rowTotal+=fw; grandFrame+=fw; h+=`<td style="text-align:right;padding:3px 4px;">${fw?fw.toFixed(2):'—'}</td>`;}
    grandTotal+=rowTotal;
    h+=`<td style="text-align:right;padding:3px 4px;font-weight:600;">${rowTotal.toFixed(2)}</td></tr>`;
  }
  h+=`<tr style="border-top:2px solid var(--border);"><td style="padding:3px 4px;font-weight:700;">總計</td>`+
    tids.map(tid=>`<td style="text-align:right;padding:3px 4px;font-weight:700;">${(grand[tid]||0).toFixed(2)}</td>`).join('')+
    (hasFrameSW?`<td style="text-align:right;padding:3px 4px;font-weight:700;">${grandFrame.toFixed(2)}</td>`:'')+
    `<td style="text-align:right;padding:3px 4px;font-weight:700;color:var(--accent);">${grandTotal.toFixed(2)}</td></tr></table>`;
  el.innerHTML=h;
}
function renderLoadCalcUI(){ updateLcSelInfo(); renderLoadCalcTable(); }
/* v2.4.2：新增「建築裝修額外重量表」(沿用專案既有裝修規格，僅供參考，不代入計算)與「樓層高程表」「桿件斷面單位重明細表」(皆自動由模型算出)；
   逐樓層改為「構件/數量/單位重/Sum」明細表版面，比照人工建築自重計算書格式；
   柱/斜撐因跨樓層另列「COL & others」不分樓層合計區塊(比照人工計算書慣例) */
const FINISH_MATERIALS=[
  ['隔熱層',0.05,'○','-','-','-','-','-'],
  ['水泥砂漿粉底',0.04,'○','○','○','○','○','○'],
  ['防水鋪面材',0.007,'○','-','-','-','-','-'],
  ['防水保護層',0.15,'○','-','-','-','-','-'],
  ['裝飾鋪面材',0.03,'○','○','-','-','-','○'],
  ['天花板及管線',0.024,'○','○','-','-','-','-'],
];
function lcDescriptionWorksheet(){
  const rows=lcNormalizeDescRows(lcLoadDescriptions);
  const ws=XLSX.utils.aoa_to_sheet([LC_DESC_HEADERS,...rows]);
  ws['!cols']=[{wch:14},{wch:14},{wch:17},{wch:54}];
  for(let c=0;c<4;c++) _sty(ws,0,c,{
    font:{name:XF,bold:true,sz:10,color:{rgb:'FFFFFF'}},
    fill:{fgColor:{rgb:'1F4E78'}},
    alignment:{horizontal:'center',vertical:'center'},
    border:{top:{style:'thin',color:{rgb:'AFC6D9'}},bottom:{style:'thin',color:{rgb:'AFC6D9'}},left:{style:'thin',color:{rgb:'AFC6D9'}},right:{style:'thin',color:{rgb:'AFC6D9'}}}
  });
  for(let r=1;r<=rows.length;r++) for(let c=0;c<4;c++) _sty(ws,r,c,{
    font:{name:XF,sz:9},
    fill:{fgColor:{rgb:c===2?'E2F0D9':(c<2?'F2F2F2':'FFFFFF')}},
    alignment:{horizontal:c===3?'left':'center',vertical:'center',wrapText:c===3},
    border:{top:{style:'thin',color:{rgb:'D9E2F3'}},bottom:{style:'thin',color:{rgb:'D9E2F3'}},left:{style:'thin',color:{rgb:'D9E2F3'}},right:{style:'thin',color:{rgb:'D9E2F3'}}}
  });
  ws['!autofilter']={ref:`A1:D${rows.length+1}`};
  return ws;
}
function lcExportXlsx(){
  const floors=loadCalc.floors||{},areaDetail=loadCalc.floorAreaDetail||{},lineDetail=loadCalc.floorLineDetail||{};
  const frameDetail=loadCalc.floorFrameDetail||{};
  const hasFrameSW=!!(loadCalc.frameSelfWt&&Object.keys(frameDetail).length);
  const zSet=new Set([...Object.keys(floors).map(Number),...Object.keys(frameDetail).map(Number)]);
  const zKeys=[...zSet].sort((a,b)=>b-a);
  if(!zKeys.length){alert('尚無資料可匯出，請先選面套用載重或勾選桿件自重');return;}
  const head=['構件','來源','數量','單位','單位重','係數','Sum(tf)'];
  const HEAD_MAX=8;
  const aoa=[['建築物自重計算 樓層載重試算表 Floor Load Calculator'],
    ['面載：依實際3D面積計算，跨樓層面依樓層帶實際面積分攤至下端樓層；線載：依桿件分布載重之載入長度與梯形平均單位載重計算；桿件自重：斷面積×材料單位重×獨立自重係數。面載、線載及桿件自重均保留公式，可在Excel修改後重算。'],
    []];
  const titleRows=[],headRows=[],sumRows=[];
  const libRowOf={}; let libList=[];
  const frameDataRows=[],areaDataRows=[],lineDataRows=[];
  const blockRanges=[];
  let grandTotal=0;

  aoa.push(['控制參數 Calculation Controls']); titleRows.push(aoa.length-1);
  aoa.push(['參數','數值','說明']); headRows.push(aoa.length-1);
  aoa.push(['桿件自重係數',+loadCalc.selfWtMult.toFixed(4),'僅作用於桿件自重；面載及線載係數固定為1.0']);
  const selfWtFactorRow=aoa.length-1;
  aoa.push([]);

  aoa.push(['建築裝修額外重量表 Finish Material Weights（沿用專案既有裝修規格，僅供參考比對，不代入下方自動計算）']); titleRows.push(aoa.length-1);
  aoa.push(['項目','單位重(tf/m²)','屋頂板','室內/外樓板','柱','梁','室內牆','室外牆']); headRows.push(aoa.length-1);
  for(const row of FINISH_MATERIALS) aoa.push(row);
  aoa.push([]);
  if(zLevels&&zLevels.length){
    aoa.push(['樓層高程表 Floor Elevation（依模型節點座標自動判斷）']); titleRows.push(aoa.length-1);
    aoa.push(['樓層 Z(m)','樓高(m)']); headRows.push(aoa.length-1);
    const zdesc=[...zLevels].sort((a,b)=>b-a);
    for(let i=0;i<zdesc.length;i++){
      const h=i<zdesc.length-1?+(zdesc[i]-zdesc[i+1]).toFixed(3):'';
      aoa.push([+zdesc[i].toFixed(3),h]);
    }
    aoa.push([]);
  }
  if(hasFrameSW){
    const usedSects={};
    for(const f of model.frames){
      const uw=frameUnitWt(f); if(!uw||usedSects[f.sect]) continue;
      const s=model.sections[f.sect]||{},mat=model.materials[s.mat]||{};
      usedSects[f.sect]={sect:f.sect,mat:s.mat,area:s.area||0,matUw:mat.unitWt||0,uw};
    }
    libList=Object.values(usedSects).sort((a,b)=>a.sect.localeCompare(b.sect));
    if(libList.length){
      aoa.push(['桿件斷面基本單位重明細表 Frame Section Base Unit Weight（未乘自重係數）']); titleRows.push(aoa.length-1);
      aoa.push(['斷面名稱','材料','斷面積(m²)','材料單位重(tf/m³)','基本單位重(tf/m)']); headRows.push(aoa.length-1);
      for(const e of libList){aoa.push([e.sect,e.mat,+e.area.toFixed(5),+e.matUw.toFixed(3),+e.uw.toFixed(4)]);libRowOf[e.sect]=aoa.length-1;}
      aoa.push([]);
    }
  }
  for(const z of zKeys){
    aoa.push([`樓層 Z=${fmt(z)}`]); titleRows.push(aoa.length-1);
    aoa.push(head.slice()); headRows.push(aoa.length-1);
    let floorTotal=0; const blockFirst=aoa.length;
    const ad=areaDetail[z]||{},ld=lineDetail[z]||{};
    for(const t of loadCalc.types){
      const ae=ad[t.id];
      if(ae&&ae.wt){
        const uw=ae.m2?ae.wt/ae.m2:0;
        aoa.push([t.name,'面載',+ae.m2.toFixed(3),'m²',+uw.toFixed(4),1,+ae.wt.toFixed(3)]);
        areaDataRows.push(aoa.length-1); floorTotal+=ae.wt;
      }
      const le=ld[t.id];
      if(le&&le.wt){
        const uw=le.len?le.wt/le.len:0;
        aoa.push([t.name,'線載',+le.len.toFixed(3),'m',+uw.toFixed(4),1,+le.wt.toFixed(3)]);
        lineDataRows.push(aoa.length-1); floorTotal+=le.wt;
      }
    }
    if(hasFrameSW){
      const d=frameDetail[z]||{};
      for(const sect of Object.keys(d)){
        const e=d[sect];
        aoa.push([sect,'桿件自重',+e.len.toFixed(3),'m',+e.uw.toFixed(4),+loadCalc.selfWtMult.toFixed(4),+e.wt.toFixed(3)]);
        frameDataRows.push({row:aoa.length-1,sect});
        floorTotal+=e.wt;
      }
    }
    const blockLast=aoa.length-1;
    aoa.push(['','','','','','SUM =',+floorTotal.toFixed(3)]); sumRows.push(aoa.length-1);
    if(blockLast>=blockFirst) blockRanges.push({sumRow:aoa.length-1,first:blockFirst,last:blockLast});
    aoa.push([]);
    grandTotal+=floorTotal;
  }
  aoa.push(['總計 Grand Total','','','','','',+grandTotal.toFixed(3)]);
  const grandRow=aoa.length-1;
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:26},{wch:12},{wch:14},{wch:10},{wch:14},{wch:10},{wch:12},{wch:10}];
  ws['!merges']=[...titleRows.map(r=>({s:{r,c:0},e:{r,c:HEAD_MAX-1}})),{s:{r:grandRow,c:0},e:{r:grandRow,c:head.length-2}}];
  _sty(ws,0,0,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0F2747'}}});
  for(const r of titleRows) for(let c=0;c<HEAD_MAX;c++) _sty(ws,r,c,{font:{name:XF,bold:true,sz:10,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1F3B57'}}});
  for(const r of headRows) for(let c=0;c<HEAD_MAX;c++) _sty(ws,r,c,{font:{name:XF,bold:true,sz:9,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'305496'}},alignment:{horizontal:c===0?'left':'center'}});
  for(const r of sumRows) for(let c=0;c<head.length;c++) _sty(ws,r,c,{font:{name:XF,bold:true,sz:9},fill:{fgColor:{rgb:'FCE4D6'}}});
  for(let c=0;c<head.length;c++) _sty(ws,grandRow,c,{font:{name:XF,bold:true,sz:11},fill:{fgColor:{rgb:'E2EFDA'}}});
  _sty(ws,selfWtFactorRow,1,{font:{name:XF,bold:true,color:{rgb:'9C5700'}},fill:{fgColor:{rgb:'FFF2CC'}}});

  const addr=(r,c)=>XLSX.utils.encode_cell({r,c});
  for(const e of libList) if(libRowOf[e.sect]!=null){
    const r=libRowOf[e.sect];
    _fml(ws,r,4,`=${addr(r,2)}*${addr(r,3)}`,aoa[r][4]);
  }
  for(const {row:r,sect} of frameDataRows){
    const libRow=libRowOf[sect];
    if(libRow!=null) _fml(ws,r,4,`=${addr(libRow,4)}`,aoa[r][4]);
    _fml(ws,r,5,`=$B$${selfWtFactorRow+1}`,aoa[r][5]);
    _fml(ws,r,6,`=${addr(r,2)}*${addr(r,4)}*${addr(r,5)}`,aoa[r][6]);
  }
  for(const r of [...areaDataRows,...lineDataRows]) _fml(ws,r,6,`=${addr(r,2)}*${addr(r,4)}*${addr(r,5)}`,aoa[r][6]);
  for(const {sumRow:r,first,last} of blockRanges) _fml(ws,r,6,`=SUM(${addr(first,6)}:${addr(last,6)})`,aoa[r][6]);
  if(sumRows.length) _fml(ws,grandRow,6,`=SUM(${sumRows.map(r=>addr(r,6)).join(',')})`,aoa[grandRow][6]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'樓層載重加總');
  XLSX.utils.book_append_sheet(wb,lcDescriptionWorksheet(),'載重內容描述');
  XLSX.writeFile(wb,'樓層載重試算.xlsx');
}
(function(){
  const btnPick=$('lc-pickmode');
  function setPickMode(on){
    loadCalc.pickMode=on;
    btnPick.textContent=on?'■ 結束選取面 (Esc)':'🖱 開始選取面';
    btnPick.classList.toggle('picking',on);
  }
  btnPick.addEventListener('click',()=>setPickMode(!loadCalc.pickMode));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&loadCalc.pickMode) setPickMode(false);});
  $('lc-sel-clear').addEventListener('click',()=>{loadCalc.selected.clear();updateLcSelInfo();rebuild();});
  $('lc-sect-selectall').addEventListener('click',()=>{
    const sect=$('lc-sect-select').value; if(!sect) return;
    model.areas.forEach(a=>{if(a.sect===sect) loadCalc.selected.add(a.id);});
    updateLcSelInfo(); rebuild();
  });
  $('lc-newtype-add').addEventListener('click',()=>{
    const name=$('lc-newtype-name').value.trim();
    if(!name) return;
    let t=loadCalc.types.find(t=>t.name===name);
    if(!t){t={id:'lt'+(loadCalc.nextId++),name,lastValue:null}; loadCalc.types.push(t);}
    renderLcTypeSelect(); $('lc-type-select').value=t.id; $('lc-newtype-name').value='';
    if(t.lastValue!=null) $('lc-unitweight').value=t.lastValue;
  });
  $('lc-type-del').addEventListener('click',()=>{
    const tid=$('lc-type-select').value; if(!tid) return;
    const t=loadCalc.types.find(t=>t.id===tid);
    if(!confirm(`確定刪除載重類型「${t?t.name:tid}」？已套用此類型的面將移除該筆資料。`)) return;
    loadCalc.types=loadCalc.types.filter(t=>t.id!==tid);
    for(const id in loadCalc.vals){delete loadCalc.vals[id][tid]; if(!Object.keys(loadCalc.vals[id]).length) delete loadCalc.vals[id];}
    renderLcTypeSelect(); recalcLoadCalc();
  });
  $('lc-type-select').addEventListener('change',()=>{
    const t=loadCalc.types.find(t=>t.id===$('lc-type-select').value);
    $('lc-unitweight').value=(t&&t.lastValue!=null)?t.lastValue:'';
  });
  $('lc-apply').addEventListener('click',()=>{
    const tid=$('lc-type-select').value;
    if(!tid){alert('請先新增或選擇一個載重類型');return;}
    const w=parseFloat($('lc-unitweight').value);
    if(!isFinite(w)){alert('請輸入有效的單位重數值');return;}
    if(!loadCalc.selected.size){alert('請先在 3D 畫面點選面');return;}
    loadCalc.selected.forEach(id=>{if(!loadCalc.vals[id])loadCalc.vals[id]={}; loadCalc.vals[id][tid]=w;});
    const t=loadCalc.types.find(t=>t.id===tid); if(t) t.lastValue=w;
    loadCalc.selected.clear();
    recalcLoadCalc(); updateLcSelInfo(); rebuild();
  });
  $('lc-clear').addEventListener('click',()=>{
    const tid=$('lc-type-select').value;
    if(!tid){alert('請先選擇要清除的載重類型');return;}
    if(!loadCalc.selected.size){alert('請先在 3D 畫面點選面');return;}
    loadCalc.selected.forEach(id=>{if(loadCalc.vals[id]){delete loadCalc.vals[id][tid]; if(!Object.keys(loadCalc.vals[id]).length) delete loadCalc.vals[id];}});
    loadCalc.selected.clear();
    recalcLoadCalc(); updateLcSelInfo(); rebuild();
  });
  $('tg-loadcalc').addEventListener('change',e=>{loadCalc.colorOn=e.target.checked; rebuild();});
  $('lc-frame-selfwt').addEventListener('change',e=>{loadCalc.frameSelfWt=e.target.checked; recalcLoadCalc();});
  $('lc-selfwtmult').addEventListener('input',e=>{
    const v=parseFloat(e.target.value); loadCalc.selfWtMult=isFinite(v)?v:1; recalcLoadCalc();
  });
  $('lc-export').addEventListener('click',lcExportXlsx);
  $('lc-desc-import').addEventListener('click',()=>$('lc-desc-file').click());
  $('lc-desc-file').addEventListener('change',e=>{
    const file=e.target.files&&e.target.files[0];
    if(file) lcImportDescriptionFile(file);
    e.target.value='';
  });
  $('lc-desc-add').addEventListener('click',()=>{
    lcLoadDescriptions.push(['','','','新載重描述']);
    lcSaveDescriptions(`已新增空白列｜共 ${lcLoadDescriptions.length} 列`);
    $('lc-desc-details').open=true;
  });
  $('lc-desc-reset').addEventListener('click',()=>{
    if(!confirm('確定將載重內容描述重設為內建預設？')) return;
    lcLoadDescriptions=LC_DESC_DEFAULTS.map(r=>r.slice());
    lcEnsureDescriptionPatterns();
    lcSaveDescriptions(`已重設為內建預設｜${lcLoadDescriptions.length} 列`);
  });
  $('lc-desc-table').addEventListener('input',e=>{
    const i=+(e.target.dataset.i??-1),k=+(e.target.dataset.k??-1);
    if(i<0||k<0||!lcLoadDescriptions[i]) return;
    lcLoadDescriptions[i][k]=e.target.value;
    try{
      const raw=JSON.stringify(lcLoadDescriptions);
      localStorage.setItem('s2k-v252-load-desc-global',raw);
      localStorage.setItem(lcDescProjectKey(),raw);
    }catch(_){}
    $('lc-desc-status').textContent=`編輯已自動儲存｜${lcLoadDescriptions.length} 列`;
  });
  $('lc-desc-table').addEventListener('click',e=>{
    const raw=e.target.dataset.descDel;
    if(raw===undefined) return;
    lcLoadDescriptions.splice(+raw,1);
    lcSaveDescriptions(`已刪除一列｜剩 ${lcLoadDescriptions.length} 列`);
  });
})();

/* ── sprite label ── */
function makeLabel(text,color,pos,scale=0.8){
  const c=document.createElement('canvas');
  const ctx=c.getContext('2d');
  const fs=42;
  ctx.font=`600 ${fs}px Consolas,monospace`;
  const w=Math.ceil(ctx.measureText(text).width)+16;
  c.width=w; c.height=fs+14;
  const ctx2=c.getContext('2d');
  ctx2.font=`600 ${fs}px Consolas,monospace`;
  ctx2.fillStyle=color; ctx2.textBaseline='middle';
  ctx2.fillText(text,8,c.height/2);
  const tex=new THREE.CanvasTexture(c);
  tex.minFilter=THREE.LinearFilter;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.scale.set(scale*labelScale*c.width/c.height,scale*labelScale,1);
  sp.position.copy(pos);
  return sp;
}
/* v2.0.1：格線標籤改 SAP2000 泡泡樣式(圓圈框住格線代號) */
function makeGridBubble(text,color,pos,scale=0.8){
  const c=document.createElement('canvas');
  const ctx=c.getContext('2d');
  const fs=34;
  ctx.font=`600 ${fs}px Consolas,monospace`;
  const d=Math.max(Math.ceil(ctx.measureText(text).width)+22,fs+16);
  c.width=d; c.height=d;
  const ctx2=c.getContext('2d');
  ctx2.strokeStyle=color; ctx2.lineWidth=2.2;
  ctx2.beginPath(); ctx2.arc(d/2,d/2,d/2-2,0,Math.PI*2); ctx2.stroke();
  ctx2.font=`600 ${fs}px Consolas,monospace`;
  ctx2.fillStyle=color; ctx2.textAlign='center'; ctx2.textBaseline='middle';
  ctx2.fillText(text,d/2,d/2+1);
  const tex=new THREE.CanvasTexture(c);
  tex.minFilter=THREE.LinearFilter;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.scale.set(scale*labelScale,scale*labelScale,1);
  sp.position.copy(pos);
  return sp;
}

function fitCamera(){
  const r=modelRadius*1.35;
  camera.position.copy(modelCenter).add(new THREE.Vector3(r*0.8,r*0.65,r*0.8));
  camera.near=Math.max(r/500,0.05); camera.far=r*30; camera.updateProjectionMatrix();
  controls.target.copy(modelCenter); controls.update();
}
$('btn-fit').addEventListener('click',fitCamera);

/* ════════ PICKING ════════ */
let raycaster, mouseV=new THREE.Vector2(), downPos=null;
function initPicking(){
  raycaster=new THREE.Raycaster();
  raycaster.params.Line.threshold=0.12;
  raycaster.params.Points.threshold=0.18;
  const el=renderer.domElement;
  let hoverTimer=null;
  el.addEventListener('pointermove',e=>{
    if(hoverTimer) return;
    hoverTimer=setTimeout(()=>{hoverTimer=null;doHover(e);},40);
  });
  el.addEventListener('pointerdown',e=>{downPos=[e.clientX,e.clientY];});
  el.addEventListener('pointerup',e=>{
    if(!downPos) return;
    const dx=e.clientX-downPos[0],dy=e.clientY-downPos[1];
    downPos=null;
    if(dx*dx+dy*dy<25) doPick(e);
  });
}
function castAt(e){
  const r=renderer.domElement.getBoundingClientRect();
  mouseV.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
  raycaster.setFromCamera(mouseV,activeCam);
  const hits=raycaster.intersectObjects(pickables,false);
  return hits.length?hits[0]:null;
}
function doHover(e){
  const tip=$('tip');
  const hit=castAt(e);
  if(!hit){tip.style.display='none';return;}
  const u=hit.object.userData;
  let html='';
  if(u.type==='frame'){
    const f=u.ref, s=model.sections[f.sect]||{};
    html=`<div class="t">桿件 ${f.id}</div>${f.sect||'—'} · ${s.mat||''}<br>L = ${f.len.toFixed(2)} m`;
    if(scwbState&&scwbState.active){const _si=scwbState.frameInfo(f); if(_si) html+=`<br>強柱弱梁 ${_si}`;}
  }else if(u.type==='area'){
    const a=u.ref, s=model.areaSections[a.sect]||{};
    html=`<div class="t">面 ${a.id}</div>${a.sect||'—'} · t=${s.th??'?'} m`;
  }else if(u.type==='joints'){
    const j=u.list[hit.index];
    if(j){ let ph=(pjzData&&pjzData.res[j.id])?pjzHoverHTML(j.id):null;
      let sh=(scwbData&&scwbData.res[j.id])?scwbHoverHTML(j.id):null;
      html=(ph&&sh)?(ph+'<div style="height:6px;"></div>'+sh):(ph||sh)||`<div class="t">節點 ${j.id}</div>(${j.x.toFixed(2)}, ${j.y.toFixed(2)}, ${j.z.toFixed(2)})`; }
  }
  if(!html){tip.style.display='none';return;}
  tip.innerHTML=html;
  tip.style.display='block';
  const vr=$('viewport').getBoundingClientRect();
  const _tr=tip.getBoundingClientRect();
  let _l=e.clientX-vr.left+14, _t=e.clientY-vr.top+10;
  if(_l+_tr.width>vr.width-6) _l=Math.max(4,e.clientX-vr.left-_tr.width-14);
  if(_t+_tr.height>vr.height-6) _t=Math.max(4,vr.height-_tr.height-6);
  tip.style.left=_l+'px'; tip.style.top=_t+'px';
}
function doPick(e){
  const hit=castAt(e);
  if(loadCalc.pickMode){
    if(hit&&hit.object.userData.type==='area'){
      const id=hit.object.userData.ref.id;
      if(loadCalc.selected.has(id)) loadCalc.selected.delete(id); else loadCalc.selected.add(id);
      updateLcSelInfo(); rebuild();
    }
    return;
  }
  const prop=$('prop');
  if(!hit){prop.classList.remove('on');return;}
  const u=hit.object.userData;
  let html='';
  const pr=(k,v)=>`<div class="pr"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  if(u.type==='frame'){
    const f=u.ref, s=model.sections[f.sect]||{};
    const ji=model.joints[f.i], jj=model.joints[f.j];
    html=`<h3>桿件 ${f.id}<span class="x" id="prop-x">✕</span></h3>`;
    html+=pr('斷面',f.sect||'—')+pr('形狀',s.shape||'—')+pr('材料',s.mat||'—');
    if(s.t3) html+=pr('尺寸 t3×t2',`${s.t3}×${s.t2}`+(s.tf?` (tf=${s.tf}, tw=${s.tw})`:''));
    html+=pr('長度',f.len.toFixed(3)+' m');
    html+=pr('節點 I',`${f.i} (${ji.x.toFixed(1)}, ${ji.y.toFixed(1)}, ${ji.z.toFixed(1)})`);
    html+=pr('節點 J',`${f.j} (${jj.x.toFixed(1)}, ${jj.y.toFixed(1)}, ${jj.z.toFixed(1)})`);
    if(f.angle) html+=pr('旋轉角',f.angle+'°');
    if(scwbState&&scwbState.active){const _si=scwbState.frameInfo(f); if(_si) html+=pr('強柱弱梁',_si);}
    if(f.groups.length) html+=pr('群組',f.groups.join(', '));
    const rel=model.releases[f.id];
    if(rel){
      const codes=['PI','V2I','V3I','TI','M2I','M3I','PJ','V2J','V3J','TJ','M2J','M3J'].filter(c=>rel.raw[c]==='Yes');
      html+=pr('端部釋放',codes.join(', ')||'—');
    }
    const loads=model.frameLoads.filter(l=>l.frame===f.id);
    if(loads.length){
      html+=`<div class="pgroup">桿件載重</div>`;
      for(const l of loads) html+=pr(l.pat,`${l.dir} ${fmt(l.va)}${l.va!==l.vb?'~'+fmt(l.vb):''}`);
    }
    const ow=model.overwrites[f.id];
    if(ow){
      const items=Object.entries(ow).filter(([k,v])=>k!=='Frame'&&v!=='Program Determined'&&v!=='0'&&+v!==0);
      if(items.length){
        html+=`<div class="pgroup">設計覆寫（${model.owCode}）</div>`;
        for(const [k,v] of items) html+=pr(k,v);
      }
    }
  }else if(u.type==='area'){
    const a=u.ref, s=model.areaSections[a.sect]||{};
    html=`<h3>面 ${a.id}<span class="x" id="prop-x">✕</span></h3>`;
    html+=pr('斷面',a.sect||'—')+pr('類型',s.type||'—')+pr('材料',s.mat||'—')+pr('厚度',(s.th??'?')+' m');
    html+=pr('節點',a.joints.join(', '));
    const loads=model.areaLoads.filter(l=>l.area===a.id);
    if(loads.length){
      html+=`<div class="pgroup">面載重</div>`;
      for(const l of loads) html+=pr(l.pat,`${l.dir} ${fmt(l.v)}${l.dist?' ('+l.dist+')':''}`);
    }
  }else if(u.type==='joints'){
    const j=u.list[hit.index];
    if(!j){prop.classList.remove('on');return;}
    html=`<h3>節點 ${j.id}<span class="x" id="prop-x">✕</span></h3>`;
    html+=pr('X',j.x.toFixed(3))+pr('Y',j.y.toFixed(3))+pr('Z',j.z.toFixed(3));
    const r=model.restraints[j.id];
    if(r){html+=pr('支承',['U1','U2','U3','R1','R2','R3'].filter((_,i)=>r[i]).join(', ')||'—');html+=`<button class="prop-foundation-btn" data-foundation-joint="${j.id}">建立／編輯此 Joint 基礎</button>`;}
    const c=model.constraints[j.id];
    if(c) html+=pr('束制',c.join(', '));
    if(pjzData&&pjzData.res[j.id]){const pi=pjzJointInfo(j.id); if(pi) html+=pr('交會區 13.6.2',pi);}
    if(scwbData&&scwbData.res[j.id]){const sr=scwbData.res[j.id];
      html+=pr('強柱弱梁',(sr.rX!=null?sr.rX.toFixed(2):'—')+' / '+(sr.rY!=null?sr.rY.toFixed(2):'—')+' (X/Y'+(sr.top?'，頂層':'')+')'+(sr.verdict&&sr.verdict!=='OK'?'　'+sr.verdict:''));}
  }
  prop.innerHTML=html;
  prop.classList.add('on');
  $('prop-x')?.addEventListener('click',()=>prop.classList.remove('on'));
  prop.querySelector('[data-foundation-joint]')?.addEventListener('click',ev=>openFoundationWorkspace(ev.currentTarget.dataset.foundationJoint));
}

/* ════════ DATA TABLE VIEWER ════════ */
function buildTableDropdown(){
  const sel=$('tbl-select');
  sel.innerHTML='';
  for(const [name,rows] of Object.entries(tables)){
    const o=document.createElement('option');o.value=name;o.textContent=`${name} (${rows.length})`;sel.appendChild(o);
  }
  sel.addEventListener('change',()=>renderTable());
  $('tbl-search').addEventListener('input',()=>renderTable());
}
function renderTable(){
  const name=$('tbl-select').value;
  const rows=tables[name]||[];
  const q=$('tbl-search').value.trim().toLowerCase();
  const cols=[];
  const seen=new Set();
  for(const r of rows) for(const k of Object.keys(r)) if(!seen.has(k)){seen.add(k);cols.push(k);}
  const filtered=q?rows.filter(r=>cols.some(c=>String(r[c]??'').toLowerCase().includes(q))):rows;
  const CAP=2000;
  $('dt-head').innerHTML='<tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr>';
  $('dt-body').innerHTML=filtered.slice(0,CAP).map(r=>'<tr>'+cols.map(c=>`<td>${r[c]??''}</td>`).join('')+'</tr>').join('');
  $('tp-stats').textContent=`${filtered.length} / ${rows.length} 列`+(filtered.length>CAP?`（僅顯示前 ${CAP} 列）`:'');
}
$('btn-table').addEventListener('click',()=>{$('tablep').classList.add('on');renderTable();});
$('btn-table-close').addEventListener('click',()=>$('tablep').classList.remove('on'));
$('btn-reset').addEventListener('click',()=>location.reload());
$('btn-theme').addEventListener('click',()=>{
  const isLight=document.documentElement.classList.toggle('light-theme');
  $('btn-theme').textContent=isLight?'☀️':'🌙';
  if(scene) scene.background.setHex(isLight?0xf5f6f8:0x14171c);
  rebuild(false);
});

/* display toggles → rebuild */
['tg-frames','tg-extrude','tg-areas','tg-joints','tg-supports','tg-releases','tg-grid','tg-flabels','tg-jlabels']
  .forEach(id=>$(id).addEventListener('change',()=>rebuild(false)));
$('lbl-size').addEventListener('input',()=>$('lbl-size-v').textContent=(+$('lbl-size').value).toFixed(1));
$('lbl-size').addEventListener('change',()=>rebuild(false));

// 頂部圓角按鈕點擊連動隱藏的 checkbox
document.querySelectorAll('.display-toolbar .toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const chk = $(targetId);
    if (chk) {
      const active = btn.classList.toggle('active');
      chk.checked = active;
      chk.dispatchEvent(new Event('change'));
    }
  });
});

// 設計檢核選單切換
$('check-selector').addEventListener('change', (e) => {
  const val = e.target.value;
  if (val === 'scwb') {
    $('content-scwb').classList.add('active');
    $('content-pjz').classList.remove('active');
  } else {
    $('content-pjz').classList.add('active');
    $('content-scwb').classList.remove('active');
  }
});

// 新手引導教學步驟資料
const guideSteps = [
  {
    title: "1. 拖放載入 .s2k 檔案",
    target: "#drop-screen",
    text: "首頁是檔案載入區。在此直接拖放 SAP2000 匯出的 <b>.s2k / .$2k</b> 檔案，或是點擊選擇檔案，即可快速載入 3D 模型。相容舊版 v9 以及新版 v22 ~ v27+ 模型.s2k檔。"
  },
  {
    title: "2. 頂部顯示快捷控制",
    target: "#display-toolbar",
    text: "常用的顯示開關在頂部的「圓角膠囊按鈕」包含<b>桿件、實體擠出、面元素、節點、支承、端部釋放、格線、桿件標籤與節點標籤</b>，點擊反白即可即時開關切換。"
  },
  {
    title: "3. 3D 視訊主畫布",
    target: "#viewport",
    text: "3D 互動。使用 <b>滑鼠左鍵拖曳 旋轉</b>，<b>滑鼠右鍵拖曳 平移</b>，<b>滾輪 縮放</b>。"
  },
  {
    title: "4. 視圖與標籤控制",
    target: "#sidebar [data-guide='view']",
    text: "側邊欄的「視圖與標籤」可以快速在 <b>3D 全景</b>、<b>平面圖 (Z 樓層)</b>、<b>X 立面</b>、<b>Y 立面</b> 之間切換。滑動「標籤文字大小」滑桿，可動態調節標籤與氣泡尺寸。"
  },
  {
    title: "5. 設計參數與配色",
    target: "#sidebar [data-guide='design-input']",
    text: "<b>【注意】</b>本程式僅顯示有被覆寫（Overwrite）的參數，若無特別覆寫修改則會呈現黑色並標記為「程式決定」。這是因為本檢視器為求檔案輕量，僅載入 Model Definition 資料，無法讀取 SAP2000 完整設計分析後的內部隱藏設計參數。"
  },
  {
    title: "6. 設計檢核大卡片",
    target: "#check-card",
    text: "在此下拉選單可切換<b>強柱弱梁檢核</b>與<b>梁柱交會區檢核</b>。載入柱軸力檔後，系統會自動在 3D 模型上以高對比顏色標記出檢核判定（OK/NG/豁免），並支援<b>一鍵匯出符合台灣極限設計規範的 Excel 計算書</b>！"
  },
  {
    title: "7. 滑鼠懸浮提示卡 (Tooltip)",
    target: "#tip",
    text: "當滑鼠懸浮在 3D 模型中的任何桿件、節點或面元素上時，會顯示卡片，即時展示其幾何規格或檢核比值。<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;'><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_01.png' style='width:100%;height:120px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>桿件提示 (Tooltip)</div></div><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_02.png' style='width:100%;height:120px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>節點提示 (Tooltip)</div></div><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_03.png' style='width:100%;height:120px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>面元素提示 (Tooltip)</div></div></div>"
  },
  {
    title: "8. 點擊查閱詳細屬性 (Properties)",
    target: "#prop",
    text: "滑鼠點選任何構材，會在右側彈出詳細屬性面板，可在此深究其長度、斷面幾何尺寸、鋼材與面載重工況。<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;'><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_04.png' style='width:100%;height:180px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>桿件屬性 (Properties)</div></div><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_05.png' style='width:100%;height:180px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>節點屬性 (Properties)</div></div><div style='text-align:center;background:var(--panel2);padding:8px;border-radius:6px;border:1px solid var(--border);'><img src='images/guide_06.png' style='width:100%;height:180px;object-fit:contain;border-radius:4px;'><div style='font-size:0.75rem;color:var(--dim);margin-top:6px;font-weight:600;'>面屬性 (Properties)</div></div></div>"
  },
  {
    title: "9. 查看檢核的計算過程細節",
    target: "#check-card",
    text: "在執行檢核後，若想查看檢核的計算過程細節，<b>建議關閉桿件與面元素顯示，僅開啟「節點」</b>，游標懸浮在節點上即可直接查閱完整的<b>公式代入、計算過程與邊/角柱判定細節</b>！<div style='text-align:center;background:var(--panel2);padding:10px;border-radius:6px;border:1px solid var(--border);margin-top:12px;'><img src='images/guide_07.png' style='width:100%;height:480px;object-fit:contain;border-radius:4px;'></div>"
  },
  {
    title: "10. 主題切換與功能重置",
    target: "#btn-theme",
    text: "點擊 <b>☀️/🌙 按鈕</b> 可切換深色與淺色模式，字體與節點將自動切換高對比配色。如果想載入新模型，可隨時點擊側邊欄下方的 <b>⟳ 載入其他檔案</b> 按鈕。介紹完畢，開始使用吧！"
  }
];

let currentGuideStep = 0;
function showGuide(stepIdx) {
  if (stepIdx < 0 || stepIdx >= guideSteps.length) {
    closeGuide();
    return;
  }
  currentGuideStep = stepIdx;
  const step = guideSteps[stepIdx];
  
  const targetEl = document.querySelector(step.target);
  const sidebar = document.getElementById('sidebar');
  
  // 若目標元素在可滾動的側邊欄內，自動平滑滾動到側邊欄中心區域
  if (targetEl && sidebar && sidebar.contains(targetEl)) {
    targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });
  }
  
  setTimeout(() => {
    const isVisible = targetEl && targetEl.offsetWidth > 0 && targetEl.offsetHeight > 0;
    
    $('guide-title-txt').textContent = step.title;
    $('guide-step-txt').textContent = `${stepIdx + 1} / ${guideSteps.length}`;
    $('guide-body-txt').innerHTML = step.text;
    
    $('guide-btn-prev').style.display = stepIdx === 0 ? 'none' : 'inline-block';
    $('guide-btn-next').textContent = stepIdx === guideSteps.length - 1 ? '完成' : '下一步';
    
    $('guide-overlay').classList.add('active');
    
    const box = $('guide-box');
    
    // 重置樣式以防前一步的 style 影響 offsetHeight 讀取
    box.style.top = '';
    box.style.left = '';
    box.style.transform = '';
    
    // 步驟 7, 8, 9 為中央大彈出框 (0-indexed 是 6, 7, 8)
    const isLargeStep = (stepIdx === 6 || stepIdx === 7 || stepIdx === 8);
    const boxW = isLargeStep ? 960 : 650;
    
    box.style.width = `${boxW}px`;
    const boxH = box.offsetHeight || 220; 
    
    if (isVisible) {
      const rect = targetEl.getBoundingClientRect();
      const pad = 6;
      
      // 計算並限制高亮聚焦框不超出螢幕邊緣
      let hTop = Math.max(0, rect.top - pad);
      let hLeft = Math.max(0, rect.left - pad);
      let hWidth = rect.width + pad * 2;
      let hHeight = rect.height + pad * 2;
      
      if (hTop + hHeight > window.innerHeight) hHeight = window.innerHeight - hTop;
      if (hLeft + hWidth > window.innerWidth) hWidth = window.innerWidth - hLeft;
      
      $('guide-highlight').style.top = `${hTop}px`;
      $('guide-highlight').style.left = `${hLeft}px`;
      $('guide-highlight').style.width = `${hWidth}px`;
      $('guide-highlight').style.height = `${hHeight}px`;
      $('guide-highlight').classList.add('active');
      
      if (isLargeStep) {
        // 置中大對話框定位
        box.style.top = '50%';
        box.style.left = '50%';
        box.style.transform = 'translate(-50%, -50%)';
      } else {
        // 吸附定位
        let top = rect.bottom + 12;
        let left = rect.left + (rect.width - boxW) / 2;
        
        if (top + boxH > window.innerHeight - 10) {
          top = rect.top - boxH - 12;
        }
        
        // Clamping 安全限制
        if (top < 10) top = 10;
        if (top + boxH > window.innerHeight - 10) {
          top = window.innerHeight - boxH - 10;
        }
        if (left < 10) left = 10;
        if (left + boxW > window.innerWidth - 10) {
          left = window.innerWidth - boxW - 10;
        }
        
        box.style.top = `${top}px`;
        box.style.left = `${left}px`;
        box.style.transform = 'none';
      }
    } else {
      $('guide-highlight').classList.remove('active');
      box.style.top = '50%';
      box.style.left = '50%';
      box.style.transform = 'translate(-50%, -50%)';
    }
  }, 100);
}

function closeGuide() {
  $('guide-overlay').classList.remove('active');
  $('guide-highlight').classList.remove('active');
}

// 監聽柱軸力教學 Modal 連動
const btnScwbGuide = $('btn-scwb-guide');
if (btnScwbGuide) {
  btnScwbGuide.addEventListener('click', (e) => {
    e.stopPropagation();
    $('scwb-guide-modal').style.display = 'flex';
  });
}
const btnCloseScwb = $('btn-close-scwb-guide');
if (btnCloseScwb) {
  btnCloseScwb.addEventListener('click', () => {
    $('scwb-guide-modal').style.display = 'none';
  });
}
const scwbModal = $('scwb-guide-modal');
if (scwbModal) {
  scwbModal.addEventListener('click', (e) => {
    if (e.target === scwbModal) {
      scwbModal.style.display = 'none';
    }
  });
}

// 監聽匯出教學 Modal 連動
const btnExport = $('btn-export-guide');
if (btnExport) {
  btnExport.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止觸發 drop-zone 的點擊上傳檔案事件
    $('export-guide-modal').style.display = 'flex';
  });
}
const btnCloseExport = $('btn-close-export-guide');
if (btnCloseExport) {
  btnCloseExport.addEventListener('click', () => {
    $('export-guide-modal').style.display = 'none';
  });
}
const exportModal = $('export-guide-modal');
if (exportModal) {
  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) {
      exportModal.style.display = 'none';
    }
  });
}

// 監聽按鈕點擊
$('btn-help').addEventListener('click', () => showGuide(0));
$('guide-btn-skip').addEventListener('click', closeGuide);
$('guide-btn-prev').addEventListener('click', () => showGuide(currentGuideStep - 1));
$('guide-btn-next').addEventListener('click', () => showGuide(currentGuideStep + 1));

// 監聽鍵盤 ESC 鍵以關閉導覽
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    closeGuide();
  }
});

// 點擊遮罩層背景關閉導覽
$('guide-overlay').addEventListener('click', (e) => {
  if (e.target === $('guide-overlay')) {
    closeGuide();
  }
});

/* ════════ 強柱弱梁 (SCWB) ════════ */
let scwbData=null, scwbState=null;
function lerpColor(a,b,t){t=Math.min(1,Math.max(0,t));
  const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
  return (Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t);}
function scwbColor(r){
  if(r==null||isNaN(r)) return 0x4a5260;
  if(r<1.25){const t=Math.min(1,Math.max(0,(r-0.6)/0.65));return lerpColor(0xc00000,0xff9a3c,t);}
  const t=Math.min(1,(r-1.25)/1.25);return lerpColor(0x9be7b8,0x2e9e5e,t);
}
function scwbClassify(){
  const cols={},beams={};
  for(const f of model.frames){
    const a=model.joints[f.i],b=model.joints[f.j]; if(!a||!b) continue;
    const dz=Math.abs(b.z-a.z),dh=Math.hypot(b.x-a.x,b.y-a.y);
    const s=model.sections[f.sect]; if(!s) continue;
    if(dz>dh&&dz>0.5){cols[f.id]={f,lower:(a.z<b.z?f.i:f.j),sec:f.sect};}
    else if(dh>=dz&&dh>0.3){beams[f.id]={f,dir:(Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'X':'Y'),sec:f.sect};}
  }
  return {cols,beams};
}
function scwbFromAOA(aoa){
  let hi=-1,hdr=null;
  for(let i=0;i<Math.min(aoa.length,12);i++){
    const r=(aoa[i]||[]).map(x=>String(x==null?'':x).trim());
    if(r.includes('Frame')&&r.includes('F3')){hi=i;hdr=r;break;}
  }
  if(hi<0) return null;
  const idx={}; hdr.forEach((h,k)=>{ if(idx[h]==null) idx[h]=k; });
  if(['Frame','Joint','OutputCase','F3'].some(k=>idx[k]==null)) return null;
  const rows=[];
  for(let i=hi+1;i<aoa.length;i++){
    const r=aoa[i]; if(!r) continue;
    const fr=r[idx.Frame]; const fs=String(fr==null?'':fr).trim();
    if(fs===''||fs==='Text') continue;
    const F3=parseFloat(r[idx.F3]); if(isNaN(F3)) continue;
    rows.push({Frame:fs,Joint:String(r[idx.Joint]).trim(),OutputCase:String(r[idx.OutputCase]).trim(),F3});
  }
  return rows.length?rows:null;
}
function scwbParseXLSX(buf){
  if(typeof XLSX==='undefined') throw new Error('XLSX 函式庫未載入（離線？請改用 CSV/TSV 匯出）');
  const wb=XLSX.read(buf,{type:'array'});
  for(const sn of wb.SheetNames){
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:null});
    const rows=scwbFromAOA(aoa); if(rows) return rows;
  }
  return null;
}
function scwbParseText(txt){
  const lines=txt.split(/\r?\n/).map(l=>l.indexOf('\t')>=0?l.split('\t'):l.split(','));
  return scwbFromAOA(lines);
}
/* v2.0.3 export hotfix: robust lookup for Frame + Joint + OutputCase.
   SAP/Excel may represent numeric joint labels as 23, 23.0, or strings with spaces. */
function scwbAxialGet(store,frame,joint,combo){
  if(!store||frame==null||joint==null||combo==null) return null;
  const fkey=String(frame).trim(), jkey=String(joint).trim(), ckey=String(combo).trim();
  let fm=store[fkey];
  if(!fm){
    const fk=Object.keys(store).find(k=>String(k).trim()===fkey || (!isNaN(+k)&&!isNaN(+fkey)&&+k===+fkey));
    if(fk!=null) fm=store[fk];
  }
  if(!fm) return null;
  let jm=fm[jkey];
  if(!jm){
    const jk=Object.keys(fm).find(k=>String(k).trim()===jkey || (!isNaN(+k)&&!isNaN(+jkey)&&+k===+jkey));
    if(jk!=null) jm=fm[jk];
  }
  if(!jm) return null;
  let val = null;
  if(Object.prototype.hasOwnProperty.call(jm,ckey)) val = jm[ckey];
  else {
    const ck=Object.keys(jm).find(k=>String(k).trim()===ckey);
    val = ck!=null?jm[ck]:null;
  }
  if(val != null && typeof model !== 'undefined' && model.frames && model.joints){
    const fObj = model.frames.find(x => String(x.id).trim() === fkey);
    if(fObj){
      const a = model.joints[fObj.i], b = model.joints[fObj.j];
      if(a && b){
        const lowerJoint = String(a.z < b.z ? fObj.i : fObj.j).trim();
        if(jkey !== lowerJoint){
          val = -val;
        }
      }
    }
  }
  return val;
}
function scwbCompute(rows){
  const {cols,beams}=scwbClassify();
  const colset=new Set(Object.keys(cols));
  const axial={}, comboSet=new Set();
  /* v2.0.3：柱軸力依 Frame + Joint + OutputCase 儲存。
     每個梁柱接頭計算時，直接取該接頭 Joint 的 F3，
     確保上柱取柱底端、下柱取柱頂端，皆為同一接頭端軸力。 */
  for(const r of rows){
    if(!colset.has(r.Frame)) continue;
    (((axial[r.Frame]||(axial[r.Frame]={}))[r.Joint]||
      ((axial[r.Frame][r.Joint])={}))[r.OutputCase])=r.F3;
    comboSet.add(r.OutputCase);
  }
  const combos=[...comboSet];
  const jCols={},jBeams={};
  for(const id in cols){const f=cols[id].f;(jCols[f.i]||(jCols[f.i]=[])).push(id);(jCols[f.j]||(jCols[f.j]=[])).push(id);}
  for(const id in beams){const f=beams[id].f;(jBeams[f.i]||(jBeams[f.i]=[])).push(id);(jBeams[f.j]||(jBeams[f.j]=[])).push(id);}
  const za=sec=>{const s=model.sections[sec]||{},m=model.materials[s.mat]||{};return {Z:s.z33||0,A:s.area||0,fy:m.fy||0};};
  const res={};
  for(const J in model.joints){
    const cs=jCols[J],bs=jBeams[J]; if(!cs||!bs) continue;
    const denom={X:0,Y:0},nb={X:0,Y:0};
    for(const id of bs){const b=beams[id],p=za(b.sec);denom[b.dir]+=p.Z*p.fy;nb[b.dir]++;}
    const best={X:[null,null],Y:[null,null]};
    let govCombo=null, govNum=null;
    for(const combo of combos){
      let num=0,ok=true;
      for(const id of cs){const p=za(cols[id].sec),P=scwbAxialGet(axial,id,J,combo); if(P==null||!p.A||!p.Z){ok=false;break;} num+=p.Z*(p.fy-P/p.A);}
      if(!ok) continue;
      if(govNum==null||num<govNum){govNum=num;govCombo=combo;}
      for(const d of ['X','Y']) if(denom[d]>0){const rr=num/denom[d]; if(best[d][0]==null||rr<best[d][0]) best[d]=[rr,combo];}
    }
    const top=!cs.some(id=>cols[id].lower===J);
    const rmin=[best.X[0],best.Y[0]].filter(v=>v!=null);
    const isng=rmin.length&&Math.min(...rmin)<1.25;
    /* v2.5.3：逐柱個別比較 Puc<0.3FycAg（非合計），且相關斷面須滿足 λpd（塑性斷面） */
    let pucOk=true, thr=Infinity, pucMax=-Infinity;
    for(const id of cs){
      const p=za(cols[id].sec); const P=govCombo!=null?scwbAxialGet(axial,id,J,govCombo):null;
      const t=0.3*p.fy*p.A; if(t<thr) thr=t;
      if(P==null){pucOk=false;continue;}
      if(P>pucMax) pucMax=P;
      if(!(P<t)) pucOk=false;
    }
    if(!isFinite(thr)) thr=0; if(!isFinite(pucMax)) pucMax=0;
    const allSecs=new Set([...cs.map(id=>cols[id].sec),...bs.map(id=>beams[id].sec)]);
    let compactAll=true;
    for(const sec of allSecs){const w=scwbWtCheck(sec); if(w&&!w.compact) compactAll=false;}
    let exempt=false,verdict='OK',clause='';
    if(isng){
      if(top&&compactAll&&pucOk){exempt=true;verdict='豁免(免檢)';clause='1(1) 頂層柱 Puc<0.3FycAg';}
      else{verdict='NG(需檢討)'; clause=(!compactAll)?'半結實／細長-不可豁免':'—(可查1(2)/2)';}
    }
    res[J]={rX:best.X[0],cX:best.X[1],rY:best.Y[0],cY:best.Y[1],nbx:nb.X,nby:nb.Y,top,pucMax,thr,exempt,verdict,clause,compactAll,govCombo};
  }
  return {res,cols,beams,colset,nCombo:combos.length,nColAx:Object.keys(axial).length,nColTot:colset.size,axial,combos};
}
function scwbRatioJoint(J){
  if(!scwbData) return null; const r=scwbData.res[J]; if(!r) return null;
  const d=$('scwb-dir').value;
  if(d==='X') return r.rX; if(d==='Y') return r.rY;
  const a=[r.rX,r.rY].filter(v=>v!=null); return a.length?Math.min(...a):null;
}
function scwbFrameRatio(f){
  if(!scwbData||!scwbData.colset.has(f.id)) return null;
  const a=[scwbRatioJoint(f.i),scwbRatioJoint(f.j)].filter(v=>v!=null);
  return a.length?Math.min(...a):null;
}
/* v2.5.3：強柱弱梁豁免與桿件斷面欄共用台灣規範四級分類；
   塑性斷面、結實斷面均視為符合13.6.5豁免所需之4.5節寬厚比前提。 */
function scwbWtCheck(sec){
  const tw=twSectionClassify(sec);
  if(!tw||!tw.applicable) return null;
  return {
    compact:tw.rank<=1,
    classification:tw.label,
    rank:tw.rank,
    shape:tw.shape,
    fy:tw.fy,
    items:tw.items.map(it=>[it.name,it.lambda,it.limits.p]),
    tw,
  };
}
/* e版：懸浮節點時顯示逐構材可追溯明細，格式對應 強柱弱梁_SAP批次檢核.xlsx 的「公式檢核(可追溯)」分頁 */
function scwbHoverHTML(J){
  const d=scwbData&&scwbData.res[J]; if(!d) return null;
  const j=model.joints[J]; if(!j) return null;
  const za=sec=>{const s=model.sections[sec]||{},m=model.materials[s.mat]||{};return {Z:s.z33||0,A:s.area||0,fy:m.fy||0};};
  const combo=d.govCombo;
  const cols=[],xb=[],yb=[];
  for(const id in scwbData.cols){const c=scwbData.cols[id]; if(c.f.i===J||c.f.j===J) cols.push({id,sec:c.sec,role:c.lower===J?'上柱':'下柱'});}
  for(const id in scwbData.beams){const b=scwbData.beams[id]; if(b.f.i===J||b.f.j===J) (b.dir==='X'?xb:yb).push({id,sec:b.sec});}
  cols.sort((a,b)=>a.role==='上柱'?-1:1);
  const rf=(v,n)=>v==null||isNaN(v)?'—':(+v).toFixed(n==null?2:n);
  const row=(m,isCol)=>{
    const p=za(m.sec); const Puc=isCol&&combo!=null?scwbAxialGet(scwbData.axial,m.id,J,combo):null;
    const item=isCol?(Puc!=null&&p.A?p.Z*(p.fy-Puc/p.A):null):p.Z*p.fy;
    const Zcm3=p.Z*1e6, Agcm2=p.A*1e4, Fytfcm2=p.fy/1e4;
    return `<div>${isCol?m.role:'　'} #${m.id} ${m.sec}　Z=${rf(Zcm3,0)}${isCol?' Ag='+rf(Agcm2,0):''} Fy=${rf(Fytfcm2,2)}${isCol?' Puc='+rf(Puc,1):''}　項目值=${rf(item*100,0)}</div>`;
  };
  const okc=v=>(v==null)?'#8a93a3':(v<1.25?'#ff5252':'#3ecf8e');
  const vcolor=d.verdict==='OK'?'#3ecf8e':(d.exempt?'#c9a0ff':'#ff5252');
  let h=`<div class="t">強柱弱梁 13.6.5 · 節點 ${J}　(Z=${j.z.toFixed(2)} m)${d.top?'　頂層':''}</div>`;
  h+='<div style="font-size:.7rem;line-height:1.5;color:var(--text);">';
  h+=`<div style="color:var(--dim);">ΣZc(Fyc−Puc/Ag) ／ ΣZb·Fyb ≧ 1.25　控制組合：${combo||'—'}　(單位 Z:cm³ Ag:cm² Fy:tf/cm² Puc:tf)</div>`;
  cols.forEach(c=>h+=row(c,true));
  if(xb.length){h+='<div style="color:var(--dim);">X向梁：</div>'+xb.map(b=>row(b,false)).join('');}
  if(yb.length){h+='<div style="color:var(--dim);">Y向梁：</div>'+yb.map(b=>row(b,false)).join('');}
  h+='<div style="margin-top:3px;border-top:1px solid var(--border);padding-top:3px;">';
  h+=`比值X=<b style="color:${okc(d.rX)}">${rf(d.rX,3)}</b>　比值Y=<b style="color:${okc(d.rY)}">${rf(d.rY,3)}</b>　<b style="color:${vcolor}">${d.verdict}</b></div>`;
  h+=`<div style="color:#8a93a3;">斷面寬厚比：${d.compactAll?'滿足 λpd ✓':'未滿足 λpd ✗（不可自動豁免）'}</div>`;
  if(d.verdict!=='OK') h+=`<div style="color:#8a93a3;">0.3FycAg(取小)=${rf(d.thr,0)}　控制組合柱軸力(取大)=${rf(d.pucMax,0)}　${d.clause}</div>`;
  h+='</div>';
  return h;
}
function drawSCWBLabels(){
  if(!scwbData||!$('tg-scwb-lbl').checked) return;
  for(const J in scwbData.res){
    const j=model.joints[J]; if(!j||!zOK(j.z)||!planeOK(j)) continue;
    const r=scwbRatioJoint(J); if(r==null) continue;
    gFLabels.add(makeLabel(r.toFixed(2),'#'+scwbColor(r).toString(16).padStart(6,'0'),toThree(j.x,j.y,j.z).add(new THREE.Vector3(0,0.3,0)),0.7));
  }
}
function scwbBuildLegend(){
  const leg=$('scwb-legend'); if(!leg) return; if(!scwbData){leg.innerHTML='';return;}
  let ng=0,exempt=0,need=0,tot=0;
  for(const J in scwbData.res){const r=scwbRatioJoint(J); if(r==null) continue; tot++;
    if(r<1.25){ng++; if(scwbData.res[J].exempt) exempt++; else need++;}}
  leg.innerHTML='<div class="grad" style="background:linear-gradient(90deg,#c00000,#ff9a3c,#9be7b8,#2e9e5e)"></div>'+
    '<div class="grad-l"><span>0.6 NG</span><span>1.25</span><span>OK ≥2.5</span></div>'+
    '<div style="font-size:.72rem;color:var(--dim);margin-top:6px;line-height:1.6;">檢核節點 '+tot+'　<span style="color:var(--warn)">NG '+ng+'</span>　豁免(頂層) '+exempt+'　<span style="color:#ff5252">需檢討 '+need+'</span><br>柱軸力 '+scwbData.nColAx+'/'+scwbData.nColTot+' · 組合 '+scwbData.nCombo+'</div>';
}
function scwbSetActive(on){
  if(!scwbState) scwbState={active:false,
    frameColor:f=>{const r=scwbFrameRatio(f);return r==null?0x39414e:scwbColor(r);},
    frameInfo:f=>{const m=scwbFrameRatio(f); if(m==null) return null; const r=scwbData.res; const ri=r[f.i],rj=r[f.j];
      const fx=o=>o?((o.rX!=null?o.rX.toFixed(2):'—')+' / '+(o.rY!=null?o.rY.toFixed(2):'—')):'—';
      return (m<1.25?'NG ':'OK ')+m.toFixed(2)+'（節點 '+f.i+': '+fx(ri)+'、'+f.j+': '+fx(rj)+'，X/Y）';}};
  scwbState.active=on;
  if(on) $('di-select').value='';
  rebuild(false);
}
$('scwb-load').addEventListener('click',()=>$('scwb-file').click());
$('scwb-file').addEventListener('change',ev=>{
  const file=ev.target.files[0]; if(!file) return;
  $('scwb-status').textContent='讀取中…';
  const isXl=/\.(xlsx|xls)$/i.test(file.name);
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      const rows=isXl?scwbParseXLSX(e.target.result):scwbParseText(e.target.result);
      if(!rows||!rows.length){$('scwb-status').textContent='✗ 找不到 Frame/Joint/F3 欄位（請確認匯出表為 Element Joint Forces）';return;}
      scwbData=scwbCompute(rows);
      if(!Object.keys(scwbData.res).length){$('scwb-status').textContent='✗ 無可檢核節點（柱軸力 Frame 編號與模型對不上？）';return;}
      let ng=0; for(const J in scwbData.res){const r=scwbRatioJoint(J); if(r!=null&&r<1.25) ng++;}
      $('scwb-status').innerHTML='✓ 已載入 '+rows.length+' 列 · 柱 '+scwbData.nColAx+' · 組合 '+scwbData.nCombo+'<br>檢核節點 '+Object.keys(scwbData.res).length+' · <span style="color:var(--warn)">NG '+ng+'</span>';
      $('scwb-row').style.display='flex'; $('scwb-dir-row').style.display='flex'; $('scwb-lbl-row').style.display='flex';
      $('tg-scwb').checked=true;
      scwbBuildLegend(); scwbSetActive(true);
    }catch(err){$('scwb-status').textContent='✗ '+err.message; console.error(err);}
  };
  if(isXl) rd.readAsArrayBuffer(file); else rd.readAsText(file);
});
$('tg-scwb').addEventListener('change',e=>scwbSetActive(e.target.checked));
$('scwb-dir').addEventListener('change',()=>{scwbBuildLegend();rebuild(false);});
$('tg-scwb-lbl').addEventListener('change',()=>rebuild(false));

/* ════ 梁柱腹板交會區 (Panel Zone) 13.6.2 ════ */
let pjzData=null, pjzState=null;
const PHI_PZ=0.9;
function pzIsBox(s){const sh=(s.shape||'').toUpperCase();return sh.includes('BOX')||sh.includes('TUBE');}
function pjzCompute(){
  const {cols,beams}=scwbClassify();
  const jCols={},jBeams={};
  for(const id in cols){const f=cols[id].f;(jCols[f.i]||(jCols[f.i]=[])).push(id);(jCols[f.j]||(jCols[f.j]=[])).push(id);}
  for(const id in beams){const f=beams[id].f;(jBeams[f.i]||(jBeams[f.i]=[])).push(id);(jBeams[f.j]||(jBeams[f.j]=[])).push(id);}
  const sec=n=>model.sections[n]||{}, fyOf=s=>((model.materials[s.mat]||{}).fy||0);
  const res={}; let ng=0,tot=0;
  for(const J in model.joints){
    const cs=jCols[J],bs=jBeams[J]; if(!cs||!bs) continue;
    let csec=null,cp=null,ctp=0;
    for(const id of cs){const s=sec(cols[id].sec); if(!s.t3) continue;
      const tp=pzIsBox(s)?2*(s.tw||0):(s.tw||0); const k=s.t3*tp;
      if(cp==null||k<ctp){cp=s;csec=cols[id].sec;ctp=k;}}
    if(!cp) continue;
    const Fyc=fyOf(cp), dc=cp.t3, tfc=cp.tf, tp=pzIsBox(cp)?2*(cp.tw||0):(cp.tw||0);
    const tzUse=(cp.tw||0);
    const dirRes={};
    for(const dir of ['X','Y']){
      const db=bs.filter(id=>beams[id].dir===dir); if(!db.length) continue;
      const bi=db.map(id=>{const s=sec(beams[id].sec),fyb=fyOf(s),Mp=fyb*(s.z33||0),den=(s.t3-s.tf);
        return {fr:beams[id].f.id,sec:beams[id].sec,Mp,Vp:den>0?Mp/den:0,db:s.t3,tfb:s.tf};});
      bi.sort((a,b)=>b.Vp-a.Vp); const use=bi.slice(0,2);
      const sumVp=use.reduce((a,b)=>a+b.Vp,0);
      const phiVn=PHI_PZ*0.6*Fyc*dc*tp, phiVup=PHI_PZ*sumVp;
      const ratioV=phiVup>0?phiVn/phiVup:null, okV=phiVup>0?phiVn>=phiVup:null;
      const wz=dc-2*tfc, tzReq=use.length?Math.max.apply(null,use.map(b=>(b.db-2*b.tfb+wz)/90)):null;
      const okTz=tzReq!=null?tzUse>=tzReq:null;
      const isng=(okV===false||okTz===false); tot++; if(isng) ng++;
      dirRes[dir]={csec,isBox:pzIsBox(cp),Fyc,dc,tp,tzUse,tfc,beams:use,edge:use.length===1,phiVn,phiVup,ratioV,okV,wz,tzReq,okTz,ng:isng};
    }
    if(Object.keys(dirRes).length) res[J]=dirRes;
  }
  return {res,ng,tot};
}
function pjzJointNG(J){const d=pjzData&&pjzData.res[J]; if(!d) return null;
  let any=false,worst=null; for(const k in d){if(d[k].ng) any=true; const rv=d[k].ratioV; if(rv!=null&&(worst==null||rv<worst))worst=rv;}
  return {ng:any,ratio:worst};}
function pjzColor(J){const s=pjzJointNG(J); if(!s) return 0x2e9e5e; return s.ng?0xff5252:0x2e9e5e;}
function pjzBuildLegend(){
  const leg=$('pjz-legend'); if(!leg) return; if(!pjzData){leg.innerHTML='';return;}
  leg.innerHTML='<div style="display:flex;gap:6px;align-items:center;font-size:.72rem;margin-top:4px;">'+
    '<span style="width:12px;height:12px;background:#ff5252;border-radius:2px;display:inline-block;"></span>NG'+
    '<span style="width:12px;height:12px;background:#2e9e5e;border-radius:2px;display:inline-block;margin-left:8px;"></span>OK</div>'+
    '<div style="font-size:.72rem;color:var(--dim);margin-top:6px;line-height:1.6;">檢核項 '+pjzData.tot+' (節點×向)　<span style="color:var(--warn)">NG '+pjzData.ng+'</span><br>φVn≧φVup 且 tz≧(dz+wz)/90</div>';
}
function pjzJointInfo(J){const d=pjzData&&pjzData.res[J]; if(!d) return null;
  const parts=[]; for(const dir in d){const r=d[dir];
    parts.push(dir+'向: φVn='+r.phiVn.toFixed(0)+' φVup='+r.phiVup.toFixed(0)+'tf 比'+(r.ratioV?r.ratioV.toFixed(2):'—')+(r.okV===false?' ✗剪力':'')+(r.okTz===false?' ✗厚度':((r.okV!==false)?' OK':'')));}
  return parts.join('；');}
function pjzDrawLabels(){
  if(!pjzData||!$('tg-pjz-lbl').checked) return;
  for(const J in pjzData.res){
    const j=model.joints[J]; if(!j||!zOK(j.z)||!planeOK(j)) continue;
    const s=pjzJointNG(J); if(!s) continue;
    gFLabels.add(makeLabel(s.ng?'PZ✗':'PZ✓','#'+(pjzColor(J)).toString(16).padStart(6,'0'),toThree(j.x,j.y,j.z).add(new THREE.Vector3(0,0.55,0)),0.6));
  }
}
function pjzSetActive(on){ if(!pjzState) pjzState={active:false}; pjzState.active=on; rebuild(false); }
$('pjz-run').addEventListener('click',()=>{
  if(!model){$('pjz-status').textContent='✗ 尚未載入模型';return;}
  try{
    pjzData=pjzCompute();
    if(!pjzData.tot){$('pjz-status').textContent='✗ 無可檢核節點（找不到柱+梁交會處）';return;}
    $('pjz-status').innerHTML='✓ 檢核 '+pjzData.tot+' 項 · <span style="color:var(--warn)">NG '+pjzData.ng+'</span>';
    $('pjz-row').style.display='flex'; $('pjz-lbl-row').style.display='flex';
    $('tg-pjz').checked=true; pjzBuildLegend(); pjzSetActive(true);
  }catch(err){$('pjz-status').textContent='✗ '+err.message; console.error(err);}
});
$('tg-pjz').addEventListener('change',e=>pjzSetActive(e.target.checked));
$('tg-pjz-lbl').addEventListener('change',()=>rebuild(false));

/* ═══════════ d版：交會區 hover 計算書 + 剖面參考圖 + xlsx 匯出 ═══════════ */
function pzFmt(v,d){return (v==null||isNaN(v))?'—':(+v).toFixed(d==null?1:d);}

function pzSVG(dir,r){
  const b1=r.beams[0], b2=r.beams[1];
  const g='#8a93a3', O='#f0a500', G='#3ecf8e', B='#4da3ff', uid='pz'+dir;
  const L=!!b1, R=!!b2;
  return `<svg width="330" height="164" viewBox="0 0 336 168" xmlns="http://www.w3.org/2000/svg" style="background:#0f1216;border:1px solid #2e3540;border-radius:6px;margin:3px 0;display:block;">
  <defs>
   <marker id="${uid}o" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${O}"/></marker>
   <marker id="${uid}g" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${G}"/></marker>
  </defs>
  <rect x="128" y="48" width="80" height="72" fill="rgba(77,163,255,.10)" stroke="${B}" stroke-width="1.2"/>
  <text x="168" y="87" fill="${B}" font-size="10" text-anchor="middle">tp</text>
  <line x1="128" y1="12" x2="128" y2="156" stroke="${g}" stroke-width="1.4"/>
  <line x1="208" y1="12" x2="208" y2="156" stroke="${g}" stroke-width="1.4"/>
  <line x1="128" y1="34" x2="208" y2="34" stroke="${g}" stroke-dasharray="3 3" stroke-width="0.8"/>
  <text x="168" y="30" fill="${g}" font-size="9" text-anchor="middle">dc</text>
  ${L?`<line x1="12" y1="48" x2="128" y2="48" stroke="${g}" stroke-width="1.4"/><line x1="12" y1="120" x2="128" y2="120" stroke="${g}" stroke-width="1.4"/>`:`<text x="64" y="88" fill="#5a6b80" font-size="9" text-anchor="middle">（無左梁）</text>`}
  ${R?`<line x1="208" y1="48" x2="324" y2="48" stroke="${g}" stroke-width="1.4"/><line x1="208" y1="120" x2="324" y2="120" stroke="${g}" stroke-width="1.4"/>`:`<text x="272" y="88" fill="#5a6b80" font-size="9" text-anchor="middle">（無右梁）</text>`}
  <line x1="135" y1="58" x2="201" y2="58" stroke="${O}" stroke-width="1.6" marker-end="url(#${uid}o)"/>
  <line x1="201" y1="110" x2="135" y2="110" stroke="${O}" stroke-width="1.6" marker-end="url(#${uid}o)"/>
  <text x="168" y="54" fill="${O}" font-size="9" text-anchor="middle">Vup</text>
  ${L?`<path d="M80,56 A26,26 0 0,1 80,112" fill="none" stroke="${G}" stroke-width="1.5" marker-end="url(#${uid}g)"/><text x="66" y="88" fill="${G}" font-size="10" text-anchor="middle">Mp1</text>`:''}
  ${R?`<path d="M256,112 A26,26 0 0,1 256,56" fill="none" stroke="${G}" stroke-width="1.5" marker-end="url(#${uid}g)"/><text x="270" y="88" fill="${G}" font-size="10" text-anchor="middle">Mp2</text>`:''}
  ${L?`<line x1="22" y1="48" x2="22" y2="120" stroke="${g}" stroke-width="0.7"/><text x="16" y="86" fill="${g}" font-size="8" text-anchor="middle" transform="rotate(-90 16,86)">db1</text><line x1="42" y1="52" x2="42" y2="116" stroke="#5a6b80" stroke-width="0.7" stroke-dasharray="2 2"/><text x="44" y="134" fill="#5a6b80" font-size="7">db1-tf1</text>`:''}
  ${R?`<line x1="314" y1="48" x2="314" y2="120" stroke="${g}" stroke-width="0.7"/><text x="320" y="86" fill="${g}" font-size="8" text-anchor="middle" transform="rotate(-90 320,86)">db2</text><line x1="294" y1="52" x2="294" y2="116" stroke="#5a6b80" stroke-width="0.7" stroke-dasharray="2 2"/><text x="262" y="134" fill="#5a6b80" font-size="7">db2-tf2</text>`:''}
  </svg>`;
}

function pzTextBlock(r){
  const b1=r.beams[0],b2=r.beams[1];
  const tpReq=(PHI_PZ*0.6*r.Fyc*r.dc)>0?r.phiVup/(PHI_PZ*0.6*r.Fyc*r.dc):null;
  const doubler=(r.okV===false&&tpReq!=null)?Math.max(0,tpReq-r.tp):0;
  const okc=v=>v===false?'#ff5252':'#3ecf8e';
  const jd=v=>v===false?'✗ NG':(v===true?'✓ OK':'—');
  let h='<div style="font-size:.7rem;line-height:1.55;color:var(--text);">';
  h+=`<div style="color:var(--dim);">(A)參數　柱 ${r.csec} ${r.isBox?'箱型':'H型'}｜Fyc=${pzFmt(r.Fyc,3)} tf/cm²</div>`;
  h+=`<div style="color:var(--dim);">(B)斷面　dc=${pzFmt(r.dc)}　tp=${pzFmt(r.tp,2)}　tfc=${pzFmt(r.tfc,2)} cm</div>`;
  if(b1) h+=`<div>左梁 ${b1.sec}：Mp1=${pzFmt(b1.Mp)} tf·m　Vp1=${pzFmt(b1.Vp)} tf</div>`;
  if(b2) h+=`<div>右梁 ${b2.sec}：Mp2=${pzFmt(b2.Mp)} tf·m　Vp2=${pzFmt(b2.Vp)} tf</div>`;
  h+=`<div><b>(C)剪力</b>　φVn=φ·0.6·Fyc·dc·tp=${pzFmt(r.phiVn)}　φVup=φ·ΣVp=${pzFmt(r.phiVup)} tf</div>`;
  h+=`<div>　剪力比 φVn/φVup=<b style="color:${okc(r.okV)}">${r.ratioV?pzFmt(r.ratioV,2):'—'}</b>　<b style="color:${okc(r.okV)}">${jd(r.okV)}</b></div>`;
  if(doubler>0) h+=`<div style="color:#f0a500;">　需補強板：tp,req=${pzFmt(tpReq,2)} → doubler ${pzFmt(doubler,2)} cm</div>`;
  h+=`<div><b>(D)厚度</b>　tz採用=${pzFmt(r.tzUse,2)}　tz需求=(dz+wz)/90=${r.tzReq?pzFmt(r.tzReq,2):'—'}　wz=${pzFmt(r.wz)} cm　<b style="color:${okc(r.okTz)}">${jd(r.okTz)}</b></div>`;
  h+='</div>';
  return h;
}

function pjzHoverHTML(J){
  const d=pjzData.res[J]; if(!d) return null; const j=model.joints[J];
  let h=`<div class="t">梁柱交會區 13.6.2 · 節點 ${J}　(Z=${j.z.toFixed(2)} m)</div>`;
  let any=false;
  for(const dir of ['X','Y']){const r=d[dir]; if(!r) continue; any=true;
    h+=`<div style="margin-top:5px;border-top:1px solid var(--border);padding-top:4px;"><b style="color:#4da3ff;font-size:.78rem;">▍${dir} 向</b>${r.edge?' <span style="color:#f0a500;font-size:.68rem;">邊柱/單側</span>':''}</div>`;
    h+=pzSVG(dir,r)+pzTextBlock(r);
  }
  return any?h:null;
}

/* ── xlsx 匯出 (xlsx-js-style) ── */
const XF='微軟正黑體';
const _bs={style:'thin',color:{rgb:'C9CFD8'}}, _BD={top:_bs,bottom:_bs,left:_bs,right:_bs};
function _sty(ws,r,c,st){const a=XLSX.utils.encode_cell({r,c}); if(!ws[a])ws[a]={t:'s',v:''}; ws[a].s=Object.assign({},ws[a].s||{},st);}
/* v2.4.2：寫入公式格(保留樣式)，v 為公式尚未於試算表重算前顯示的快取值 */
function _fml(ws,r,c,formula,value){const a=XLSX.utils.encode_cell({r,c}); const prevS=ws[a]&&ws[a].s; ws[a]={t:'n',v:value,f:formula}; if(prevS) ws[a].s=prevS;}
function _rowStyle(ws,r,nc,st){for(let c=0;c<nc;c++)_sty(ws,r,c,st);}

function pjzExportXlsx(){
  if(!pjzData||!pjzData.tot){$('pjz-status').innerHTML='✗ 請先執行交會區檢核';return;}
  const rows=[];
  for(const J in pjzData.res){const d=pjzData.res[J];const z=model.joints[J].z;
    for(const dir in d) rows.push({J,dir,z,r:d[dir]});}
  rows.sort((a,b)=>a.z-b.z || ((+a.J||0)-(+b.J||0)) || (a.dir<b.dir?-1:1));
  // ── 檢核結果 ──
  const head=["接頭節點","方向","高程(cm)","柱斷面","邊柱","左右梁斷面(逐支)","φVn(tf)","φVup(tf)","剪力比","剪力判定","tz採用(cm)","tz需求(cm)","厚度判定","補強板需求(cm)"];
  const N=head.length;
  const aoa=[
    ["梁柱腹板交會區 (Panel Zone) 檢核 — 鋼結構極限設計法規範 13.6.2"],
    ["φVn = φ·0.6·Fyc·dc·tp  ≧  φVup = φ(Vp1+Vp2)，Vp=Mp/(db−tf)，Mp=Fyb·Z，φ=0.9"],
    ["符號：Fyc/Fyb=柱/梁降伏強度 dc=柱深 tp=交會區腹板總厚(箱型=2×壁厚) Z=塑性模數 db=梁深 tf=梁翼板厚 tz需求=(dz+wz)/90 單位tf,cm。粉紅=NG；tz採用=單板厚(箱型=單壁厚tw、H型=腹板tw)，逐板檢核挫屈"],
    head];
  const dataStart=aoa.length;
  for(const o of rows){const r=o.r;
    const tpReq=(PHI_PZ*0.6*r.Fyc*r.dc)>0?r.phiVup/(PHI_PZ*0.6*r.Fyc*r.dc):null;
    const doubler=(r.okV===false&&tpReq!=null)?Math.max(0,tpReq-r.tp):0;
    aoa.push([o.J,o.dir,Math.round(o.z*100),r.csec+(r.isBox?'(箱)':'(H)'),r.edge?'是':'',
      r.beams.map(b=>'#'+b.fr+' '+b.sec).join(' ／ '),
      +r.phiVn.toFixed(1),+r.phiVup.toFixed(1),r.ratioV?+r.ratioV.toFixed(2):'—',r.okV===false?'NG':'OK',
      +r.tzUse.toFixed(2),r.tzReq?+r.tzReq.toFixed(2):'—',r.okTz===false?'NG':'OK',+doubler.toFixed(2)]);
  }
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges']=[0,1,2].map(rr=>({s:{r:rr,c:0},e:{r:rr,c:N-1}}));
  ws['!cols']=[7,6,8,20,6,34,9,9,7,8,9,9,8,10].map(w=>({wch:w}));
  _sty(ws,0,0,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1F3864'}},alignment:{horizontal:'center',vertical:'center'}});
  _sty(ws,1,0,{font:{name:XF,bold:true,sz:12,color:{rgb:'2E5496'}},fill:{fgColor:{rgb:'EAF1FB'}},alignment:{horizontal:'center'}});
  _sty(ws,2,0,{font:{name:XF,sz:9,color:{rgb:'595959'}},alignment:{horizontal:'left',wrapText:true}});
  for(let c=0;c<N;c++)_sty(ws,3,c,{font:{name:XF,bold:true,sz:9,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'305496'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:_BD});
  for(let i=0;i<rows.length;i++){const rr=dataStart+i,r=rows[i].r,ng=(r.okV===false||r.okTz===false);
    for(let c=0;c<N;c++)_sty(ws,rr,c,{font:{name:XF,sz:9},alignment:{horizontal:c===5?'left':'center',vertical:'center',wrapText:c===5},border:_BD});
    if(ng)_rowStyle(ws,rr,N,{fill:{fgColor:{rgb:'FCE4EC'}}});
    _sty(ws,rr,9,{font:{name:XF,bold:true,sz:9,color:{rgb:r.okV===false?'C00000':'375623'}}});
    _sty(ws,rr,12,{font:{name:XF,bold:true,sz:9,color:{rgb:r.okTz===false?'C00000':'375623'}}});
  }
  // ── 計算書 ──
  const D=[["鋼構造梁柱抗彎矩接合 — 梁柱腹板交會區檢核 (逐節點計算書)","","","","",""]];
  const hdrRows=[0];
  for(const o of rows){const r=o.r,b1=r.beams[0],b2=r.beams[1];
    const ng=(r.okV===false||r.okTz===false);
    D.push([`● 節點 ${o.J}　${o.dir} 向　高程 ${Math.round(o.z*100)} cm${r.edge?'　【邊柱】':''}${ng?'　★NG':''}`,"","","","",""]);
    hdrRows.push(D.length-1);
    D.push(["(A) 參數",`柱 ${r.csec} ${r.isBox?'箱型':'H型'}`,"","Fyc="+r.Fyc.toFixed(3),"tf/cm²",""]);
    D.push(["(B) 斷面",`dc=${r.dc.toFixed(1)}　tp=${r.tp.toFixed(2)}　tfc=${r.tfc.toFixed(2)}`,"","","cm",""]);
    D.push(["",`左梁 ${b1?b1.sec:'—'}${b2?('　右梁 '+b2.sec):'（單側／邊柱）'}`,"","","",""]);
    D.push(["(C) 剪力","φVn = φ·0.6·Fyc·dc·tp","",+r.phiVn.toFixed(1),"tf",""]);
    D.push(["",`左梁 Mp1=${b1?b1.Mp.toFixed(1):'—'} → Vp1=${b1?b1.Vp.toFixed(1):'—'}${b2?('　右梁 Mp2='+b2.Mp.toFixed(1)+' → Vp2='+b2.Vp.toFixed(1)):''}`,"","","",""]);
    D.push(["","φVup = φ(Vp1+Vp2)","",+r.phiVup.toFixed(1),"tf",""]);
    D.push(["","Check  φVn ≧ φVup","",r.okV===false?'NG':'OK',"",""]);
    D.push(["(D) 厚度","tz_req = (dz+wz)/90","",r.tzReq?+r.tzReq.toFixed(2):'—',"cm","wz="+r.wz.toFixed(1)]);
    D.push(["",`Check  tz_use(${r.tzUse.toFixed(2)}) ≧ tz_req`,"",r.okTz===false?'NG':'OK',"",""]);
    D.push(["","","","","",""]);
  }
  const wsD=XLSX.utils.aoa_to_sheet(D);
  wsD['!cols']=[14,42,4,12,8,16].map(w=>({wch:w}));
  wsD['!merges']=hdrRows.map(rr=>({s:{r:rr,c:0},e:{r:rr,c:5}}));
  _rowStyle(wsD,0,6,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1F3864'}},alignment:{horizontal:'center'}});
  for(const rr of hdrRows.slice(1))_rowStyle(wsD,rr,6,{font:{name:XF,bold:true,sz:10,color:{rgb:'2E5496'}},fill:{fgColor:{rgb:'EAF1FB'}}});
  // ── 說明 ──
  const notes=["梁柱腹板交會區 (Panel Zone) 檢核 — 說明","",
    "依據：鋼結構極限設計法規範及解說 §13.6.2。","",
    "1. 剪力強度 φVn=φ·0.6·Fyc·dc·tp，φ=0.9。tp=交會區腹板總厚：箱型柱=2×壁厚；H型柱=柱腹板厚+補強板。",
    "2. 需求剪力(梁塑性彎矩法)：梁端達 Mp=Fyb·Z 時傳入之水平剪力。Vp=Mp/(db−tf)；φVup=φ(Vp1+Vp2)。邊柱缺側 Vp=0。",
    "3. 厚度檢核：tz≧(dz+wz)/90。dz=梁深−2×梁翼板厚(左右取大)；wz=柱深−2×柱翼板厚。tz採用=單板厚(箱型=單壁厚tw、H型=腹板tw+補強板)，逐板檢核。",
    "4. 來源：SAP2000 .s2k 模型斷面(不需分析結果)。構材由幾何自動分類，梁分X/Y向、>2支取Vp最大兩支。",
    "5. 本檔由 S2K＋F2K 基礎整合檢視器(V3.0.7，S2K Viewer v2.4.5) 直接匯出。"];
  const wsN=XLSX.utils.aoa_to_sheet(notes.map(t=>[t])); wsN['!cols']=[{wch:100}];
  _sty(wsN,0,0,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1F3864'}}});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"檢核結果");
  XLSX.utils.book_append_sheet(wb,wsD,"計算書");
  XLSX.utils.book_append_sheet(wb,wsN,"說明");
  XLSX.writeFile(wb,"交會區批次檢核.xlsx");
  $('pjz-status').innerHTML='✓ 已下載 交會區批次檢核.xlsx';
}

/* e版：匯出完整版計算書（5分頁，比照 Python 產生之 強柱弱梁_SAP批次檢核_c版.xlsx） */
function scwbFmtSec(s){return (s||'').replace(/(?<=\d)X(?=\d)/g,'×');}
function scwbPinAt(f,J){const rel=model.releases[f.id]; if(!rel) return false; return J===f.i?(rel.raw.M3I==='Yes'):(rel.raw.M3J==='Yes');}
function scwbBanner(ws,ncol,title,formula,note){
  ws['!merges']=(ws['!merges']||[]);
  for(let rr=0;rr<4;rr++) ws['!merges'].push({s:{r:rr,c:0},e:{r:rr,c:ncol-1}});
  const NAVY='1F3864',BLUE='2E5496',BANNER='0F2747';
  _sty(ws,0,0,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:BANNER}},alignment:{horizontal:'center',vertical:'center'}}); ws[XLSX.utils.encode_cell({r:0,c:0})].v=title;
  _sty(ws,1,0,{font:{name:XF,bold:true,sz:10,color:{rgb:NAVY}},alignment:{horizontal:'center'}}); ws[XLSX.utils.encode_cell({r:1,c:0})].v='任何梁柱接頭應滿足下式：';
  _sty(ws,2,0,{font:{name:XF,bold:true,sz:14,color:{rgb:BLUE}},fill:{fgColor:{rgb:'EAF1FB'}},alignment:{horizontal:'center',vertical:'center'}}); ws[XLSX.utils.encode_cell({r:2,c:0})].v=formula;
  _sty(ws,3,0,{font:{name:XF,sz:8.5,italic:true,color:{rgb:'595959'}},alignment:{horizontal:'left',wrapText:true}}); ws[XLSX.utils.encode_cell({r:3,c:0})].v=note;
}
function scwbExportXlsx(){
  if(!scwbData){$('scwb-status').innerHTML='✗ 請先載入柱軸力並計算';return;}
  const za=sec=>{const s=model.sections[sec]||{},m=model.materials[s.mat]||{};return {Z:s.z33||0,A:s.area||0,fy:m.fy||0};};
  const rnd=(v,n)=>v==null||isNaN(v)?null:+(+v).toFixed(n);
  const dash=(v,n)=>v==null||isNaN(v)?'—':rnd(v,n);
  const jCols={},jBeams={};
  for(const id in scwbData.cols){const f=scwbData.cols[id].f;(jCols[f.i]||(jCols[f.i]=[])).push(id);(jCols[f.j]||(jCols[f.j]=[])).push(id);}
  for(const id in scwbData.beams){const f=scwbData.beams[id].f;(jBeams[f.i]||(jBeams[f.i]=[])).push(id);(jBeams[f.j]||(jBeams[f.j]=[])).push(id);}

  /* 逐節點彙整 */
  const J_DATA=[];
  for(const J in scwbData.res){
    const rr=scwbData.res[J]; const j=model.joints[J];
    const cs=jCols[J]||[], bs=jBeams[J]||[];
    const colRows=cs.map(id=>{const c=scwbData.cols[id],p=za(c.sec);
      return {id,sec:c.sec,role:c.lower===J?'上柱':'下柱',Z:p.Z,A:p.A,fy:p.fy,
        Puc:rr.govCombo!=null?scwbAxialGet(scwbData.axial,id,J,rr.govCombo):null};});
    colRows.sort((a,b)=>(a.role==='上柱'?0:1)-(b.role==='上柱'?0:1));
    const mkBeam=id=>{const b=scwbData.beams[id],p=za(b.sec);return {id,sec:b.sec,Z:p.Z,fy:p.fy,pin:scwbPinAt(b.f,J)};};
    const xb=bs.filter(id=>scwbData.beams[id].dir==='X').map(mkBeam);
    const yb=bs.filter(id=>scwbData.beams[id].dir==='Y').map(mkBeam);
    J_DATA.push({J,z:j.z,combo:rr.govCombo,cols:colRows,xb,yb,top:rr.top,base:!!model.restraints[J],
      rX:rr.rX,rY:rr.rY,verdict:rr.verdict,exempt:rr.exempt,clause:rr.clause,compactAll:rr.compactAll,
      thr:rr.thr,pucMax:rr.pucMax,pinX:xb.filter(b=>b.pin).length,pinY:yb.filter(b=>b.pin).length});
  }
  if(!J_DATA.length){$('scwb-status').innerHTML='✗ 無可檢核節點';return;}
  J_DATA.sort((a,b)=>b.z-a.z || ((+a.J||0)-(+b.J||0)));
  const NGC='C00000',OKC='375623',YEL='FFF2CC',EX='D9D2E9',SUMF='E2EFDA',COLF='FDF2E9',BMF='EAF3FB';

  /* ── Sheet 1：檢核結果（16基本欄+5豁免欄=21欄） ── */
  const head1=["接頭節點","高程Z(m)","柱斷面","上柱Puc(tf)","下柱Puc(tf)","控制組合","X向梁斷面(逐支)","Y向梁斷面(逐支)",
    "X向梁數","Y向梁數","比值X","比值Y","最不利比值","判定","鉸接梁X/Y","備註",
    "斷面寬厚比(4.5節)","0.3·Fyc·Ag(tf)","Puc/0.3FycAg","豁免條款(13.6.5)","豁免後判定"];
  const NC1=head1.length;
  const beamList=arr=>arr.length?arr.map(b=>'#'+b.id+' '+scwbFmtSec(b.sec)+(b.pin?'(鉸)':'')).join('；'):'—';
  const aoa1=[["強柱弱梁檢核 — 鋼結構極限設計法規範 13.6.5 梁柱彎矩強度比"],["任何梁柱接頭應滿足下式："],
    ["Σ Zc ( Fyc − Puc / Ag )  ／  Σ Zb · Fyb   ≧  1.25"],
    ["符號：Ag=柱全斷面積　Fyc/Fyb=柱/梁鋼材標稱降伏強度　Puc=柱所需軸向受壓強度(控制組合下柱軸力)　Zc/Zb=柱/梁塑性斷面模數　│　單位 tf, cm (tf/cm²)　│　斷面寬厚比/豁免依 13.6.5 第1(1)款自動判定，1(2)/2款請人工確認"],
    head1];
  const HR1=aoa1.length;
  for(const d of J_DATA){
    const up=d.cols.find(c=>c.role==='上柱'), low=d.cols.find(c=>c.role==='下柱');
    const rs=[d.rX,d.rY].filter(v=>v!=null); const rmin=rs.length?Math.min(...rs):null;
    const judge=rmin!=null?(rmin>=1.25?'OK':'NG'):'—';
    const note=d.top?'頂層(規範可豁免)':(d.base?'基礎':(judge==='NG'?'需檢討':''));
    const pucRatio=d.thr>0?rnd(d.pucMax/d.thr,2):'—';
    aoa1.push([d.J,rnd(d.z,2),scwbFmtSec(d.cols[0]?d.cols[0].sec:''),dash(up?up.Puc:null,1),dash(low?low.Puc:null,1),d.combo||'—',
      beamList(d.xb),beamList(d.yb),d.xb.length,d.yb.length,
      dash(d.rX,3),dash(d.rY,3),dash(rmin,3),judge,d.pinX+'/'+d.pinY,note,
      d.compactAll?'滿足λpd（塑性）':'未滿足λpd',rnd(d.thr,0),pucRatio,d.clause||'',d.verdict]);
  }
  const ws1=XLSX.utils.aoa_to_sheet(aoa1);
  scwbBanner(ws1,NC1,aoa1[0][0],aoa1[2][0],aoa1[3][0]);
  for(let c=0;c<NC1;c++) hd1cell(ws1,HR1-1,c,head1[c]);
  function hd1cell(ws,r,c,txt){_sty(ws,r,c,{font:{name:XF,bold:true,sz:8.5,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'305496'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:_BD}); ws[XLSX.utils.encode_cell({r,c})].v=txt;}
  ws1['!cols']=[7,9,16,8,8,10,30,30,6,6,7,7,8,6,8,16,10,10,11,22,10].map(w=>({wch:w}));
  for(let i=0;i<J_DATA.length;i++){
    const r=HR1+i,d=J_DATA[i];
    const rs=[d.rX,d.rY].filter(v=>v!=null); const rmin=rs.length?Math.min(...rs):null;
    const ng=(rmin!=null&&rmin<1.25), exempt=/^豁免/.test(d.verdict);
    for(let c=0;c<NC1;c++) _sty(ws1,r,c,{font:{name:XF,sz:8.5},alignment:{horizontal:(c===6||c===7||c===19)?'left':'center',vertical:'center',wrapText:(c===6||c===7||c===19)},border:_BD});
    if(ng) _rowStyle(ws1,r,NC1,{fill:{fgColor:{rgb:'FCE4EC'}}});
    _sty(ws1,r,3,{fill:{fgColor:{rgb:YEL}}}); _sty(ws1,r,4,{fill:{fgColor:{rgb:YEL}}});
    if(exempt){for(let c=16;c<21;c++) _sty(ws1,r,c,{fill:{fgColor:{rgb:EX}}}); _sty(ws1,r,20,{font:{name:XF,bold:true,sz:8.5,color:{rgb:'5B3A8E'}}});}
    else if(d.verdict.startsWith('NG')) _sty(ws1,r,20,{font:{name:XF,bold:true,sz:9,color:{rgb:NGC}}});
    else _sty(ws1,r,20,{font:{name:XF,bold:true,sz:8.5,color:{rgb:OKC}}});
  }

  /* ── Sheet 2：公式檢核(可追溯) — 逐節點區塊 ── */
  const head2=["接頭/構材","角色","桿件#","斷面","塑性模數 Z(cm³)","斷面積 Ag(cm²)","降伏強度 Fy(tf/cm²)","柱軸力 Puc(tf)","項目值",
    "分子 ΣZc(Fyc−Puc/Ag)","分母X ΣZbFyb","分母Y ΣZbFyb","比值X","比值Y","最不利比值","判定","控制組合/備註"];
  const NC2=head2.length;
  const aoa2=[["強柱弱梁檢核 — 鋼結構極限設計法規範 13.6.5 梁柱彎矩強度比"],["任何梁柱接頭應滿足下式："],
    ["Σ Zc ( Fyc − Puc / Ag )  ／  Σ Zb · Fyb   ≧  1.25"],
    ["符號：Ag=柱全斷面積　Fyc/Fyb=柱/梁鋼材標稱降伏強度　Puc=柱所需軸向受壓強度(控制組合下柱軸力)　Zc/Zb=柱/梁塑性斷面模數　│　單位 tf, cm (tf/cm²)　│　分子對接頭上下柱求和、分母對該方向梁求和"],
    head2];
  const HR2=aoa2.length;
  const blocks=[];
  for(const d of J_DATA){
    const blk0=aoa2.length, colStart=aoa2.length;
    d.cols.forEach((c,i)=>{
      const item=(c.Puc!=null&&c.A)?c.Z*(c.fy-c.Puc/c.A):null;
      aoa2.push([i===0?d.J:'',c.role,'#'+c.id,scwbFmtSec(c.sec),rnd(c.Z*1e6,0),rnd(c.A*1e4,1),rnd(c.fy/1e4,3),
        dash(c.Puc,1),item!=null?rnd(item*100,0):'—']);
    });
    const colEnd=aoa2.length-1, xbStart=aoa2.length;
    d.xb.forEach(b=>aoa2.push(['','X向梁'+(b.pin?'(鉸)':''),'#'+b.id,scwbFmtSec(b.sec),rnd(b.Z*1e6,0),'',rnd(b.fy/1e4,3),'',rnd(b.Z*b.fy*100,0)]));
    const xbEnd=aoa2.length-1, ybStart=aoa2.length;
    d.yb.forEach(b=>aoa2.push(['','Y向梁'+(b.pin?'(鉸)':''),'#'+b.id,scwbFmtSec(b.sec),rnd(b.Z*1e6,0),'',rnd(b.fy/1e4,3),'',rnd(b.Z*b.fy*100,0)]));
    const ybEnd=aoa2.length-1;
    const num=d.cols.reduce((s,c)=>s+((c.Puc!=null&&c.A)?c.Z*(c.fy-c.Puc/c.A):0),0);
    const dX=d.xb.reduce((s,b)=>s+b.Z*b.fy,0), dY=d.yb.reduce((s,b)=>s+b.Z*b.fy,0);
    const rX=dX>0?num/dX:null, rY=dY>0?num/dY:null;
    const rs=[rX,rY].filter(v=>v!=null); const rmin=rs.length?Math.min(...rs):null;
    const judge=rmin!=null?(rmin>=1.25?'OK':'NG'):'';
    let remark=(d.combo||'—')+(d.top?'　[頂層]':(d.base?'　[基礎]':''));
    if(judge==='NG') remark+=d.exempt?'　▶豁免(免檢)':'　▶需檢討';
    const sumRow=aoa2.length;
    aoa2.push([d.J,'→ 接頭檢核','','','','','','','',rnd(num*100,0),dX>0?rnd(dX*100,0):'',dY>0?rnd(dY*100,0):'',
      rX!=null?rnd(rX,3):'',rY!=null?rnd(rY,3):'',rmin!=null?rnd(rmin,3):'',judge,remark]);
    blocks.push({blk0,colStart,colEnd,xbStart,xbEnd,ybStart,ybEnd,sumRow});
    aoa2.push([]);
  }
  const ws2=XLSX.utils.aoa_to_sheet(aoa2);
  scwbBanner(ws2,NC2,aoa2[0][0],aoa2[2][0],aoa2[3][0]);
  for(let c=0;c<NC2;c++) hd1cell(ws2,HR2-1,c,head2[c]);
  ws2['!cols']=[8,9,7,17,10,10,10,8,10,12,11,11,7,7,8,6,18].map(w=>({wch:w}));
  for(const b of blocks){
    for(let r=b.blk0;r<=b.sumRow;r++) for(let c=0;c<NC2;c++) _sty(ws2,r,c,{font:{name:XF,sz:8.5},alignment:{horizontal:'center'},border:_BD});
    for(let r=b.colStart;r<=b.colEnd;r++) for(let c=1;c<9;c++) _sty(ws2,r,c,{fill:{fgColor:{rgb:COLF}}});
    for(let r=b.colStart;r<=b.colEnd;r++) _sty(ws2,r,7,{fill:{fgColor:{rgb:YEL}}});
    if(b.xbEnd>=b.xbStart||b.ybEnd>=b.ybStart){const s=Math.min(b.xbStart,b.ybStart), e=Math.max(b.xbEnd,b.ybEnd);
      for(let r=s;r<=e;r++) for(let c=1;c<9;c++) _sty(ws2,r,c,{fill:{fgColor:{rgb:BMF}}});}
    for(let c=0;c<NC2;c++) _sty(ws2,b.sumRow,c,{fill:{fgColor:{rgb:SUMF}}});
    _sty(ws2,b.sumRow,0,{font:{name:XF,bold:true,sz:9,color:{rgb:'1F3864'}}});
    const ngHere=ws2[XLSX.utils.encode_cell({r:b.sumRow,c:15})]&&ws2[XLSX.utils.encode_cell({r:b.sumRow,c:15})].v==='NG';
    _sty(ws2,b.sumRow,15,{font:{name:XF,bold:true,sz:10,color:{rgb:ngHere?NGC:OKC}}});
  }

  /* ── Sheet 3：NG彙總 ── */
  const ngList=J_DATA.map(d=>{const rs=[d.rX,d.rY].filter(v=>v!=null);return {...d,rmin:rs.length?Math.min(...rs):null};})
    .filter(d=>d.rmin!=null&&d.rmin<1.25).sort((a,b)=>a.rmin-b.rmin);
  const topN=ngList.filter(d=>d.top).length, exN=ngList.filter(d=>d.exempt).length;
  const head3=["節點","高程Z(m)","柱斷面","比值X","比值Y","最不利比值","頂層?","豁免後判定","條款/備註"];
  const aoa3=[[`NG 節點彙總：共 ${ngList.length} / ${J_DATA.length} 個檢核節點不滿足 ≥1.25`],
    [`其中 ${topN} 個位於頂層，依 13.6.5-1(1) 自動判定豁免 ${exN} 個；其餘 ${ngList.length-exN} 個需檢討(見條款/備註或人工確認 1(2)/2款)。`],
    head3,
    ...ngList.map(d=>[d.J,rnd(d.z,2),scwbFmtSec(d.cols[0]?d.cols[0].sec:''),dash(d.rX,3),dash(d.rY,3),rnd(d.rmin,3),d.top?'是':'',d.verdict,d.clause||''])];
  const ws3=XLSX.utils.aoa_to_sheet(aoa3);
  ws3['!merges']=[0,1].map(rr=>({s:{r:rr,c:0},e:{r:rr,c:head3.length-1}}));
  ws3['!cols']=[7,9,16,8,8,9,7,13,22].map(w=>({wch:w}));
  _sty(ws3,0,0,{font:{name:XF,bold:true,sz:12,color:{rgb:NGC}}});
  _sty(ws3,1,0,{font:{name:XF,sz:9,color:{rgb:'808080'}}});
  for(let c=0;c<head3.length;c++) hd1cell(ws3,2,c,head3[c]);
  for(let i=0;i<ngList.length;i++){const r=3+i,d=ngList[i];
    for(let c=0;c<head3.length;c++) _sty(ws3,r,c,{font:{name:XF,sz:9},alignment:{horizontal:c===8?'left':'center',wrapText:c===8},border:_BD});
    if(!d.exempt) _rowStyle(ws3,r,head3.length,{fill:{fgColor:{rgb:'FFF2CC'}}});
  }

  /* ── Sheet 4：斷面寬厚比與四級分類 ── */
  const usedSecs=new Set([...Object.values(scwbData.cols).map(c=>c.sec),...Object.values(scwbData.beams).map(b=>b.sec)]);
  const head4=["斷面","形狀","Fy(tf/cm²)",
    "檢核項目1","λ1","λpd1","λp1","λr1","分項分類1",
    "檢核項目2","λ2","λpd2","λp2","λr2","分項分類2","控制分類"];
  const wtRows=[];
  for(const sec of [...usedSecs].sort()){
    const w=scwbWtCheck(sec); if(!w) continue;
    const a=w.tw.items[0], b=w.tw.items[1];
    wtRows.push([scwbFmtSec(sec),w.shape,rnd(w.fy,3),
      a?a.name:'—',a?rnd(a.lambda,3):'—',a?rnd(a.limits.pd,3):'—',a?rnd(a.limits.p,3):'—',a?rnd(a.limits.r,3):'—',a?a.label:'—',
      b?b.name:'—',b?rnd(b.lambda,3):'—',b?rnd(b.limits.pd,3):'—',b?rnd(b.limits.p,3):'—',b?rnd(b.limits.r,3):'—',b?b.label:'—',
      w.classification]);
  }
  const aoa4=[["斷面寬厚比與四級分類（台灣鋼結構極限設計法規範 4.5 節）"],
    ["無桿件內力時按強軸受撓判定；λ≤λpd：塑性斷面，λpd<λ≤λp：結實斷面，λp<λ≤λr：半結實斷面，λ>λr：細長肢材斷面。H/I型及箱型均取各受壓肢最不利分類；BOX名稱暫按全滲透銲組合箱型柱。"],
    head4,...wtRows];
  const ws4=XLSX.utils.aoa_to_sheet(aoa4);
  ws4['!merges']=[{s:{r:0,c:0},e:{r:0,c:head4.length-1}},{s:{r:1,c:0},e:{r:1,c:head4.length-1}}];
  ws4['!cols']=[20,8,10,18,8,8,8,8,14,18,8,8,8,8,14,16].map(w=>({wch:w}));
  _sty(ws4,0,0,{font:{name:XF,bold:true,sz:12,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0F2747'}},alignment:{horizontal:'center'}});
  _sty(ws4,1,0,{font:{name:XF,sz:8.5,italic:true,color:{rgb:'595959'}},alignment:{wrapText:true}});
  for(let c=0;c<head4.length;c++) hd1cell(ws4,2,c,head4[c]);
  for(let i=0;i<wtRows.length;i++){const r=3+i;
    for(let c=0;c<head4.length;c++) _sty(ws4,r,c,{font:{name:XF,sz:9},alignment:{horizontal:'center'},border:_BD});
    const cls=wtRows[i][15], ok=cls==='塑性斷面'||cls==='結實斷面';
    _sty(ws4,r,15,{font:{name:XF,bold:true,sz:9,color:{rgb:ok?OKC:NGC}}});
  }

  /* ── Sheet 5：說明 ── */
  const notes=["強柱弱梁檢核 — 說明","",
    "1. 公式(規範13.6.5)：ΣZc(Fyc−Puc/Ag) / ΣZb·Fyb ≧ 1.25。分子對該節點之上、下柱求和；分母對該方向(X或Y)之梁求和。單位 tf, cm。",
    "2. Puc 取值：每節點對全部 "+scwbData.nCombo+" 個組合逐一計算數，取分子(ΣZc(Fyc−Puc/Ag))最小者為控制組合，X/Y向共用同一控制組合。",
    "   柱軸力主要由 SAP『Element Forces - Frames』Load Case 的 P 依主模型 Load Comb 係數重組；P<0(受壓)轉為 Puc>0。舊版 Element Joint Forces 仍可相容匯入。",
    "3. 鉸接梁端：依模型 M3 端點釋放判斷，逐支標示(鉸)，仍計入分母(偏保守)。",
    "4. 斷面寬厚比(4.5節)：按λpd、λp、λr分為塑性、結實、半結實、細長肢材斷面；H/I型及箱型均取各受壓肢最不利分類。詳見「斷面寬厚比」分頁。",
    "5. 豁免(13.6.5第1款)：",
    "   1(1) 頂層柱且該節點所有相關梁柱斷面均滿足 λpd（塑性斷面）、且柱 Puc<0.3·Fyc·Ag(逐柱個別比較) → 本版【自動判定並豁免】。",
    "   1(2) 柱設計剪力<該樓層20%且軸線1/10範圍內<33% → 需地震樓層剪力分配，本版【標示需檢討，供人工確認】。",
    "   2.  該樓層側向剪力強度較上層大50%以上 → 需樓層側向強度，本版【標示需檢討，供人工確認】。",
    "   斷面未滿足 λpd 者，不論頂層與否一律不予自動豁免。",
    "6. 「豁免後判定」欄：OK／豁免(免檢)／NG(需檢討)。非頂層或未滿足 λpd 之 NG 仍須以 1(2)、2 或補強處理。",
    "7. 本檢核採規範簡化分子式(未計柱軸力以外之P-M交互、未含梁端至柱心投影放大)；屬設計層級檢核。",
    "8. 本檔由 S2K＋F2K 基礎整合檢視器(V3.0.7，S2K Viewer v2.4.5) 直接匯出，含完整逐構材可追溯計算書與斷面寬厚比四級分類分頁。"];
  const ws5=XLSX.utils.aoa_to_sheet(notes.map(t=>[t])); ws5['!cols']=[{wch:110}];
  _sty(ws5,0,0,{font:{name:XF,bold:true,sz:13,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0F2747'}}});
  for(let i=2;i<notes.length;i++) if(notes[i]) _sty(ws5,i,0,{font:{name:XF,sz:10},alignment:{wrapText:true}});

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws1,"檢核結果");
  XLSX.utils.book_append_sheet(wb,ws2,"公式檢核(可追溯)");
  XLSX.utils.book_append_sheet(wb,ws3,"NG彙總");
  XLSX.utils.book_append_sheet(wb,ws5,"說明");
  XLSX.utils.book_append_sheet(wb,ws4,"斷面寬厚比");
  XLSX.writeFile(wb,"強柱弱梁_SAP批次檢核.xlsx");
  $('scwb-status').innerHTML='✓ 已下載 強柱弱梁_SAP批次檢核.xlsx（完整版，5分頁）';
}
(function(){const a=document.getElementById('pjz-export'); if(a)a.addEventListener('click',pjzExportXlsx);
 const b=document.getElementById('scwb-export'); if(b)b.addEventListener('click',scwbExportXlsx);})();


/* ════════ S2K＋F2K FOUNDATION WORKSPACE / 3D OVERLAY v2.5.1 ════════ */
const FOUNDATION_PARENT_SOURCE='s2k-f2k-parent-v250';
const FOUNDATION_CHILD_SOURCE='s2k-f2k-foundation-v250';
let foundationFrameLoaded=false, foundationBridgeReady=false, foundationSyncAttempted=false, pendingFoundationJoint='';
const foundationUi={
  showSlab:true,showPedestal:true,showGrid:false,showLabels:true,showAll:true
};

function foundationPost(message){
  const frame=$('foundation-frame');
  if(frame&&frame.contentWindow)frame.contentWindow.postMessage({source:FOUNDATION_PARENT_SOURCE,...message},'*');
}
function ensureFoundationFrame(){
  const frame=$('foundation-frame');
  if(foundationFrameLoaded)return frame;
  const raw=$('foundation-source-v2312').textContent.trim();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  frame.srcdoc=new TextDecoder('utf-8').decode(bytes);
  foundationFrameLoaded=true;
  return frame;
}
function syncS2KToFoundation(){
  if(!foundationBridgeReady||!currentS2KText)return;
  foundationSyncAttempted=true;
  foundationPost({type:'load-s2k',text:currentS2KText,fileName:currentS2KFileName});
  $('foundation-workspace-status').textContent='S2K 已同步；請確認柱位、反力與 Load Comb 套用方式';
}
function foundationMatchesS2K(){
  if(!currentS2KFileName)return true;
  return String(foundationState?.s2kImport?.fileName||'')===String(currentS2KFileName);
}
function openFoundationWorkspace(joint=''){
  pendingFoundationJoint=String(joint||'');
  const ws=$('foundation-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  ensureFoundationFrame();
  if(foundationBridgeReady){
    foundationPost({type:'request-state'});
  }
}
function closeFoundationWorkspace(){
  const ws=$('foundation-workspace');
  ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
  foundationPost({type:'request-state'});
}
function foundationStatusColor(status){
  return status==='ok'?0x3ecf8e:status==='ng'||status==='error'?0xff5c67:status==='partial'?0xf0a500:0x4da3ff;
}
function uniqueNumbers(values){
  return [...new Set(values.filter(Number.isFinite).map(v=>Math.round(v*1e8)/1e8))].sort((a,b)=>a-b);
}
function foundationBaseZ(f){
  const zs=(f.joints||[]).map(j=>model?.joints?.[String(j.joint)]?.z).filter(Number.isFinite);
  if(zs.length)return Math.min(...zs);
  const note=String((f.joints||[])[0]?.note||'');
  const m=note.match(/Z=([+-]?\d+(?:\.\d+)?)/i);
  return m?Number(m[1]):0;
}
function addFoundationMesh(group,f,vertices,topZ,bottomZ,color){
  const shape=new THREE.Shape();
  vertices.forEach((v,i)=>i?shape.lineTo(+v.x,+v.y):shape.moveTo(+v.x,+v.y));
  shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.01,topZ-bottomZ),bevelEnabled:false,curveSegments:1});
  geo.rotateX(-Math.PI/2);
  geo.translate(0,bottomZ,0);
  const mat=new THREE.MeshLambertMaterial({color,transparent:true,opacity:.72,side:THREE.DoubleSide,depthWrite:true});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.userData={type:'foundation',ref:f};
  group.add(mesh);
  const linePts=vertices.map(v=>toThree(+v.x,+v.y,topZ));
  linePts.push(linePts[0].clone());
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts),new THREE.LineBasicMaterial({color})));
}
function renderFoundationOverlay(){
  clearGroup(gFoundations);gFoundations=new THREE.Group();
  if(!scene||!foundationState?.foundations?.length||!foundationMatchesS2K()){if(scene)scene.add(gFoundations);return}
  const activeId=foundationState.activeFoundationId;
  const selected=foundationUi.showAll?foundationState.foundations:foundationState.foundations.filter(f=>f.id===activeId);
  for(const f of selected){
    const p=f.parameters||{},vertices=(f.vertices||[]).filter(v=>Number.isFinite(+v.x)&&Number.isFinite(+v.y));
    if(vertices.length<3)continue;
    const baseZ=foundationBaseZ(f),h=Math.max(0,+p.pedestalHeight||0),w=Math.max(0,+p.coverDepth||0),t=Math.max(.01,+p.slabThickness||.01);
    const topZ=baseZ-h-w,bottomZ=topZ-t,status=f.lastResult?.status||'idle',color=foundationStatusColor(status);
    if(foundationUi.showSlab)addFoundationMesh(gFoundations,f,vertices,topZ,bottomZ,color);
    if(bbox)for(const v of vertices){bbox.expandByPoint(toThree(+v.x,+v.y,topZ));bbox.expandByPoint(toThree(+v.x,+v.y,bottomZ))}
    if(foundationUi.showPedestal){
      for(const j of f.joints||[]){
        if(j.active===false||!Number.isFinite(+j.x)||!Number.isFinite(+j.y))continue;
        const jointZ=model?.joints?.[String(j.joint)]?.z??baseZ;
        const height=Math.max(.02,jointZ-topZ),a=Math.max(.05,+j.a||.05),b=Math.max(.05,+j.b||.05);
        const pmr=pmResults.get(String(j.joint));
        const ped=new THREE.Mesh(new THREE.BoxGeometry(a,height,b),new THREE.MeshLambertMaterial({color:pmr?(pmr.ok?0x3ecf8e:0xff5c67):0x8b9bad,transparent:true,opacity:.9}));
        ped.position.copy(toThree(+j.x,+j.y,topZ+height/2));
        gFoundations.add(ped);
        const mark=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.08,Math.min(a,b)*.13),12,10),new THREE.MeshLambertMaterial({color:0xffd866}));
        mark.position.copy(toThree(+j.x,+j.y,jointZ));gFoundations.add(mark);
        if(foundationUi.showLabels)gFoundations.add(makeLabel('J'+j.joint+(pmr&&Number.isFinite(pmr.worstRatio)?' PM '+pmr.worstRatio.toFixed(2):''),'#ffd866',toThree(+j.x,+j.y,jointZ+.22),.55));
      }
    }
    if(foundationUi.showLabels){
      const cx=vertices.reduce((s,v)=>s+(+v.x),0)/vertices.length,cy=vertices.reduce((s,v)=>s+(+v.y),0)/vertices.length;
      const tag=status==='ok'?'OK':status==='ng'?'NG':status==='partial'?'部分完成':'未計算';
      gFoundations.add(makeLabel(f.name+'｜'+tag,'#ffffff',toThree(cx,cy,topZ+.18),.72));
    }
    if(foundationUi.showGrid){
      const xs=uniqueNumbers([...vertices.map(v=>+v.x),...(f.joints||[]).map(j=>+j.x)]);
      const ys=uniqueNumbers([...vertices.map(v=>+v.y),...(f.joints||[]).map(j=>+j.y)]);
      const minX=Math.min(...vertices.map(v=>+v.x)),maxX=Math.max(...vertices.map(v=>+v.x));
      const minY=Math.min(...vertices.map(v=>+v.y)),maxY=Math.max(...vertices.map(v=>+v.y)),pad=.6;
      const gm=new THREE.LineDashedMaterial({color:0x2dd4bf,dashSize:.22,gapSize:.12,transparent:true,opacity:.9});
      for(const x of xs){const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree(x,minY-pad,topZ+.03),toThree(x,maxY+pad,topZ+.03)]),gm);ln.computeLineDistances();gFoundations.add(ln)}
      for(const y of ys){const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree(minX-pad,y,topZ+.03),toThree(maxX+pad,y,topZ+.03)]),gm);ln.computeLineDistances();gFoundations.add(ln)}
    }
  }
  scene.add(gFoundations);
  if(bbox&&!bbox.isEmpty()){bbox.getCenter(modelCenter);modelRadius=Math.max(bbox.getSize(new THREE.Vector3()).length()/2,5)}
}
function renderFoundationSummary(){
  const card=$('foundation-card'),toolbar=$('foundation-toolbar'),sum=$('foundation-summary'),list=$('foundation-list');
  const fs=foundationState?.foundations||[];
  const matched=foundationMatchesS2K();
  card.classList.toggle('ready',!!fs.length||!!currentS2KText);toolbar.classList.toggle('ready',!!fs.length&&matched);
  if(fs.length&&!matched){sum.innerHTML='<b>S2K 尚未套用</b><br>請開啟基礎工作區，確認柱位、反力與 Load Comb。';list.innerHTML='';return}
  if(!fs.length){sum.textContent='尚未建立基礎';list.innerHTML='';return}
  const joints=fs.reduce((n,f)=>n+(f.joints||[]).filter(j=>j.active!==false).length,0);
  const done=fs.filter(f=>f.lastResult&&f.lastResult.status!=='idle').length;
  sum.innerHTML='<b>'+fs.length+'</b> 塊基礎・<b>'+joints+'</b> 個啟用 Joint<br>已計算 '+done+'/'+fs.length+'・原座標疊圖';
  list.innerHTML=fs.map(f=>{
    const st=f.lastResult?.status||'idle';
    return '<button class="foundation-chip '+(f.id===foundationState.activeFoundationId?'active ':'')+st+'" data-fid="'+f.id+'">'+f.name+'</button>';
  }).join('');
  list.querySelectorAll('[data-fid]').forEach(b=>b.addEventListener('click',()=>{
    foundationState.activeFoundationId=b.dataset.fid;
    foundationPost({type:'select-foundation',foundationId:b.dataset.fid});
    renderFoundationSummary();rebuild(false);
  }));
}
function toggleFoundationButton(id,key){
  const b=$(id);
  b.addEventListener('click',()=>{
    foundationUi[key]=!foundationUi[key];
    b.classList.toggle('active',foundationUi[key]);
    if(key==='showAll')b.textContent=foundationUi[key]?'全部基礎':'目前基礎';
    rebuild(false);
  });
}
window.addEventListener('message',ev=>{
  const d=ev.data||{};if(d.source!==FOUNDATION_CHILD_SOURCE)return;
  if(d.type==='ready'){
    foundationBridgeReady=true;
    $('foundation-workspace-status').textContent='基礎工作區已就緒';
    foundationPost({type:'request-state'});
  }else if(d.type==='state'){
    foundationState=d.payload||null;
    if(currentS2KText&&!foundationMatchesS2K()&&!foundationSyncAttempted)syncS2KToFoundation();
    if(pendingFoundationJoint&&foundationMatchesS2K()){const joint=pendingFoundationJoint;pendingFoundationJoint='';foundationPost({type:'select-joint',joint})}
    renderFoundationSummary();
    if(model)rebuild(false);
  }else if(d.type==='s2k-ready'){
    const x=d.payload||{};
    $('foundation-workspace-status').textContent='S2K 已解析：'+(x.baseJoints||0)+' 柱腳・'+(x.reactions||0)+' 反力・'+(x.combinations||0)+' 組合';
  }else if(d.type==='error'){
    $('foundation-workspace-status').textContent='同步錯誤：'+String(d.message||'未知錯誤');
  }
});
$('btn-foundation-workspace').addEventListener('click',()=>openFoundationWorkspace());
$('btn-foundation-sidebar').addEventListener('click',()=>openFoundationWorkspace());
$('btn-foundation-back').addEventListener('click',closeFoundationWorkspace);
$('btn-foundation-sync').addEventListener('click',syncS2KToFoundation);
$('btn-foundation-f2k').addEventListener('click',()=>foundationPost({type:'open-f2k'}));
toggleFoundationButton('tg-foundations','showSlab');
toggleFoundationButton('tg-pedestals','showPedestal');
toggleFoundationButton('tg-safe-grid','showGrid');
toggleFoundationButton('tg-foundation-labels','showLabels');
toggleFoundationButton('tg-all-foundations','showAll');


/* ════════ V3.1.0 柱墩 RC 雙軸 P-M 檢核橋接（子頁 s2k-f2k-pm-v310） ════════ */
const PM_CHILD_SOURCE='s2k-f2k-pm-v310';
let pmFrameLoaded=false,pmBridgeReady=false,pmLastJoint='',pmNote='';
const pmResults=new Map();   // joint -> {joint,section,worstRatio,worstName,ok,rows}
const pmJointH=new Map();    // joint -> 送出檢核時採用的柱墩高度 H（m）
const pmPending=[];          // 子頁 ready 前的指令暫存

function pmPost(message){
  const frame=$('pm-frame');
  if(!pmBridgeReady||!frame||!frame.contentWindow){pmPending.push(message);return}
  frame.contentWindow.postMessage({source:FOUNDATION_PARENT_SOURCE,...message},'*');
}
function ensurePmFrame(){
  const frame=$('pm-frame');
  if(pmFrameLoaded)return frame;
  const raw=$('module-source-pm-v100').textContent.trim();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  frame.srcdoc=new TextDecoder('utf-8').decode(bytes);
  pmFrameLoaded=true;
  return frame;
}
function openPmWorkspace(){
  const ws=$('pm-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  ensurePmFrame();
  if(pmBridgeReady)pmPost({type:'request-state'});
}
function closePmWorkspace(){
  const ws=$('pm-workspace');
  ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
}
/* 資料脈絡：優先用已建立的 V3 專案，否則用「模型＋分析結果」自動產生的 draft */
function pmCtx(){
  const p=V300.activeProject;
  if(p&&(p.reactionDataset?.rows||[]).length)
    return {supportJoints:p.supportJoints||[],reactionRows:p.reactionDataset.rows,
            combinations:p.loadDefinitions?.combinations||[],isDraft:false};
  const d=V300.draft;
  if(d&&(d.reactionDataset?.rows||[]).length)
    return {supportJoints:v300SupportJoints(),reactionRows:d.reactionDataset.rows,
            combinations:d.loadDefinitions?.combinations||[],isDraft:true};
  return null;
}
/* 該柱腳所屬的基礎：優先取基礎工作區即時狀態，其次取專案已存的基礎元素
   （後者讓使用者不必先開一次基礎工作區） */
function pmFoundationOf(jointId){
  const id=String(jointId);
  for(const f of foundationState?.foundations||[])
    for(const j of f.joints||[])
      if(String(j.joint)===id&&j.active!==false)
        return {name:String(f.name||f.id||''),H:v300Num(f.parameters?.pedestalHeight,0)};
  for(const f of V300.activeProject?.foundationElements||[])
    if((f.jointIds||[]).some(x=>String(x)===id))
      return {name:String(f.name||f.id||''),H:v300Num(f.pedestalHeight,0)};
  return null;
}
/* 全案基礎清單（同樣兩層來源），用於顯示柱墩高度一覽 */
function pmFoundationList(){
  const fs=foundationState?.foundations||[];
  if(fs.length)return fs.map(f=>({name:String(f.name||f.id||''),H:v300Num(f.parameters?.pedestalHeight,0)}));
  return (V300.activeProject?.foundationElements||[]).map(f=>({name:String(f.name||f.id||''),H:v300Num(f.pedestalHeight,0)}));
}
/* 柱墩高度：唯一來源＝基礎設定的 pedestalHeight（公尺）。未設定基礎時回 null。 */
function pmHeight(jointId){
  const f=pmFoundationOf(jointId);
  return f?Math.max(0,f.H):null;
}
/* 柱墩斷面：先找基礎模組的 joint a／b（公尺），退而求專案 supportJoints */
function pmSection(jointId){
  const id=String(jointId);
  for(const f of foundationState?.foundations||[]){
    for(const j of f.joints||[]){
      if(String(j.joint)===id&&+j.a>0&&+j.b>0)return {bMm:+j.a*1000,hMm:+j.b*1000};
    }
  }
  const s=(pmCtx()?.supportJoints||[]).find(j=>String(j.id)===id);
  if(s&&+s.a>0&&+s.b>0)return {bMm:+s.a*1000,hMm:+s.b*1000};
  return null;
}
/* 可檢核柱墩：有柱底反力、且已在基礎工作區指派基礎（才有柱墩 a／b／H） */
function pmJointIds(){
  const ctx=pmCtx();if(!ctx)return [];
  const has=new Set(ctx.reactionRows.map(r=>String(r.joint)));
  return ctx.supportJoints.map(j=>String(j.id))
    .filter(id=>has.has(id)&&pmFoundationOf(id));
}
/* 柱底反力（Tonf, m，全域軸，含該節點所有構件含斜撐）→ 柱墩底設計力
   P=Σf×F3、Mx=Σf×(M1+F2·H)、My=Σf×(M2+F1·H)；H 取該柱所屬基礎的柱墩高度 */
function pmJointPayload(jointId){
  const id=String(jointId),ctx=pmCtx();
  if(!ctx)return null;
  const fnd=pmFoundationOf(id);if(!fnd)return null;
  const H=pmHeight(id);if(H===null)return null;
  const src=ctx.reactionRows.filter(r=>String(r.joint)===id);
  if(!src.length)return null;
  const byCase=new Map(src.map(r=>[String(r.case),r]));
  const axes='Joint Reactions 全域軸（含該節點所有構件）→ 柱墩底｜基礎 '+(fnd.name||'')+'　柱墩高 H='+H+' m';
  const mk=(k,r)=>({P:k*v300Num(r.F3),
    Mx:k*(v300Num(r.M1)+v300Num(r.F2)*H),
    My:k*(v300Num(r.M2)+v300Num(r.F1)*H)});
  /* V4.15.0：柱墩 RC 斷面應以「極限強度組合」檢核。
     憑據一：`4.2 載重組合產生器.V3` 顯示同一組合在不同 SAP 版本匯出時命名不同——
       SAP2000_9版＝101／102…，SAP2000_22／23版＝USD001／USD002…，兩者是同一套。
     憑據二：實測工務大樓 USD001～079 與 LRFD001～079 的係數**逐組完全相同**（79/79），
       只是前者旗標為 None、後者為 Strength；PR B 的數字系列係數樣式亦相同
       （1.4D／1.2D+1.6L／1.2D+1L±1EXP+0.3EV）。
     → 因此以 SteelDesign=Strength 篩選，在這兩個模型中與取 USD 等價。
     ⚠ 這是這兩個模型的性質而非通則：若某模型只有 USD 而無 Strength 旗標，
       comboScopeAllow 會取不到任何組合，故下方在篩選後為空時自動回退為不過濾。 */
  const pmScope=comboScopeOf('pm-combo-scope');
  const pmSc=comboScopeAllow(pmScope);
  let useCombos=ctx.combinations;
  if(pmSc){
    const f=ctx.combinations.filter(c=>pmSc.allow.has(String(c.name)));
    if(f.length)useCombos=f;
  }
  pmComboInfo={scope:pmScope,used:useCombos.length,total:ctx.combinations.length};
  const rows=[];
  for(const c of useCombos){
    const acc={P:0,Mx:0,My:0};let hit=false;
    for(const [cn,fv] of Object.entries(c.factors||{})){
      const r=byCase.get(String(cn));if(!r)continue;
      const d=mk(v300Num(fv),r);hit=true;acc.P+=d.P;acc.Mx+=d.Mx;acc.My+=d.My;
    }
    if(hit)rows.push({name:String(c.name),P_tf:acc.P,Mx_tfm:acc.Mx,My_tfm:acc.My});
  }
  if(!rows.length)for(const [cn,r] of byCase){
    const d=mk(1,r);rows.push({name:String(cn),P_tf:d.P,Mx_tfm:d.Mx,My_tfm:d.My});
  }
  if(!rows.length)return null;
  const item={joint:id,rows,axes},section=pmSection(id);
  if(section)item.section=section;
  return item;
}
let pmComboInfo=null;
const PM_NO_DATA='尚未有柱底反力：請先匯入第二個 Analysis Results S2K（需含 Joint Reactions）。';
const PM_NO_FOUNDATION='尚未設定基礎：柱墩尺寸（a×b）與柱墩高度 H 由基礎工作區設定，請先建立基礎並指派柱腳。';
function pmApplyJoint(jointId,open){
  if(!pmCtx()){pmNote=PM_NO_DATA;renderPmSummary();return}
  const item=pmJointPayload(jointId);
  if(!item){pmNote='J'+jointId+' 尚未指派基礎或無柱底反力，未送出。';renderPmSummary();return}
  pmNote='';pmJointH.set(String(jointId),pmHeight(jointId));
  ensurePmFrame();
  if(open)openPmWorkspace();
  pmPost({type:'pm-apply',payload:item});
  $('pm-workspace-status').textContent='已送出 J'+jointId+'（'+item.rows.length+' 組載重），等待計算…';
  renderPmSummary();
}
function pmCheckAll(){
  if(!pmCtx()){pmNote=PM_NO_DATA;renderPmSummary();return}
  const items=pmJointIds().map(id=>pmJointPayload(id)).filter(Boolean);
  if(!items.length){pmNote=PM_NO_FOUNDATION;renderPmSummary();return}
  pmNote='';
  items.forEach(x=>pmJointH.set(String(x.joint),pmHeight(x.joint)));
  ensurePmFrame();openPmWorkspace();
  pmPost({type:'pm-batch',payload:{items}});
  $('pm-workspace-status').textContent='已送出 '+items.length+' 柱批次檢核…';
  renderPmSummary();
}
/* 結果過期：基礎工作區把該柱的柱墩高度改掉了 */
function pmStale(id){
  const H=pmHeight(id);
  return H!==null&&pmResults.has(String(id))&&Math.abs((pmJointH.get(String(id))??H)-H)>1e-9;
}
function renderPmSummary(){
  const card=$('pm-card'),sum=$('pm-summary'),list=$('pm-list');
  if(!card||!sum||!list)return;
  const ctx=pmCtx();
  card.classList.add('ready');/* 卡片恆顯示；未備妥時於卡內說明缺哪一步 */
  const step=$('pm-steps');
  const hasFnd=!!pmFoundationList().length;
  if(step)step.innerHTML='<span class="'+(ctx?'done':'todo')+'">① 柱底反力</span>'+
    '<span class="'+(hasFnd?'done':'todo')+'">② 基礎與柱墩設定</span>'+
    '<span class="'+(pmResults.size?'done':'todo')+'">③ 柱墩 P-M 檢核</span>';
  if(!ctx){sum.innerHTML='<b>① 尚未有柱底反力</b><br>請先匯入第二個 Analysis Results S2K（需含 Joint Reactions）。';list.innerHTML='';return}
  const ids=pmJointIds();
  /* 柱墩高度一覽：唯一來源為基礎工作區，逐基礎顯示避免與基礎設定衝突 */
  const hs=[...new Map(pmFoundationList().map(f=>[f.name,f.H])).entries()]
    .map(([n,h])=>v300Esc(n)+' H='+h+' m').join('・');
  const originNote='柱墩尺寸 a×b 與高度 H 由基礎工作區設定（單一來源）'+(hs?'：'+hs:'')+
    '<br>內力：Joint Reactions 全域軸（含該節點所有構件，含斜撐）→ 加 H 力臂至柱墩底';
  if(!ids.length){sum.innerHTML='<b>② 尚未設定基礎</b><br>'+v300Esc(pmNote||PM_NO_FOUNDATION)+
    '<br><span class="pm-origin">'+originNote+'</span>';list.innerHTML='';return}
  let worst=null,worstJoint='',ng=0,done=0,stale=0;
  for(const id of ids){
    const r=pmResults.get(String(id));if(!r)continue;
    done++;if(!r.ok)ng++;if(pmStale(id))stale++;
    if(Number.isFinite(r.worstRatio)&&(worst===null||r.worstRatio>worst)){worst=r.worstRatio;worstJoint=String(id)}
  }
  sum.innerHTML='已檢核 <b>'+done+'</b>/'+ids.length+' 柱・全案最大 ratio <b>'+(worst===null?'—':worst.toFixed(3))+'</b>'+(worstJoint?'（J'+v300Esc(worstJoint)+'）':'')+
    '<br>NG 柱數 <b>'+ng+'</b>'+(stale?'<br><b>'+stale+'</b> 柱結果已過期（基礎的柱墩高度已變更，請重新檢核）':'')+(pmNote?'<br>'+v300Esc(pmNote):'')+
    '<br><span class="pm-origin">'+originNote+'</span>';
  list.innerHTML=ids.map(id=>{
    const r=pmResults.get(String(id)),cls=r?(r.ok?'ok':'ng'):'',st=pmStale(id)?' stale':'';
    const tip=r?('最大 ratio '+(Number.isFinite(r.worstRatio)?r.worstRatio.toFixed(3):'超限')+(r.worstName?'｜'+r.worstName:''))+(st?'（已過期）':''):'尚未檢核';
    return '<button class="pm-chip '+cls+st+'" data-pmj="'+v300Esc(id)+'" title="'+v300Esc(tip)+'">J'+v300Esc(id)+(r&&Number.isFinite(r.worstRatio)?' '+r.worstRatio.toFixed(2):'')+'</button>';
  }).join('');
  list.querySelectorAll('[data-pmj]').forEach(b=>b.addEventListener('click',()=>pmApplyJoint(b.dataset.pmj,true)));
}
window.addEventListener('message',ev=>{
  const d=ev.data||{};if(d.source!==PM_CHILD_SOURCE)return;
  if(d.type==='ready'){
    pmBridgeReady=true;
    $('pm-workspace-status').textContent='P-M 檢核模組已就緒';
    const queued=pmPending.splice(0);
    for(const m of queued)pmPost(m);
    pmPost({type:'request-state'});
  }else if(d.type==='pm-state'){
    const p=d.payload||{};pmLastJoint=String(p.lastJoint||'');
    for(const r of p.results||[])if(r&&r.joint!=null)pmResults.set(String(r.joint),r);
    $('pm-workspace-status').textContent='已檢核 '+pmResults.size+' 柱'+(pmLastJoint?'・目前 J'+pmLastJoint:'');
    renderPmSummary();
    if(model)rebuild(false);
  }else if(d.type==='error'){
    $('pm-workspace-status').textContent='P-M 模組錯誤：'+String(d.message||'未知錯誤');
  }
});
$('btn-pm-workspace').addEventListener('click',()=>openPmWorkspace());
$('btn-pm-all').addEventListener('click',()=>pmCheckAll());
$('btn-pm-back').addEventListener('click',closePmWorkspace);
$('btn-pm-from-foundation').addEventListener('click',()=>{closeFoundationWorkspace();pmCheckAll()});


/* ════════ V4.15.0 剪力釘釘群模組（SRC 合成柱／梁）════════ */
const STUD_CHILD_SOURCE='s2k-f2k-stud-v400';
let studFrameLoaded=false,studBridgeReady=false,studPending=[],studResult=null,studNote='';
function studPost(message){
  const frame=$('stud-frame-el');
  if(!studBridgeReady||!frame||!frame.contentWindow){studPending.push(message);return}
  frame.contentWindow.postMessage({source:FOUNDATION_PARENT_SOURCE,...message},'*');
}
function ensureStudFrame(){
  const frame=$('stud-frame-el');
  if(studFrameLoaded)return frame;
  const raw=$('module-source-stud-v100').textContent.trim();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  frame.srcdoc=new TextDecoder('utf-8').decode(bytes);
  studFrameLoaded=true;
  return frame;
}
function openStudWorkspace(){
  const ws=$('stud-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  ensureStudFrame();
  if(studBridgeReady)studPost({type:'request-state'});
}
function closeStudWorkspace(){
  const ws=$('stud-workspace');
  ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
}
/* 自建 Element Forces 索引。
   不沿用 V304.forceIndex：它遇到同一斷面同一 Load Case 的重複列時，會把該 Case 從
   所有斷面一併刪除（PR B 會因此清光 11 個 Load Case）。這裡改為重複時取第一筆。 */
let studIdxCache=null,studIdxSrc=null;
function studIndex(){
  if(studIdxCache&&studIdxSrc===V304.imported)return studIdxCache;
  const rows=V304.imported?.rows||[];
  const defs=v304ComboDefinitions(),known=new Set(defs.keys());
  const elemToObj=new Map((V304.imported?.elements||[]).map(e=>[String(e.id),String(e.object)]));
  const idx=new Map();
  for(const r of rows){
    if(known.has(r.OutputCase)||/comb/i.test(r.CaseType))continue;
    const step=String(r.StepType||'').trim();
    if(step&&/max|min|envelope|mode|time/i.test(step))continue;
    const rid=String(r.FrameElem||r.Frame),st=Number(r.ElemStation==null?r.Station:r.ElemStation);
    if(!Number.isFinite(st))continue;
    const key=rid+'\u001f'+st.toPrecision(12);
    if(!idx.has(key))idx.set(key,{key,resultId:rid,station:st,object:elemToObj.get(rid)||rid,cases:new Map()});
    const e=idx.get(key);
    if(!e.cases.has(r.OutputCase))e.cases.set(r.OutputCase,r);
  }
  studIdxCache={defs,idx};studIdxSrc=V304.imported;
  return studIdxCache;
}
function studKeys(){
  return [...studIndex().idx.values()]
    .sort((a,b)=>a.object.localeCompare(b.object,undefined,{numeric:true})||a.station-b.station);
}
function studObjects(){
  const map=new Map();
  for(const k of studKeys()){
    if(!map.has(k.object))map.set(k.object,[]);
    map.get(k.object).push(k);
  }
  return map;
}
/* 依 Load Comb 線性重組某斷面的局部軸內力 */
/* V4.15.0：共用的載重組合範圍篩選。
   COMBINATION DEFINITIONS 每組帶 SteelDesign=Strength／Deflection／None，
   SAP 只用 Strength 做鋼構強度設計。
   ⚠ 只有 SteelDesign 可靠——PR B 與工務大樓兩個模型的 ConcDesign **全部為 None**
   （工程師未設定，連明顯是 RC 極限組合的 USD 也是 None），
   故本篩選僅適用鋼構模組；柱墩／基礎走 Joint Reactions 路徑，不套用。 */
function comboScopeNames(defs,scope){
  const names=[];let excluded=0;
  for(const name of defs.keys()){
    const sd=String(defs.get(name)?.steelDesign||'');
    if(scope==='strength'&&sd&&sd!=='Strength'){excluded++;continue}
    names.push(name);
  }
  return {names,excluded};
}
function comboScopeOf(id){return $(id)?.value||'strength'}
/* V4.15.0：Joint Reactions 路徑用的版本。
   pmCtx().combinations 是另一套 {name,factors} 結構、不帶旗標，
   故改由 v304ComboDefinitions() 依「組合名稱」查 SteelDesign。
   回傳 null 代表不過濾。 */
function comboScopeAllow(scope){
  if(scope!=='strength')return null;
  let defs;try{defs=v304ComboDefinitions()}catch(e){return null}
  if(!defs||!defs.size)return null;
  const {names,excluded}=comboScopeNames(defs,'strength');
  return {allow:new Set(names.map(String)),excluded};
}
function studCombine(entry,comboName,defs){
  const flat=v304FlattenLinear(String(comboName),defs);
  if(!flat.ok)return null;
  const out={};
  for(const comp of ['P','V2','V3','T','M2','M3']){
    let sum=0,ok=true;
    for(const [cn,fv] of Object.entries(flat.factors)){
      const v=entry.cases.get(cn)?.[comp];
      if(v==null||!Number.isFinite(Number(v))){ok=false;break}
      sum+=Number(fv)*Number(v);
    }
    out[comp]=ok?sum:null;
  }
  return out;
}
function studFrameLabel(objId){
  const f=(model?.frames||[]).find(x=>String(x.id)===String(objId));
  if(!f)return 'Frame '+objId;
  const a=model.joints[String(f.i)],b=model.joints[String(f.j)];
  let kind='桿件';
  if(a&&b){
    const dz=Math.abs(b.z-a.z),dr=Math.hypot(b.x-a.x,b.y-a.y);
    kind=dz>1e-6&&dr<=dz*.2?'柱':dz<=1e-6?'梁':'斜撐';
  }
  return 'Frame '+objId+'（'+kind+(f.sect?'・'+f.sect:'')+'）';
}
function renderStudPick(){
  const objs=studObjects(),sel=$('stud-frame'),pick=$('stud-pick');
  if(!sel||!pick)return;
  if(!objs.size){pick.style.display='none';return}
  pick.style.display='';
  const prev=sel.value;
  sel.innerHTML=[...objs.keys()].map(id=>'<option value="'+v300Esc(id)+'">'+v300Esc(studFrameLabel(id))+'</option>').join('');
  if(prev&&objs.has(prev))sel.value=prev;
  renderStudStations();
}
let studStationList=[];/* 以索引當 option value：key 內含 U+001F，放進 HTML 屬性會被瀏覽器破壞 */
function renderStudStations(){
  const sel=$('stud-station'),obj=$('stud-frame')?.value;if(!sel)return;
  studStationList=studObjects().get(String(obj))||[];
  const prev=sel.value;
  sel.innerHTML=studStationList.map((k,i)=>'<option value="'+i+'">'+v300Esc(k.resultId)+' @ '+k.station.toFixed(3)+' m</option>').join('');
  if(prev&&studStationList[+prev])sel.value=prev;
}
/* 逐組合取 Element Forces 局部軸內力（單位 Tonf, m，與釘群工具的 tf-m 選項一致） */
function studPayload(){
  const pick=studStationList[+($('stud-station')?.value??-1)];if(!pick)return null;
  const {defs}=studIndex();
  const scope=comboScopeOf('stud-combo-scope');
  const {names:scopeNames,excluded}=comboScopeNames(defs,scope);
  const rows=[];
  for(const name of scopeNames){
    const c=studCombine(pick,name,defs);
    if(!c||c.P==null||c.M2==null||c.M3==null)continue;
    rows.push({name:String(name),P:c.P,V2:v300Num(c.V2),V3:v300Num(c.V3),T:v300Num(c.T),M2:c.M2,M3:c.M3});
  }
  if(!rows.length)return null;
  return {frame:pick.resultId,station:pick.station,rows,
    label:studFrameLabel(pick.object)+'　'+pick.resultId+' @ '+pick.station.toFixed(3)+' m　'+rows.length+' 組合'+(scope==='strength'&&excluded?'（已排除 '+excluded+' 組非鋼構設計組合）':'（全部組合）'),
    axes:'Element Forces－Frames 局部軸（P、M2、M3；已依 Load Comb 線性重組）'};
}
function studRun(open){
  if(!(V304.imported?.rows||[]).length){studNote='尚未載入 Analysis Results 的 Element Forces。';renderStudSummary();return}
  const item=studPayload();
  if(!item){studNote='此斷面位置沒有可重組的線性 Load Comb 結果。';renderStudSummary();return}
  studNote='';ensureStudFrame();
  if(open!==false)openStudWorkspace();
  studPost({type:'stud-apply',payload:item});
  $('stud-workspace-status').textContent='已送出 '+item.label+'，等待計算…';
  renderStudSummary();
}
function renderStudSummary(){
  const card=$('stud-card'),sum=$('stud-summary'),bdg=$('bdg-stud');
  if(!card||!sum)return;
  const ready=!!(V304.imported?.rows||[]).length;
  if(!ready){
    sum.innerHTML='<b>尚未載入 Element Forces</b><br>請匯入第二個 Analysis Results S2K（需含 Element Forces - Frames）。';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    $('stud-pick').style.display='none';return;
  }
  renderStudPick();
  const r=studResult;
  if(!r||r.worstRatio===null||r.worstRatio===undefined){
    sum.innerHTML='已就緒：<b>'+studObjects().size+'</b> 支桿件有內力結果<br>選擇桿件與斷面位置後按「檢核此桿件」。'+(studNote?'<br>'+v300Esc(studNote):'');
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const ok=r.ok!==false;
  sum.innerHTML='<b>'+v300Esc(r.label||'')+'</b><br>最大 ratio <b>'+Number(r.worstRatio).toFixed(3)+'</b>'+
    (r.worstCombo?'（'+v300Esc(r.worstCombo)+'）':'')+'・'+r.count+' 組合<br>'+
    '<span class="pm-origin">釘群配置與材料於工作區設定；改配置後結果會自動更新</span>'+(studNote?'<br>'+v300Esc(studNote):'');
  if(bdg){bdg.textContent=ok?'完成・全 OK':'有 NG';bdg.className='badge '+(ok?'b-ok':'b-ng')}
}
window.addEventListener('message',ev=>{
  const d=ev.data||{};if(d.source!==STUD_CHILD_SOURCE)return;
  if(d.type==='ready'){
    studBridgeReady=true;
    $('stud-workspace-status').textContent='剪力釘模組已就緒';
    const queued=studPending.splice(0);
    for(const m of queued)studPost(m);
  }else if(d.type==='stud-state'){
    studResult=d.payload||null;
    if(studResult&&studResult.count)
      $('stud-workspace-status').textContent='已檢核 '+studResult.count+' 組合・最大 ratio '+
        (studResult.worstRatio==null?'—':Number(studResult.worstRatio).toFixed(3));
    renderStudSummary();
  }else if(d.type==='error'){
    studNote='釘群模組錯誤：'+String(d.message||'');renderStudSummary();
  }
});
/* ==== V4.15.0 地震力模組（耐震反應譜 -> AUTO SEISMIC USER COEFF）==== */
const SEIS_CHILD_SOURCE='s2k-f2k-seis-v400';
let seisFrameLoaded=false,seisBridgeReady=false,seisPending=[],seisState=null,seisNote='';
function seisPost(message){
  const frame=$('seis-frame-el');
  if(!seisBridgeReady||!frame||!frame.contentWindow){seisPending.push(message);return}
  frame.contentWindow.postMessage({source:FOUNDATION_PARENT_SOURCE,...message},'*');
}
function ensureSeisFrame(){
  const frame=$('seis-frame-el');
  if(seisFrameLoaded)return frame;
  const raw=$('module-source-seis-v100').textContent.trim();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  frame.srcdoc=new TextDecoder('utf-8').decode(bytes);
  seisFrameLoaded=true;
  return frame;
}
function openSeisWorkspace(){
  const ws=$('seis-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  ensureSeisFrame();
  if(seisBridgeReady)seisPost({type:'request-state'});
}
function closeSeisWorkspace(){
  const ws=$('seis-workspace');
  ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
}
/* 讀模型現況的 AUTO SEISMIC - USER COEFFICIENT（若有），用來比對新算係數 */
function seisExisting(){
  const rows=tables?.['AUTO SEISMIC - USER COEFFICIENT']||[];
  if(!rows.length)return null;
  const out={W:null,items:[]};
  for(const r of rows){
    const w=v300Num(r.WeightUsed);if(w>0&&out.W===null)out.W=w;
    out.items.push({pat:String(r.LoadPat||''),dir:String(r.Dir||''),
      ecc:v300Num(r.PercentEcc),C:v300Num(r.C),K:v300Num(r.K,1),V:v300Num(r.BaseShear)});
  }
  return out;
}
/* 現況 EV case 的垂直地震係數 */
function seisExistingEV(){
  const rows=tables?.['CASE - STATIC 1 - LOAD ASSIGNMENTS']||[];
  const ev=rows.filter(r=>String(r.Case||'').toUpperCase()==='EV');
  if(!ev.length)return null;
  return {sf:v300Num(ev[0].LoadSF),pats:ev.map(r=>String(r.LoadName||''))};
}
/* 組出可貼回 s2k 的三段載重定義文字 */
function seisS2KText(){
  const s=seisState,ex=seisExisting(),evx=seisExistingEV();
  if(!s||!Number.isFinite(s.Cx)||!Number.isFinite(s.Cy))return null;
  const e0=ex&&ex.items&&ex.items[0]?ex.items[0]:null;
  const ecc=e0&&Number.isFinite(e0.ecc)&&e0.ecc!==0?Math.abs(e0.ecc):0.05;
  const K=e0&&e0.K?e0.K:1;
  const evSf=Number.isFinite(s.ahMME)?s.ahMME:(evx?evx.sf:0.287);
  const evPats=(evx&&evx.pats&&evx.pats.length)?evx.pats:['DEAD','SD'];
  const f=x=>String(Number(x));
  const L=[];
  L.push('TABLE:  "LOAD PATTERN DEFINITIONS"');
  for(const p of ['EXP','EXN','EYP','EYN'])
    L.push('   LoadPat='+p+'   DesignType=Quake   SelfWtMult=0   AutoLoad="USER COEFF"');
  L.push(' ');
  L.push('TABLE:  "AUTO SEISMIC - USER COEFFICIENT"');
  L.push('   LoadPat=EXP   Dir=X   PercentEcc='+ecc+'   EccOverride=No   UserZ=No   C='+f(s.Cx)+'   K='+K);
  L.push('   LoadPat=EXN   Dir=X   PercentEcc=-'+ecc+'   EccOverride=No   UserZ=No   C='+f(s.Cx)+'   K='+K);
  L.push('   LoadPat=EYP   Dir=Y   PercentEcc='+ecc+'   EccOverride=No   UserZ=No   C='+f(s.Cy)+'   K='+K);
  L.push('   LoadPat=EYN   Dir=Y   PercentEcc=-'+ecc+'   EccOverride=No   UserZ=No   C='+f(s.Cy)+'   K='+K);
  L.push(' ');
  L.push('TABLE:  "CASE - STATIC 1 - LOAD ASSIGNMENTS"');
  for(const p of evPats)
    L.push('   Case=EV   LoadType="Load pattern"   LoadName='+p+'   LoadSF='+f(evSf));
  return L.join('\n');
}
function seisGenerate(){
  const txt=seisS2KText(),box=$('seis-s2k');
  if(!txt){seisNote='尚未取得設計地震力係數：請先在反應譜工作區完成計算（工址、地盤類別、用途係數）。';renderSeisSummary();return}
  seisNote='';box.style.display='';box.textContent=txt;
  renderSeisSummary();
}
function renderSeisSummary(){
  const sum=$('seis-summary'),bdg=$('bdg-seis');if(!sum)return;
  const ex=seisExisting(),s=seisState;
  let html='';
  if(ex){
    html+='<b>模型現況</b>　W='+(ex.W?ex.W.toFixed(3):'—')+' tf<br>'+
      ex.items.map(i=>v300Esc(i.pat)+'（'+i.dir+'）C='+i.C+'　V='+(i.V?i.V.toFixed(3):'—')+' tf').join('<br>');
  }else if(currentS2KText){
    html+='<b>模型現況</b>　此模型沒有 AUTO SEISMIC 表（未使用靜力法自動地震力）';
  }else{
    sum.innerHTML='<b>尚未載入模型</b><br>載入 Model Definition S2K 後可比對模型現況的 AUTO SEISMIC 係數。';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(s&&Number.isFinite(s.Cx)){
    const W=ex?ex.W:null;
    html+='<br><br><b>反應譜新算</b>　C_X=<b>'+s.Cx+'</b>・C_Y=<b>'+s.Cy+'</b>'+
      (Number.isFinite(s.ahMME)?'・垂直 '+s.ahMME:'')+
      (W?'<br>V_X='+(s.Cx*W).toFixed(3)+' tf・V_Y='+(s.Cy*W).toFixed(3)+' tf（W 取模型現況）':'');
    if(bdg){bdg.textContent='係數已算出';bdg.className='badge b-ok'}
  }else{
    html+='<br><br>反應譜工作區尚未算出係數。';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
  }
  html+='<span class="pm-origin">水平地震走 AUTO SEISMIC（USER COEFF），SAP 由質量源自動算 W 與 V=C·W；'+
    '垂直地震 EV 走 LOAD CASE 組裝（DEAD／SD × 係數）</span>';
  if(seisNote)html+='<br>'+v300Esc(seisNote);
  sum.innerHTML=html;
}
window.addEventListener('message',ev=>{
  const d=ev.data||{};if(d.source!==SEIS_CHILD_SOURCE)return;
  if(d.type==='ready'){
    seisBridgeReady=true;
    $('seis-workspace-status').textContent='耐震模組已就緒';
    const queued=seisPending.splice(0);
    for(const m of queued)seisPost(m);
  }else if(d.type==='seis-state'){
    seisState=d.payload||null;
    if(seisState&&Number.isFinite(seisState.Cx))
      $('seis-workspace-status').textContent='C_X='+seisState.Cx+'　C_Y='+seisState.Cy;
    renderSeisSummary();
  }else if(d.type==='error'){
    seisNote='耐震模組錯誤：'+String(d.message||'');renderSeisSummary();
  }
});
/* ==== V4.15.0 層間位移檢核（計算書 6.7）====
   逐「柱線」（同一 x,y 的節點由下而上）算層間位移角 Δ/h，而非只取各樓層最大位移相減，
   後者在平面不規則或有局部構架時會失真。 */
let driftResult=null,driftNote='';
function driftTable(){
  const T=V305.analysisTables;if(!T)return null;
  const key=Object.keys(T).find(k=>/JOINT\s+DISPLACEMENTS/i.test(k));
  return key?(T[key]||[]):null;
}
/* 依 x,y 分群成柱線，每群節點依 z 排序（僅保留有位移資料者） */
function driftLines(rows){
  const has=new Set(rows.map(r=>String(r.Joint)));
  const g=new Map();
  for(const [id,j] of Object.entries(model?.joints||{})){
    if(!has.has(String(id)))continue;
    const k=(+j.x).toFixed(3)+'|'+(+j.y).toFixed(3);
    if(!g.has(k))g.set(k,[]);
    g.get(k).push({id:String(id),x:+j.x,y:+j.y,z:+j.z});
  }
  const out=[];
  for(const [k,list] of g){
    if(list.length<2)continue;
    list.sort((a,b)=>a.z-b.z);
    out.push({key:k,x:list[0].x,y:list[0].y,joints:list});
  }
  return out;
}
function driftRun(){
  const rows=driftTable();
  if(!rows||!rows.length){driftNote='尚未載入含 Joint Displacements 的 Analysis Results。';renderDriftSummary();return}
  const lines=driftLines(rows);
  if(!lines.length){driftNote='找不到可組成柱線的節點（同一 x,y 需至少兩個不同標高的節點）。';renderDriftSummary();return}
  const limit=Math.max(1e-6,v300Num($('drift-limit')?.value,0.005));
  const amp=Math.max(1,v300Num($('drift-amp')?.value,1));
  const eqOnly=$('drift-eq-only')?.checked!==false;
  const hMax=Math.max(1,v300Num($('drift-hmax')?.value,8));
  /* 位移索引：case -> joint -> {U1,U2} */
  const idx=new Map();
  for(const r of rows){
    const c=String(r.OutputCase??'').trim(),j=String(r.Joint??'');
    if(!c||!j)continue;
    const st=String(r.StepType||'').trim();
    if(st&&/max|min|envelope|mode/i.test(st))continue;
    if(!idx.has(c))idx.set(c,new Map());
    const m=idx.get(c);
    if(!m.has(j))m.set(j,{U1:v300Num(r.U1),U2:v300Num(r.U2)});
  }
  /* 要檢核的載重：優先用 Load Comb 展開；沒有就用原始 case */
  const defs=v304ComboDefinitions();
  const isEq=name=>/^E|quake|EQ|地震/i.test(String(name));
  let targets=[];
  const srcMode=$('drift-src')?.value||'combo';
  if(srcMode==='case'){
    /* PR B 附件D 的做法：逐原始 Load Case（未factored）檢核 */
    targets=[...idx.keys()].filter(c=>!eqOnly||isEq(c)).map(c=>({name:c,factors:{[c]:1}}));
  }else{
    for(const [name,d] of defs){
      if(!v304NormType(d.type).includes('linearadd'))continue;
      const flat=v304FlattenLinear(name,defs);
      if(!flat.ok||!Object.keys(flat.factors).length)continue;
      if(eqOnly&&!Object.keys(flat.factors).some(isEq))continue;
      targets.push({name,factors:flat.factors});
    }
    if(!targets.length)
      targets=[...idx.keys()].filter(c=>!eqOnly||isEq(c)).map(c=>({name:c,factors:{[c]:1}}));
  }
  if(!targets.length){driftNote='沒有符合條件的載重（可關閉「只算含地震的組合」）。';renderDriftSummary();return}
  const disp=(factors,jid)=>{
    let u1=0,u2=0,ok=true;
    for(const [cn,f] of Object.entries(factors)){
      const v=idx.get(String(cn))?.get(String(jid));
      if(!v){ok=false;break}
      u1+=v300Num(f)*v.U1;u2+=v300Num(f)*v.U2;
    }
    return ok?{u1:u1*amp,u2:u2*amp}:null;
  };
  const byLevel=new Map(),skipTall=new Set();let worst=null,checked=0;
  for(const t of targets){
    for(const ln of lines){
      for(let i=1;i<ln.joints.length;i++){
        const lo=ln.joints[i-1],hi=ln.joints[i],h=hi.z-lo.z;
        if(h<=0.01)continue;
        /* 柱線若缺中間節點，會出現跨數層的假「層間」（工務大樓實測 0.90→33.70、h=32.8 m）
           這種區段不是樓層，排除並另計 */
        if(h>hMax){skipTall.add(lo.z.toFixed(3)+'→'+hi.z.toFixed(3));continue}
        const a=disp(t.factors,lo.id),b=disp(t.factors,hi.id);
        if(!a||!b)continue;
        const d1=Math.abs(b.u1-a.u1)/h,d2=Math.abs(b.u2-a.u2)/h;
        const ratio=Math.max(d1,d2),dir=d1>=d2?'X':'Y';
        checked++;
        const key=lo.z.toFixed(3)+'→'+hi.z.toFixed(3);
        const cur=byLevel.get(key);
        if(!cur||ratio>cur.ratio)
          byLevel.set(key,{zLo:lo.z,zHi:hi.z,h,ratio,dir,combo:t.name,
                          line:'('+ln.x.toFixed(2)+', '+ln.y.toFixed(2)+')',jLo:lo.id,jHi:hi.id,
                          uLo:a,uHi:b,d1,d2});
        if(!worst||ratio>worst.ratio)
          worst={ratio,dir,combo:t.name,level:key,line:'('+ln.x.toFixed(2)+', '+ln.y.toFixed(2)+')'};
      }
    }
  }
  if(!checked){driftNote='沒有可比對的節點位移（載重組合的成分 case 在位移表中不齊全）。';renderDriftSummary();return}
  driftNote='';
  driftResult={limit,amp,eqOnly,hMax,srcMode,combos:targets.length,lines:lines.length,checked,worst,
               skipTall:[...skipTall],
               levels:[...byLevel.values()].sort((a,b)=>a.zLo-b.zLo)};
  renderDriftSummary();
}
function renderDriftSummary(){
  const sum=$('drift-summary'),bdg=$('bdg-drift'),opt=$('drift-opt'),tb=$('drift-table');
  if(!sum)return;
  const rows=driftTable();
  if(!rows||!rows.length){
    sum.innerHTML='<b>尚未載入 Joint Displacements</b><br>請匯入第二個 Analysis Results S2K。';
    if(opt)opt.style.display='none';if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(opt)opt.style.display='';
  const r=driftResult;
  if(!r){
    sum.innerHTML='已就緒：<b>'+rows.length+'</b> 筆位移資料<br>設定限值後按「執行層間位移檢核」。'+
      (driftNote?'<br>'+v300Esc(driftNote):'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const ng=r.levels.filter(x=>x.ratio>r.limit).length;
  sum.innerHTML='檢核 <b>'+r.combos+'</b> 組載重・<b>'+r.lines+'</b> 條柱線・'+r.checked+' 次比對<br>'+
    '最大 Δ/h <b>'+r.worst.ratio.toFixed(5)+'</b>（'+v300Esc(r.worst.combo)+'　'+r.worst.dir+' 向　'+
    v300Esc(r.worst.level)+' m　柱線 '+v300Esc(r.worst.line)+'）<br>'+
    '限值 '+r.limit+'　超限樓層 <b>'+ng+'</b>/'+r.levels.length+
    '<span class="pm-origin">逐柱線（同 x,y 的節點由下而上）計算，非各樓層最大位移相減；'+
    '位移已乘放大倍數 '+r.amp+'。檢核對象：'+(r.srcMode==='case'?'原始 Load Case':'載重組合')+
    '。含地震篩選：'+(r.eqOnly?'是':'否')+
    '<br><b>限值要與組合等級相符</b>：中小度地震（未放大）常用 0.005；'+
    '設計地震／放大組合（如 AMP*）應改用該案採用之限值，勿沿用 0.005。'+
    (r.skipTall.length?'<br>已排除 '+r.skipTall.length+' 種跨層區段（高度 > '+r.hMax+
      ' m，柱線缺中間節點）：'+v300Esc(r.skipTall.slice(0,4).join('、'))+
      (r.skipTall.length>4?' 等':''):'')+'</span>';
  if(bdg){bdg.textContent=ng?'超限 '+ng:'完成・全 OK';bdg.className='badge '+(ng?'b-ng':'b-ok')}
  if(tb){
    tb.style.display='';
    tb.innerHTML='樓層(z m)　　h　　Δ/h　　控制組合\n'+
      r.levels.map(x=>{
        const bad=x.ratio>r.limit;
        return (x.zLo.toFixed(2)+'→'+x.zHi.toFixed(2)).padEnd(16)+
               x.h.toFixed(2).padStart(6)+'  '+x.ratio.toFixed(5).padStart(8)+(bad?' NG':' ok')+
               '  '+x.combo+' '+x.dir;
      }).join('\n');
  }
}
/* ==== V4.15.0 柱基版與錨栓（計算書 7.1.3；AISC DG1 承壓／板厚 ＋ ACI 318-19 §17.7、§17.8）====
   單位：反力 Tonf, m；基版與錨栓輸入用 mm／kgf/cm²／MPa，換算於各式明列。 */
let bpResult=null,bpNote='',bpComboInfo=null,bpCbf=null;
/* 柱腳上的柱桿件（近垂直），回傳其斷面尺寸（公尺） */
function bpColumnAt(jointId){
  const id=String(jointId);let best=null;
  for(const f of model?.frames||[]){
    const isI=String(f.i)===id,isJ=String(f.j)===id;
    if(!isI&&!isJ)continue;
    const a=model.joints[String(f.i)],b=model.joints[String(f.j)];if(!a||!b)continue;
    const dz=Math.abs(b.z-a.z),dr=Math.hypot(b.x-a.x,b.y-a.y);
    if(dz<=1e-6||dr>dz*.2)continue;
    if(!best||dz>best.dz)best={frameId:String(f.id),dz,sect:f.sect||''};
  }
  if(!best)return null;
  const sc=model?.sections?.[best.sect]||{};
  return {frameId:best.frameId,sect:best.sect,
          d:v300Num(sc.t3,0),bf:v300Num(sc.t2,0)};/* 公尺 */
}
/* 各柱腳的反力包絡（逐組合展開） */
/* V4.15.0：D／L／E 載重案例辨識（13.4-1／13.4-2 與 13.4.5 共用）。
   ⚠ 不可用 LOAD PATTERN 的 DesignType 直接分類——實測兩個模型的
   **EV（垂直地震）都由 Dead 型樣式組成**（PR B：DEAD×0.287＋SD×0.287；
   工務大樓：DEAD／DL1～5×0.444），依樣式型別會把 EV 誤併進 P_D；
   且 DL 本身已含 DEAD＋SD，全取 Dead 案例會重複計算。
   改用規範自身的組合形式辨識（對兩個模型皆成立）：
     1.4×單一案例 → D、係數 1.6 之案例 → L、對應 Quake 型樣式之案例 → E。 */
function amDLECases(flatCombos){
  let dCase='',lCase='';
  for(const [,terms] of flatCombos||[]){
    if(terms.length===1&&Math.abs(terms[0][1]-1.4)<1e-9&&!dCase)dCase=String(terms[0][0]);
    for(const t of terms)if(Math.abs(t[1]-1.6)<1e-9&&!lCase)lCase=String(t[0]);
  }
  const quakePat=new Set();
  for(const r of tables?.['LOAD PATTERN DEFINITIONS']||[]){
    const dt=String(r.DesignType||r.Type||'');
    if(/quake|seismic/i.test(dt))quakePat.add(String(r.LoadPat||''));
  }
  const eCases=[],byCase=new Map();
  for(const r of tables?.['CASE - STATIC 1 - LOAD ASSIGNMENTS']||[]){
    const c=String(r.Case||'');if(!c)continue;
    if(!byCase.has(c))byCase.set(c,[]);
    byCase.get(c).push(String(r.LoadName||''));
  }
  for(const [c,pats] of byCase)
    if(pats.length&&pats.every(p=>quakePat.has(p)))eCases.push(c);
  if(!eCases.length)for(const p of quakePat)eCases.push(p);
  return {dCase,lCase,eCases};
}
/* 由 SteelDesign=Strength 組合攤平後推得 D／L／E（供柱基版等未持有 flatCombos 者用） */
function amDLEFromModel(){
  let defs;try{defs=v304ComboDefinitions()}catch(e){return {dCase:'',lCase:'',eCases:[]}}
  const {names}=comboScopeNames(defs,'strength');
  const flat=[];
  for(const n of names){
    const fl=v304FlattenLinear(String(n),defs);
    if(fl.ok&&Object.keys(fl.factors).length)flat.push([String(n),Object.entries(fl.factors)]);
  }
  return amDLECases(flat);
}
function amAmpFactor(){
  const fu=Math.max(0,v300Num($('mem-fu')?.value,2.5));
  return {Fu:fu,FuUsed:Math.min(fu,2.5),amp:1.4*Math.min(fu,2.5),
          kL:v300Num($('mem-pl')?.value,0.5)};
}
function bpEnvelopes(){
  const ctx=pmCtx();if(!ctx)return null;
  const byJoint=new Map();
  for(const r of ctx.reactionRows){
    const j=String(r.joint);
    if(!byJoint.has(j))byJoint.set(j,new Map());
    byJoint.get(j).set(String(r.case),r);
  }
  /* V4.15.0：柱基版與錨栓依 SAP 的 SteelDesign=Strength 篩選組合。
     依據：公版 Excel「柱底板＋錨栓」的「貼柱底反力(design+)」工作表，
     逐列是 Node 1 搭配組合 101／102／103…（PR B 的數字系列＝Strength），
     證實此檢核用的是 LRFD 強度組合而非 WSD。 */
  const scope=comboScopeOf('bp-combo-scope');
  const sc=comboScopeAllow(scope);
  const combos=sc?ctx.combinations.filter(c=>sc.allow.has(String(c.name))):ctx.combinations;
  const bpForceMode=$('bp-force')?.value||'both';
  const amDLE=amDLEFromModel(),amF=amAmpFactor();
  bpComboInfo={scope,used:combos.length,excluded:sc?sc.excluded:0,
               forceMode:bpForceMode,amp:amF.amp,kL:amF.kL,dle:amDLE};
  const out=[];
  for(const sj of ctx.supportJoints){
    const id=String(sj.id),cases=byJoint.get(id);if(!cases)continue;
    let Pmax=null,Tmax=null,Vmax=null;
    const evalOne=(name,f)=>{
      let F1=0,F2=0,F3=0,hit=false;
      for(const [cn,fv] of Object.entries(f)){
        const r=cases.get(String(cn));if(!r)continue;
        const k=v300Num(fv);hit=true;
        F1+=k*v300Num(r.F1);F2+=k*v300Num(r.F2);F3+=k*v300Num(r.F3);
      }
      if(!hit)return;
      const V=Math.hypot(F1,F2);
      if(!Pmax||F3>Pmax.val)Pmax={val:F3,combo:name};
      if(!Tmax||-F3>Tmax.val)Tmax={val:-F3,combo:name};
      if(!Vmax||V>Vmax.val)Vmax={val:V,combo:name,F1,F2};
    };
    if(combos.length)for(const c of combos)evalOne(String(c.name),c.factors||{});
    else for(const [cn,r] of cases)evalOne(String(cn),{[cn]:1});
    if(!Pmax)continue;
    /* ══ V4.15.0：13.4.5 柱基放大地震力 ══
       規範原文：「柱基…應檢核在 13.4.1 節所規定之放大地震力作用下…
       具足夠之強度抵抗軸向壓力及軸向拉力」（阪神地震大量錨定破壞即此條之由來）。
         13.4-1 軸壓 Pu = 1.2·R_D + kL·R_L + 1.4Fu·|R_E|
         13.4-2 軸拉 Tu = −(0.9·R_D − 1.4Fu·|R_E|)
       反力符號：F3 為正代表向上支承反力＝柱受壓，與 Pmax 的取法一致。
       ⚠ 剪力 Vu 不套用——13.4.5 只規定軸壓與軸拉。
       ⚠ 「1.4Fu·P_E 不必超過相接構材傳遞軸力 1.25 倍」之上限未套用 → 偏保守。 */
    let PuAmp=0,TuAmp=0;
    if(amDLE.dCase){
      const g=n=>{const r=n?cases.get(String(n)):null;return r?v300Num(r.F3):null};
      const RD=g(amDLE.dCase),RL=g(amDLE.lCase);
      if(RD!==null){
        let RE=0;for(const n of amDLE.eCases){const v=g(n);if(v!==null&&Math.abs(v)>RE)RE=Math.abs(v)}
        PuAmp=Math.max(0,1.2*RD+amF.kL*(RL||0)+amF.amp*RE);
        TuAmp=Math.max(0,-(0.9*RD-amF.amp*RE));
      }
    }
    const PuStr=Math.max(0,Pmax.val),TuStr=Math.max(0,Tmax?Tmax.val:0);
    const useAmp=bpForceMode!=='strength';
    out.push({joint:id,col:bpColumnAt(id),
              Pu:useAmp?Math.max(PuStr,PuAmp):PuStr,
              PuCombo:(useAmp&&PuAmp>PuStr)?'13.4-1 放大地震力':Pmax.combo,
              Tu:useAmp?Math.max(TuStr,TuAmp):TuStr,
              TuCombo:(useAmp&&TuAmp>TuStr)?'13.4-2 放大地震力':(Tmax?Tmax.combo:''),
              PuStr,TuStr,PuAmp,TuAmp,ampOn:useAmp,
              Vu:Vmax?Vmax.val:0,VuCombo:Vmax?Vmax.combo:''});
  }
  return out;
}
function bpRun(){
  const env=bpEnvelopes();
  if(!env||!env.length){bpNote='尚未有柱底反力：請先匯入 Analysis Results S2K。';renderBpSummary();return}
  const g=id=>v300Num($(id)?.value,0);
  const B=g('bp-B'),N=g('bp-N'),t=g('bp-t'),Fy=g('bp-Fy'),fc=g('bp-fc'),a2a1=Math.min(2,g('bp-a2a1'));
  const n=Math.max(1,Math.round(g('bp-n'))),dnom=g('bp-d'),dcut=g('bp-dcut'),
        futa=g('bp-futa'),phi=g('bp-phiv'),gm=g('bp-gm');
  if(!(B>0&&N>0&&t>0&&Fy>0&&fc>0&&dnom>dcut&&futa>0&&phi>0&&gm>0)){
    bpNote='輸入不完整或不合理，請檢查各欄位。';renderBpSummary();return}
  /* 錨栓鋼材強度（ACI 318-19 §17.7）：Ase 以扣牙後直徑計 */
  const dEff=dnom-dcut, Ase=Math.PI*dEff*dEff/4;              /* mm² */
  const Vsa=n*0.6*Ase*futa/1000;                              /* kN */
  const Nsa=n*Ase*futa/1000;                                  /* kN */
  const phiVn=gm*phi*Vsa, phiNn=gm*phi*Nsa;                   /* kN */
  /* 基版承壓（AISC DG1）：單位換成 kgf/cm² */
  const An=(B/10)*(N/10);                                     /* cm² */
  const fpMax=0.65*0.85*fc*a2a1;                              /* kgf/cm²，φc=0.65 */
  const fpCap=Math.min(fpMax,0.65*1.7*fc);
  /* 錨定補強（ACI 318-19 §17.5.2.1）：以柱墩主筋抵抗錨栓拉力、箍筋抵抗剪力，
     取代混凝土錐體破壞計算。做法與公版 Excel「7.1.3 Anchor Reinforcement」一致：
       主筋：Ldavailable = hef − 保護層 − d_actual·tan(θ)；Fredu = min(1, Ldavailable/Ld)
             Ts = φs·fy·As/1000（kN/支）；Tbar = n·Ts·Fredu
       箍筋：Layer A = 2·d_bar·tan(θ) + 邊距 − 50；Layer B = LayerA + tan(θ)·間距
             Ldh,available = 平均；Fredu 同上；Ttie = 層數·肢數·Ts,tie·Fredu */
  /* ══ V4.15.0：錨栓混凝土破壞模式（ACI 318 §17.6 受拉／§17.7 受剪）══
     依據附件E-PRB-細部設計 p29～49（midas Design+ 產出，ACI 318）的完整實例。
     單位一律換成 SI（N, mm, MPa）計算，最後回到 tonf。
       受拉 Nsa   = n·Ase·futa，futa = min(futa, 1.9fya, 860)
            Ncbg  = (ANc/ANco)·ψec,N·ψed,N·ψc,N·ψcp,N·Nb
                    Nb = kc·λa·√fck·hef^1.5、ANco = 9hef²
                    ⚠ §17.6.2.1.2：三邊以上近邊時 h'ef = max(ca,max/1.5, smax/3)
                    ψed,N = 0.7 + 0.3·ca,min/(1.5hef)（ca,min < 1.5hef 時）
            Npn   = ψc,P·8·Abrg·fck、Abrg = A_head − A_anchor
            Nsbg  = (1 + s/(6ca1))·13·ca1·√Abrg·λa·√fck（ca1 < 0.4hef 時才需檢核）
       受剪 Vsa   = n·0.6·Ase·futa，灌漿基底再乘 0.8
            Vcbg  = (AVc/AVco)·ψec,V·ψed,V·ψc,V·ψh,V·Vb
                    Vb = 0.6·(le/da)^0.2·√da·λa·√fck·ca1^1.5、AVco = 4.5·ca1²
                    ψed,V = min(0.7 + 0.3·ca2/(1.5ca1), 1)、ψh,V = max(√(1.5ca1/ha), 1)
            Vcpg  = kcp·Ncbg（kcp = 2.0，hef ≥ 65 mm）
       互制 Nua/(φNn) + Vua/(φVn) ≤ 1.2（§17.8.3）
     ⚠ 簡化與限制（明示於輸出）：
       - 群錨拉力取模組既有的 Tu（該柱腳淨上拔），受拉側支數由使用者給（預設 2）；
         彎矩造成部分錨栓受拉但淨力仍為壓的情形**未細分**，需人工判斷。
       - 偏心 e'N 一律取 0（ψec,N = 1）；有顯著偏心時本項偏不保守。
       - 剪力平行邊緣的 Vcbg×2（§17.7.2.1(c)）**未套用**，取較保守的垂直邊緣值。 */
  const cbfOn=$('bp-cbf')?.checked!==false;
  const ca1=g('bp-ca1'),ca2=g('bp-ca2'),sAnch=g('bp-s'),sMax=g('bp-smax');
  const haM=g('bp-ha'),dHead=g('bp-dhead'),psiC=v300Num($('bp-crack')?.value,1);
  const groutOn=$('bp-grout')?.checked!==false;
  const nT=Math.max(1,Math.round(g('bp-nt')));
  const arOn=$('bp-ar')?.checked!==false;
  const hef=g('bp-hef'),cov=g('bp-cov'),ang=g('bp-ang')*Math.PI/180;
  const mAs=g('bp-mas'),mFy=g('bp-mfy'),mLd=g('bp-mld'),mDa=g('bp-mda'),mN=Math.max(0,Math.round(g('bp-mn')));
  const fsR=g('bp-fs');
  const tAs=g('bp-tas'),tFy=g('bp-tfy'),tLd=g('bp-tld'),tSp=g('bp-tsp'),tEdge=g('bp-tedge');
  const tLayer=Math.max(1,Math.round(g('bp-tlayer'))),tLeg=Math.max(1,Math.round(g('bp-tleg')));
  const Ts=fsR*mFy*mAs/1000;                                   /* kN/支 */
  const LdAvail=hef-cov-mDa*Math.tan(ang);
  const FreduM=mLd>0?Math.min(1,LdAvail/mLd):1;
  const Tbar=mN*Ts*FreduM;                                     /* kN */
  const TsTie=fsR*tFy*tAs/1000;
  const layA=Math.round(2*25.4*Math.tan(ang)+tEdge-50);
  const layB=layA+Math.tan(ang)*tSp;
  const LdhAvail=(layA+layB)/2;
  const FreduT=tLd>0?Math.min(1,LdhAvail/tLd):1;
  const Ttie=tLayer*tLeg*TsTie*FreduT;                         /* kN */
  /* SI 換算：fck(MPa)、futa(MPa)、長度 mm；1 tonf = 9.80665 kN */
  const fckMPa=fc*0.0980665;                       /* kgf/cm² → MPa */
  const hefIn=g('bp-hef');
  const cbf=(()=>{
    if(!cbfOn)return null;
    const lam=1.0,kc=10.0,fyaM=Fy*0.0980665;
    const futaEff=Math.min(futa,1.9*fyaM,860);
    const Ase=Math.PI*dEff*dEff/4;                                  /* mm² */
    /* 受拉 */
    const NsaKN=nT*Ase*futaEff/1000;
    /* §17.6.2.1.2：三邊以上近邊時 h'ef = max(ca_max / 1.5, s_max / 3)
       ⚠ 用的是「較大」邊距 ca_max，不是 ca_min。實測 midas BP-02：
         max(250/1.5, 440/3) = max(166.7, 146.7) = 166.7 mm；
         誤用 ca,min 會得 146.7，Ncbg 低估 8%。 */
    const caMax=Math.max(ca1,ca2);
    const hefPrime=Math.max(caMax/1.5,sMax/3);
    const hefUse=Math.min(hefIn,hefPrime>0?Math.max(hefPrime,0):hefIn);
    const ANco=9*hefUse*hefUse;
    /* 投影面積：受拉側兩支錨栓沿間距 s 排列，一側近邊 ca1、另一側取 1.5hef。
       ⚠ h'ef 用 **smax**（§17.6.2.1.2 的埋深折減），ANc 用 **smin**（群錨間距）——
          兩者用途不同，實測 midas BP-02：
          h'ef = max(250/1.5, 440/3) = 166.7 mm；
          ANc = (1.5×166.7 + 200 + 1.5×166.7) × (130 + 1.5×166.7)
              = 701 × 380.5 = 266,730 mm² ≒ midas 之 0.266 m² ✓ */
    const ANc=(1.5*hefUse+sAnch+1.5*hefUse)*(Math.min(ca1,1.5*hefUse)+1.5*hefUse);
    const Nb=kc*lam*Math.sqrt(fckMPa)*Math.pow(hefUse,1.5)/1000;    /* kN */
    const psiEd=ca1<1.5*hefUse?0.7+0.3*ca1/(1.5*hefUse):1.0;
    const NcbgKN=(ANc/ANco)*psiEd*psiC*1.0*Nb;
    const Ahead=Math.PI*dHead*dHead/4,Aanch=Math.PI*dnom*dnom/4;
    const Abrg=Math.max(0,Ahead-Aanch);
    const NpnKN=8*Abrg*fckMPa/1000;
    const needSb=ca1<0.4*hefUse;
    const NsbKN=13*ca1*Math.sqrt(Abrg)*lam*Math.sqrt(fckMPa)/1000;
    const NsbgKN=(1+sAnch/(6*Math.max(ca1,1e-9)))*NsbKN;
    /* 受剪 */
    /* le 用**實際埋深**（非 §17.6.2.1.2 折減後的 h'ef）——折減只用於受拉錐體投影。
       midas BP-02：le = min(660, 8×36) = 288 mm；
       誤用 h'ef=166.7 會使 (le/da)^0.2 由 1.5157 降為 1.3286，Vcbg 低估 12%。 */
    const le=Math.min(hefIn,8*dnom);
    const VbKN=0.6*Math.pow(le/dnom,0.2)*Math.sqrt(dnom)*lam*Math.sqrt(fckMPa)*Math.pow(ca1,1.5)/1000;
    const AVco=4.5*ca1*ca1;
    /* AVc 同理用 smin：midas BP-02（Y 向）(1.5×130+200+1.5×130)×min(1.5×130, 990)
       = 590×195 = 115,050 mm²，反推其 Vcbg=6.483 tonf 所需之 114,900 ✓ */
    const AVc=(1.5*ca1+sAnch+1.5*ca1)*Math.min(1.5*ca1,haM);
    const psiEdV=Math.min(0.7+0.3*ca2/(1.5*Math.max(ca1,1e-9)),1.0);
    const psiHV=Math.max(Math.sqrt(1.5*ca1/Math.max(haM,1e-9)),1.0);
    const VcbgKN=(AVc/AVco)*psiEdV*psiHV*VbKN;
    const VsaKN=nT*0.6*Ase*futaEff/1000*(groutOn?0.8:1);
    const VcpgKN=2.0*NcbgKN;
    return {futaEff,Ase,hefUse,hefPrime,ANc,ANco,Nb,psiEd,psiC,
            NsaKN,NcbgKN,NpnKN,NsbgKN,needSb,Abrg,
            VbKN,AVc,AVco,psiEdV,psiHV,VcbgKN,VsaKN,VcpgKN,le,nT};
  })();
  const rows=env.map(e=>{
    const Pkgf=e.Pu*1000;                                     /* tf → kgf */
    const fp=An>0?Pkgf/An:Infinity;
    const brg=fpCap>0?fp/fpCap:Infinity;
    /* 懸臂長 m、n（柱斷面公尺→mm） */
    const dcol=(e.col?.d||0)*1000, bfcol=(e.col?.bf||0)*1000;
    const mm=(N-0.95*dcol)/2, nn=(B-0.8*bfcol)/2, ell=Math.max(mm,nn);
    /* t,req = ℓ·√(2·Pu/(0.9·Fy·B·N))；Pu kgf、Fy kgf/cm²、長度 cm */
    const treq=ell>0?(ell/10)*Math.sqrt(2*Pkgf/(0.9*Fy*An))*10:0;   /* mm */
    const tRatio=t>0?treq/t:Infinity;
    const VuKN=e.Vu*9.81, TuKN=e.Tu*9.81;
    /* V4.15.0：混凝土破壞模式逐柱腳比值（拉、剪各取最不利） */
    let cb=null;
    if(cbf){
      const rN=v=>v>0?TuKN/(0.75*v):0;
      const cNsa=rN(cbf.NsaKN),cNcb=rN(cbf.NcbgKN),cNpn=rN(cbf.NpnKN),
            cNsb=cbf.needSb?rN(cbf.NsbgKN):0;
      const rV=(v,phi)=>v>0?VuKN/(phi*v):0;
      const cVsa=rV(cbf.VsaKN,0.65),cVcb=rV(cbf.VcbgKN,0.70),cVcp=rV(cbf.VcpgKN,0.70);
      const nGov=Math.max(cNsa,cNcb,cNpn,cNsb),vGov=Math.max(cVsa,cVcb,cVcp);
      /* §17.8.3：Nua/(φNn) + Vua/(φVn) ≤ 1.2 */
      cb={cNsa,cNcb,cNpn,cNsb,cVsa,cVcb,cVcp,nGov,vGov,inter:nGov+vGov,
          worst:Math.max(nGov,vGov,(nGov+vGov)/1.2)};
    }
    const vR=phiVn>0?VuKN/phiVn:Infinity, tR=phiNn>0?TuKN/phiNn:Infinity;
    /* 拉剪互制（ACI 318-19 §17.8.3）：(Tu/φNn)^(5/3)+(Vu/φVn)^(5/3) ≤ 1.0 */
    const inter=Math.pow(tR,5/3)+Math.pow(vR,5/3);
    /* 錨定補強比值：拉力由主筋、剪力由箍筋承擔 */
    const arT=arOn&&Tbar>0?TuKN/Tbar:null;
    const arV=arOn&&Ttie>0?VuKN/Ttie:null;
    const list=[brg,tRatio,vR,tR,inter];
    if(arT!==null)list.push(arT);
    if(arV!==null)list.push(arV);
    const worst=Math.max(...list.filter(Number.isFinite));
    const worst2=cb?Math.max(worst,cb.worst):worst;
    return {...e,fp,fpCap,brg,mm,nn,ell,treq,tRatio,VuKN,TuKN,vR,tR,inter,arT,arV,cb,
            worst:worst2,ok:worst2<=1&&Number.isFinite(worst2)};
  });
  const ng=rows.filter(r=>!r.ok).length;
  bpNote='';
  bpCbf=cbf;
  bpResult={B,N,t,Fy,fc,a2a1,n,dnom,dEff,Ase,futa,phi,gm,Vsa,Nsa,phiVn,phiNn,fpCap,rows,ng,cbfOn,
            arOn,hef,cov,ang:g('bp-ang'),Ts,LdAvail,FreduM,Tbar,TsTie,layA,layB,LdhAvail,FreduT,Ttie,mN};
  renderBpSummary();
}
function renderBpSummary(){
  const sum=$('bp-summary'),bdg=$('bdg-bp'),opt=$('bp-opt'),tb=$('bp-table');
  if(!sum)return;
  const ctx=pmCtx();
  if(!ctx){
    sum.innerHTML='<b>尚未有柱底反力</b><br>請先匯入第二個 Analysis Results S2K（需含 Joint Reactions）。';
    if(opt)opt.style.display='none';if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(opt)opt.style.display='';
  const r=bpResult;
  const ci=bpComboInfo;
  const ciTxt=ci?'載重組合 <b>'+ci.used+'</b> 組'+
    (ci.scope==='strength'&&ci.excluded?'（已排除 '+ci.excluded+' 組非鋼構設計組合）':'（全部組合）')+
    '<br>設計內力：'+(ci.forceMode==='strength'?'<b>僅強度組合包絡</b>'
      :'<b>兩者取大</b>（含 13.4.5 放大地震力，1.4Fu='+(ci.amp||0).toFixed(2)+'）')+'<br>':'';
  if(!r){
    sum.innerHTML='已就緒：<b>'+ctx.supportJoints.length+'</b> 個柱腳<br>設定基版與錨栓參數後按「執行檢核」。'+
      (bpNote?'<br>'+v300Esc(bpNote):'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const worst=r.rows.reduce((a,b)=>!a||b.worst>a.worst?b:a,null);
  sum.innerHTML=ciTxt+'錨栓 <b>'+r.n+'-M'+r.dnom+'</b>（扣牙後 d='+(r.dnom-(r.dnom-r.dEff)).toFixed(0)+
    ' mm・Ase='+r.Ase.toFixed(2)+' mm²）<br>'+
    'φVn='+r.phiVn.toFixed(2)+' kN・φNn='+r.phiNn.toFixed(2)+' kN・基版承壓上限 '+r.fpCap.toFixed(1)+' kgf/cm²<br>'+
    '最大比值 <b>'+worst.worst.toFixed(3)+'</b>（J'+v300Esc(worst.joint)+'）・NG <b>'+r.ng+'</b>/'+r.rows.length+
    (r.cbfOn&&bpCbf?'<br><b>混凝土破壞（ACI §17.6／17.7）</b>　'+
      'φNcbg='+(0.75*bpCbf.NcbgKN/9.80665).toFixed(2)+' tf・'+
      'φNpn='+(0.75*bpCbf.NpnKN/9.80665).toFixed(2)+' tf・'+
      'φVcbg='+(0.70*bpCbf.VcbgKN/9.80665).toFixed(2)+' tf・'+
      'φVcpg='+(0.70*bpCbf.VcpgKN/9.80665).toFixed(2)+' tf':'')+
    (r.arOn?'<br><b>錨定補強</b>　主筋 '+r.mN+' 支・Ts='+r.Ts.toFixed(2)+' kN/支・'+
      'Ld,avail='+r.LdAvail.toFixed(1)+' mm（Fredu='+r.FreduM.toFixed(3)+'）→ <b>Tbar='+r.Tbar.toFixed(2)+'</b> kN<br>'+
      '　箍筋 '+r.layA+'／'+r.layB.toFixed(1)+' mm 平均 '+r.LdhAvail.toFixed(1)+
      '（Fredu='+r.FreduT.toFixed(3)+'）→ <b>Ttie='+r.Ttie.toFixed(2)+'</b> kN':'')+
    '<span class="pm-origin">錨栓鋼材強度依 ACI 318-19 §17.7（Vsa=n·0.6·Ase·futa、Nsa=n·Ase·futa），'+
    '拉剪互制依 §17.8.3 之 5/3 次式；承壓與板厚依 AISC Design Guide 1。'+
    (r.arOn?'錨定補強依 §17.5.2.1，以柱墩主筋抵抗拉力、箍筋抵抗剪力取代混凝土錐體計算'+
      '（做法對齊公版「7.1.3 Anchor Reinforcement」）。<b>未含</b>：拔出 Npn、側向劈裂、'+
      '無補強時之混凝土錐體 Ncb／Vcb——若不採錨定補強路徑，這些仍須另行檢核。':
      '<b>目前未啟用錨定補強</b>——混凝土錐體破壞、拔出、劈裂皆未檢核，'+
      '本結果只代表鋼材強度足夠，不代表錨栓可行。')+'</span>';
  if(bdg){bdg.textContent=r.ng?'NG '+r.ng:'完成・全 OK';bdg.className='badge '+(r.ng?'b-ng':'b-ok')}
  if(tb){
    tb.style.display='';
    tb.innerHTML='柱腳  斷面           Pu(tf)  Vu(tf)  Tu(tf)  承壓比  板厚比  剪力比  拉力比  互制  主筋比  箍筋比\n'+
      r.rows.map(x=>{
        const f=(v,w,p)=>(v!==null&&Number.isFinite(v)?v.toFixed(p):'—').padStart(w);
        return ('J'+x.joint).padEnd(6)+String(x.col?.sect||'—').padEnd(17)+
               f(x.Pu,6,2)+f(x.Vu,8,2)+f(x.Tu,8,2)+
               f(x.brg,8,3)+f(x.tRatio,8,3)+f(x.vR,8,3)+f(x.tR,8,3)+f(x.inter,8,3)+
               f(x.arT,8,3)+f(x.arV,8,3)+
               (x.ok?'  ok':'  NG');
      }).join('\n');
  }
}
/* ==== V4.15.0 柱續接／梁續接（計算書 7.3.2）====
   檢核式取自公版 Excel（螺栓設計_柱續接_摩阻型 LRFD V2.1 / BeamSplice）：
     滑動  φRstr = φ·1.13·μ·Tb·Ns
     承壓  φvRn  = φv·min(1.2·Fu·Lc·t, 2.4·Fu·db·t)
     淨斷面 φvTn = φv·Fu·Ae，Ae = min(U·An, 0.85·Ag)
     間距上限 min(24·t_min, 30) cm；最大邊距 min(12·t_min, 15) cm
   內力分配採鋼結構極限設計法標準做法（翼板抵抗彎矩＋軸力分擔、腹板抵抗剪力），
   非直接複製該 Excel 的具名範圍（其分配式含 VBA 自訂函式，無法從檔案還原）。 */
let splResult=null,splNote='',splStationList=[];
function splObjects(){return studObjects()}
function renderSplPick(){
  const objs=splObjects(),sel=$('spl-frame'),pick=$('spl-opt');
  if(!sel||!pick)return;
  if(!objs.size)return;
  const prev=sel.value;
  sel.innerHTML=[...objs.keys()].map(id=>'<option value="'+v300Esc(id)+'">'+v300Esc(studFrameLabel(id))+'</option>').join('');
  if(prev&&objs.has(prev))sel.value=prev;
  renderSplStations();
}
function renderSplStations(){
  const sel=$('spl-station'),obj=$('spl-frame')?.value;if(!sel)return;
  splStationList=splObjects().get(String(obj))||[];
  const prev=sel.value;
  sel.innerHTML=splStationList.map((k,i)=>'<option value="'+i+'">'+v300Esc(k.resultId)+' @ '+k.station.toFixed(3)+' m</option>').join('');
  if(prev&&splStationList[+prev])sel.value=prev;
}
/* 該斷面逐組合的局部軸內力包絡 */
function splDemand(){
  const pick=splStationList[+($('spl-station')?.value??-1)];if(!pick)return null;
  const {defs}=studIndex();
  const scope=comboScopeOf('spl-combo-scope');
  const {names:scopeNames,excluded}=comboScopeNames(defs,scope);
  let P=null,M3=null,M2=null,V2=null,V3=null;
  const upd=(o,v,name)=>(!o||Math.abs(v)>Math.abs(o.val))?{val:v,combo:name}:o;
  let n=0;
  for(const name of scopeNames){
    const c=studCombine(pick,name,defs);
    if(!c||c.P==null||c.M3==null)continue;
    n++;
    P=upd(P,c.P,name);M3=upd(M3,c.M3,name);M2=upd(M2,v300Num(c.M2),name);
    V2=upd(V2,v300Num(c.V2),name);V3=upd(V3,v300Num(c.V3),name);
  }
  if(!n)return null;
  return {pick,combos:n,excluded:scope==='strength'?excluded:0,scope,P,M3,M2,V2,V3};
}
function splRun(autoMode){
  const dem=splDemand();
  if(!dem){splNote='此斷面位置沒有可重組的線性 Load Comb 結果。';renderSplSummary();return}
  const g=id=>v300Num($(id)?.value,0);
  const type=$('spl-type')?.value||'col',mode=$('spl-mode')?.value||'slip';
  const src=$('spl-force')?.value||'actual',ratio=g('spl-ratio');
  const Fy=g('spl-Fy'),Fu=g('spl-Fu'),db=g('spl-db'),Tb=g('spl-Tb'),mu=g('spl-mu'),phi=g('spl-phi');
  const t1=g('spl-t1'),b1=g('spl-b1'),nsf=Math.max(1,Math.round(g('spl-nsf'))),lcf=g('spl-lcf');
  const nRow=Math.max(1,Math.round(g('spl-nrow'))),nCol=Math.max(1,Math.round(g('spl-ncol')));
  const sPitch=g('spl-s'),gGage=g('spl-g'),lev=g('spl-lev');
  const nf=nRow*nCol;
  if($('spl-nf'))$('spl-nf').value=nf;
  if($('spl-nf-view'))$('spl-nf-view').textContent=nf;
  const t2=g('spl-t2'),nsw=Math.max(1,Math.round(g('spl-nsw'))),lcw=g('spl-lcw');
  const nRowW=Math.max(1,Math.round(g('spl-nroww'))),nColW=Math.max(1,Math.round(g('spl-ncolw')));
  const sW=g('spl-sw'),gW=g('spl-gw'),h2=g('spl-h2'),ecc=g('spl-ecc');
  const nw=nRowW*nColW;
  if($('spl-nw'))$('spl-nw').value=nw;
  if($('spl-nw-view'))$('spl-nw-view').textContent=nw;
  const phiv=0.75;
  const sect=model?.sections?.[dem.pick.object!=null?(model.frames.find(f=>String(f.id)===String(dem.pick.object))?.sect||''):'']||{};
  /* 斷面（模型單位為 m）→ cm */
  const d=v300Num(sect.t3)*100,bf=v300Num(sect.t2)*100,tf=v300Num(sect.tf)*100,tw=v300Num(sect.tw)*100;
  const Ag=v300Num(sect.area)*1e4,Z33=v300Num(sect.z33)*1e6;
  if(!(d>0&&bf>0&&tf>0)){splNote='此桿件缺斷面尺寸（t3／t2／tf），無法計算翼板分擔。';renderSplSummary();return}
  /* 設計內力：實際包絡 vs 規範下限 */
  const Pact=Math.abs(dem.P.val),Mact=Math.abs(dem.M3.val),Vact=Math.abs(dem.V2.val);
  const Pmin=ratio*Fy*Ag,Mmin=ratio*Fy*Z33/100;/* Z33 cm³ → tf·m */
  const pickMax=(a,b)=>src==='actual'?a:src==='ratio'?b:Math.max(a,b);
  const Pu=pickMax(Pact,Pmin),Mu=pickMax(Mact,Mmin),Vu=Vact;
  /* 翼板力：彎矩偶力 + 軸力依翼板面積分擔（柱續接才計軸力） */
  const Af=bf*tf,arm=Math.max(1,(d-tf))/100;/* m */
  const Ff=Mu/arm+(type==='col'?Pu*(Af/Math.max(Ag,1e-9)):0);
  const Vw=Vu;
  /* 單顆螺栓強度 */
  const Rslip=phi*1.13*mu*Tb;                       /* 每一剪力面 */
  const brgOf=(lc,t)=>phiv*Math.min(1.2*Fu*lc*t,2.4*Fu*db*t);
  const RbrgF1=brgOf(lcf,t1),RbrgFm=brgOf(lcf,tf);          /* 拼接板／母材翼板 */
  const RbrgW2=brgOf(lcw,t2),RbrgWm=brgOf(lcw,tw||t2);      /* 拼接板／母材腹板 */
  const RbrgF=Math.min(RbrgF1,RbrgFm),RbrgW=Math.min(RbrgW2,RbrgWm);
  const capF=mode==='slip'?Math.min(Rslip*nsf,RbrgF):RbrgF;
  const capW=mode==='slip'?Math.min(Rslip*nsw,RbrgW):RbrgW;
  if(autoMode){
    const needF=capF>0?Math.ceil(Ff/capF):0,needW=capW>0?Math.ceil(Vw/capW):0;
    const rowNew=Math.max(1,Math.ceil(needF/nCol)),nfNew=rowNew*nCol;
    const rowWNew=Math.max(1,Math.ceil(needW/nColW)),nwNew=rowWNew*nColW;
    $('spl-nrow').value=rowNew;$('spl-nf').value=nfNew;
    if($('spl-nf-view'))$('spl-nf-view').textContent=nfNew;
    $('spl-nroww').value=rowWNew;$('spl-nw').value=nwNew;
    if($('spl-nw-view'))$('spl-nw-view').textContent=nwNew;
    /* 所需拼接板厚：φv·Fu·Ae ≥ Ff，Ae=min(An, 0.85Ag)，An=(b1−nRow·dm)·t1、Ag=b1·t1 */
    const dm0=db+0.3;
    const netW=Math.max(0.1,b1-nCol*dm0);
    const t1a=Ff/(phiv*Fu*netW), t1b=Ff/(phiv*Fu*0.85*Math.max(b1,0.1));
    const t1req=Math.max(t1a,t1b);
    splNote='已依目前內力建議：翼板 '+rowNew+' 列 × '+nCol+' 行 = '+nfNew+' 支、'+
      '腹板 '+rowWNew+' 列 × '+nColW+' 行 = '+nwNew+' 支（腹板未計偏心，實跑後請再確認）；'+
      '翼板拼接板（寬 '+b1+' cm）所需板厚 ≥ '+t1req.toFixed(2)+' cm（目前 '+t1+' cm'+
      (t1req>t1?'，<b>不足</b>':'，足夠')+'）。'+
      '<b>此建議只算強度</b>——螺栓間距、邊距、排列與腹板拼接板尺寸仍須依標準圖與規範自行確認。';
    splResult=null;renderSplSummary();return;
  }
  /* 腹板螺栓群偏心剪力（彈性向量法）：
     螺栓座標以群心為原點，Ip=Σ(x²+y²)；直接剪力 V/n（垂直向）
     附加彎矩 Me=V·e → 各螺栓 Fx=Me·y/Ip、Fy=Me·x/Ip；取合力最大者 */
  const wPts=[];
  for(let i=0;i<nRowW;i++)for(let j=0;j<nColW;j++)
    wPts.push({x:(j-(nColW-1)/2)*gW, y:(i-(nRowW-1)/2)*sW});
  const Ip=wPts.reduce((a,p)=>a+p.x*p.x+p.y*p.y,0);
  const Me=Vw*ecc;
  let RwMax=0;
  for(const p of wPts){
    const fx=Ip>0?Me*p.y/Ip:0, fy=Vw/nw+(Ip>0?Me*p.x/Ip:0);
    RwMax=Math.max(RwMax,Math.hypot(fx,fy));
  }
  /* 板件淨斷面拉斷（翼板拼接板）：孔徑 dm = db + 0.3 cm；垂直力方向共 nCol 個孔 */
  const dm=db+0.3;
  const Ag1=b1*t1,An1=Ag1-nCol*dm*t1,Ae1=Math.min(1.0*An1,0.85*Ag1);
  const Tn1=phiv*Fu*Ae1;
  /* 塊狀撕裂（依公版 Excel 之式）：
       兩側剪力面長度 = Le + (nRow−1)·s；受拉面寬 = (nCol−1)·g
       Agv=2·Lv·t、Anv=Agv−2·(nRow−0.5)·dm·t、Agt=(nCol−1)·g·t、Ant=Agt−(nCol−1)·dm·t
       φTn = min( 拉強≥剪強 ? φv(0.6FyAgv+FuAnt) : φv(0.6FuAnv+FyAgt), φv(0.6FuAnv+FuAnt) ) */
  const Lv=lcf+(nRow-1)*sPitch;
  const Agv=2*Lv*t1, Anv=Math.max(0,Agv-2*(nRow-0.5)*dm*t1);
  const Agt=(nCol-1)*gGage*t1, Ant=Math.max(0,Agt-(nCol-1)*dm*t1);
  const tenR=Fu*Ant, shrR=0.6*Fu*Anv;
  const bsPath=tenR>=shrR?phiv*(0.6*Fy*Agv+Fu*Ant):phiv*(0.6*Fu*Anv+Fy*Agt);
  const bsCap=phiv*(0.6*Fu*Anv+Fu*Ant);
  const Tbs=nCol>1?Math.min(bsPath,bsCap):null;/* 單行螺栓無受拉面，不適用 */
  /* 間距與邊距限制（Excel：最大間距 min(24t,30)、最大邊距 min(12t,15)；最小間距 3db） */
  const tMin=Math.min(t1,t2,tf,tw||t1);
  const sMax=Math.min(24*tMin,30),leMax=Math.min(12*tMin,15),sMin=3*db;
  const sAll=[sPitch,sW].concat(nCol>1?[gGage]:[]).concat(nColW>1?[gW]:[]).filter(x=>x>0);
  const sUsedMax=Math.max(...sAll), sUsedMin=Math.min(...sAll);
  const leUsedMax=Math.max(lcf,lev,lcw);
  /* 腹板拼接板（單片）：剪降伏 φ0.6FyAgv、剪斷 φv0.6FuAnv、塊狀撕裂 */
  const AgvW=h2*t2, AnvW=Math.max(0,AgvW-nRowW*dm*t2);
  const VyW=0.9*0.6*Fy*AgvW, VrW=phiv*0.6*Fu*AnvW;
  const LvW=lcw+(nColW-1)*gW;
  const AgvW2=2*LvW*t2, AnvW2=Math.max(0,AgvW2-2*(nColW-0.5)*dm*t2);
  const AgtW=(nRowW-1)*sW*t2, AntW=Math.max(0,AgtW-(nRowW-1)*dm*t2);
  const tenW=Fu*AntW, shrW2=0.6*Fu*AnvW2;
  const bsPathW=tenW>=shrW2?phiv*(0.6*Fy*AgvW2+Fu*AntW):phiv*(0.6*Fu*AnvW2+Fy*AgtW);
  const bsCapW=phiv*(0.6*Fu*AnvW2+Fu*AntW);
  const TbsW=nRowW>1?Math.min(bsPathW,bsCapW):null;
  const rows=[
    {item:'翼板螺栓（'+(mode==='slip'?'摩阻':'承壓')+'）',dem:Ff,cap:capF*nf,r:capF*nf>0?Ff/(capF*nf):Infinity},
    {item:'腹板螺栓（含偏心）',dem:RwMax,cap:capW,r:capW>0?RwMax/capW:Infinity},
    {item:'翼板承壓：拼接板',dem:Ff/Math.max(nf,1),cap:RbrgF1,r:RbrgF1>0?(Ff/Math.max(nf,1))/RbrgF1:Infinity},
    {item:'翼板承壓：母材翼板',dem:Ff/Math.max(nf,1),cap:RbrgFm,r:RbrgFm>0?(Ff/Math.max(nf,1))/RbrgFm:Infinity},
    {item:'腹板承壓：拼接板',dem:RwMax,cap:RbrgW2,r:RbrgW2>0?RwMax/RbrgW2:Infinity},
    {item:'腹板承壓：母材腹板',dem:RwMax,cap:RbrgWm,r:RbrgWm>0?RwMax/RbrgWm:Infinity},
    {item:'翼板拼接板淨斷面',dem:Ff,cap:Tn1,r:Tn1>0?Ff/Tn1:Infinity},
    {item:'翼板拼接板塊狀撕裂',dem:Ff,cap:Tbs,r:Tbs!==null&&Tbs>0?Ff/Tbs:null},
    {item:'腹板拼接板剪降伏',dem:Vw,cap:VyW,r:VyW>0?Vw/VyW:Infinity},
    {item:'腹板拼接板剪斷',dem:Vw,cap:VrW,r:VrW>0?Vw/VrW:Infinity},
    {item:'腹板拼接板塊狀撕裂',dem:Vw,cap:TbsW,r:TbsW!==null&&TbsW>0?Vw/TbsW:null},
    {item:'螺栓間距下限 3db',dem:sMin,cap:sUsedMin,r:sUsedMin>0?sMin/sUsedMin:Infinity},
    {item:'螺栓間距上限',dem:sUsedMax,cap:sMax,r:sMax>0?sUsedMax/sMax:Infinity},
    {item:'邊距上限',dem:leUsedMax,cap:leMax,r:leMax>0?leUsedMax/leMax:Infinity}
  ];
  const valid=rows.filter(x=>x.r!==null&&Number.isFinite(x.r));
  const worst=valid.length?valid.reduce((a,b)=>b.r>a.r?b:a):rows[0];
  splNote='';
  splResult={type,mode,src,ratio,Fy,Fu,db,Tb,mu,phi,nf,nw,nsf,nsw,nRow,nCol,sPitch,gGage,lev,
             Agv,Anv,Agt,Ant,Tbs,sMin,sMax,nRowW,nColW,sW,gW,h2,ecc,Ip,Me,RwMax,
             AgvW,AnvW,VyW,VrW,TbsW,RbrgF1,RbrgFm,RbrgW2,RbrgWm,
             d,bf,tf,tw,Ag,Z33,Af,arm,dem,Pu,Mu,Vu,Pact,Mact,Pmin,Mmin,
             Ff,Vw,Rslip,RbrgF,RbrgW,capF,capW,Ae1,Tn1,sMax,leMax,rows,worst,
             ok:worst.r<=1&&Number.isFinite(worst.r)};
  renderSplSummary();
}
function renderSplSummary(){
  const sum=$('spl-summary'),bdg=$('bdg-spl'),opt=$('spl-opt'),tb=$('spl-table');
  if(!sum)return;
  const ready=!!(V304.imported?.rows||[]).length;
  if(!ready){
    sum.innerHTML='<b>尚未載入 Element Forces</b><br>請匯入第二個 Analysis Results S2K。';
    if(opt)opt.style.display='none';if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(opt)opt.style.display='';
  renderSplPick();
  const r=splResult;
  if(!r){
    sum.innerHTML='已就緒：<b>'+splObjects().size+'</b> 支桿件有內力結果<br>選桿件與斷面位置，設定螺栓與板件後按「執行續接檢核」。'+
      (splNote?'<br>'+splNote:'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  sum.innerHTML='<b>'+(r.type==='col'?'柱續接':'梁續接')+'</b>　'+v300Esc(studFrameLabel(r.dem.pick.object))+
    '　'+r.dem.pick.resultId+' @ '+r.dem.pick.station.toFixed(3)+' m（'+r.dem.combos+' 組合）<br>'+
    '設計內力：P=<b>'+r.Pu.toFixed(2)+'</b> tf・M=<b>'+r.Mu.toFixed(2)+'</b> tf·m・V=<b>'+r.Vu.toFixed(2)+'</b> tf'+
    '（實際 P='+r.Pact.toFixed(2)+'／M='+r.Mact.toFixed(2)+'　下限 P='+r.Pmin.toFixed(2)+'／M='+r.Mmin.toFixed(2)+'）<br>'+
    '翼板力 Ff=<b>'+r.Ff.toFixed(2)+'</b> tf（力臂 '+r.arm.toFixed(3)+' m）・腹板剪力 '+r.Vw.toFixed(2)+' tf<br>'+
    '單顆螺栓：滑動 '+r.Rslip.toFixed(2)+' tf/面・翼板承壓 '+r.RbrgF.toFixed(2)+'・腹板承壓 '+r.RbrgW.toFixed(2)+' tf<br>'+
    '腹板螺栓群：'+r.nRowW+' 列 × '+r.nColW+' 行・Ip='+r.Ip.toFixed(1)+' cm²・偏心 e='+r.ecc+
    ' cm → Me='+r.Me.toFixed(2)+' tf·cm・臨界螺栓合力 <b>'+r.RwMax.toFixed(2)+'</b> tf'+
    '（不計偏心時僅 '+(r.Vw/Math.max(r.nw,1)).toFixed(2)+' tf）<br>'+
    '最大比值 <b>'+(Number.isFinite(r.worst.r)?r.worst.r.toFixed(3):'—')+'</b>（'+v300Esc(r.worst.item)+'）'+
    '<span class="pm-origin">檢核式取自公版 Excel（滑動 φ·1.13·μ·Tb·Ns、承壓 φv·min(1.2FuLct, 2.4Fudbt)、'+
    '淨斷面 φv·Fu·Ae）。<b>內力分配採標準做法</b>（翼板抵抗彎矩偶力＋軸力依面積分擔、腹板抵抗剪力），'+
    '非複製該 Excel 之具名範圍（含 VBA 自訂函式無法還原）——請對照貴公司標準圖確認。'+
    '螺栓排列 '+r.nRow+' 列 × '+r.nCol+' 行（s='+r.sPitch+'、g='+r.gGage+' cm）；'+
    '塊狀撕裂 Agv='+r.Agv.toFixed(1)+'、Anv='+r.Anv.toFixed(1)+'、Agt='+r.Agt.toFixed(1)+
    '、Ant='+r.Ant.toFixed(1)+' cm²'+(r.Tbs===null?'（單行螺栓不適用）':'')+'。</span>'+
    (splNote?'<br>'+v300Esc(splNote):'');
  if(bdg){bdg.textContent=r.ok?'完成・全 OK':'有 NG';bdg.className='badge '+(r.ok?'b-ok':'b-ng')}
  if(tb){
    tb.style.display='';
    tb.innerHTML='檢核項目                 需求      強度      比值\n'+
      r.rows.map(x=>x.item.padEnd(24)+
        (Number.isFinite(x.dem)?x.dem.toFixed(2):'—').padStart(8)+
        (Number.isFinite(x.cap)?x.cap.toFixed(2):'—').padStart(10)+
        (x.r!==null&&Number.isFinite(x.r)?x.r.toFixed(3):'—').padStart(9)+
        (x.r===null||!Number.isFinite(x.r)?'  n/a':x.r<=1?'  ok':'  NG')).join('\n');
  }
}
/* ==== V4.15.0 桿件應力比（計算書 6.5；鋼結構極限設計法 LRFD）====
   受壓 φcPn（λc 分段）、受拉 φtPn（降伏／斷裂）、受撓 φbMn（Lp／Lr／LTB）、
   剪力 φvVn、合併應力比（H1 兩式）。
   假設：Lb = K·L×(Lb/L)、Cb 由使用者給（預設 1.0 保守）、Ae/Ag 由使用者給。
   斷面性質直接讀 FRAME SECTION PROPERTIES 01 - GENERAL（含 I33/I22/S/Z/AS2/AS3/J）。 */
let memResult=null,memNote='',memComboInfo=null;
function memSectProps(){
  const rows=tables?.['FRAME SECTION PROPERTIES 01 - GENERAL']||[];
  const m=new Map();
  for(const r of rows){
    const nm=String(r.SectionName??'').trim();if(!nm)continue;
    const num=k=>v300Num(r[k]);
    m.set(nm,{name:nm,shape:String(r.Shape||''),
      A:num('Area')*1e4,                       /* m²→cm² */
      I33:num('I33')*1e8,I22:num('I22')*1e8,   /* m⁴→cm⁴ */
      S33:Math.min(num('S33Top')||Infinity,num('S33Bot')||Infinity)*1e6,
      S22:Math.min(num('S22Left')||Infinity,num('S22Right')||Infinity)*1e6,
      Z33:num('Z33')*1e6,Z22:num('Z22')*1e6,   /* m³→cm³ */
      AS2:num('AS2')*1e4,AS3:num('AS3')*1e4,
      J:num('TorsConst')*1e8,
      d:num('t3')*100,bf:num('t2')*100,tf:num('tf')*100,tw:num('tw')*100});
  }
  return m;
}
/* 受撓強度 φbMn（強軸）：Lp／Lr／LTB 三段 */
function memMnStrong(p,Fy,E,Lb,Cb){
  const G=E/2.6;                                   /* ≈ E/2(1+ν)，ν=0.3 */
  const ry=Math.sqrt(Math.max(p.I22,1e-9)/Math.max(p.A,1e-9));
  const Mp=p.Z33*Fy/100;                           /* tf·cm → tf·m */
  const My=p.S33*Fy/100;
  const Lp=1.76*ry*Math.sqrt(E/Fy);
  const ho=Math.max(p.d-p.tf,1e-6);
  const Cw=p.I22*ho*ho/4;
  const S=Math.max(p.S33,1e-9);
  const X1=(Math.PI/S)*Math.sqrt(E*G*Math.max(p.J,1e-9)*p.A/2);
  const X2=4*(Cw/Math.max(p.I22,1e-9))*Math.pow(S/(G*Math.max(p.J,1e-9)),2);
  const FL=Fy-0.7;                                 /* 殘留應力，取 0.7 tf/cm² */
  const Lr=Number.isFinite(X1)&&FL>0?ry*X1/FL*Math.sqrt(1+Math.sqrt(1+X2*FL*FL)):Infinity;
  let Mn;
  if(Lb<=Lp)Mn=Mp;
  else if(Lb<=Lr)Mn=Math.min(Mp,Cb*(Mp-(Mp-FL*S/100)*(Lb-Lp)/Math.max(Lr-Lp,1e-9)));
  else{
    const Mcr=Cb*Math.PI/Lb*Math.sqrt(E*p.I22*G*Math.max(p.J,1e-9)+Math.pow(Math.PI*E/Lb,2)*p.I22*Cw)/100;
    Mn=Math.min(Mp,Mcr);
  }
  return {Mn:Math.max(0,Mn),Mp,My,Lp,Lr,ry};
}
function memRun(){
  if(!(V304.imported?.rows||[]).length){memNote='尚未載入 Element Forces。';renderMemSummary();return}
  const g=id=>v300Num($(id)?.value,0);
  const Fy=g('mem-Fy'),Fu=g('mem-Fu'),E=g('mem-E'),K=g('mem-K'),lbR=g('mem-lb'),Cb=g('mem-cb'),aeR=Math.min(1,g('mem-ae'));
  const lbB=Math.max(0.05,v300Num($('mem-lbb')?.value,lbR));
  const topN=Math.max(1,Math.round(g('mem-top')));
  if(!(Fy>0&&E>0&&K>0&&lbR>0)){memNote='輸入不合理。';renderMemSummary();return}
  const props=memSectProps(),{defs,idx}=studIndex();
  if(!defs.size){memNote='沒有可用的 Load Comb 定義。';renderMemSummary();return}
  /* 效能關鍵：v304FlattenLinear 會遞迴攤平巢狀組合，成本高。
     全案只攤平一次存成 [組合名, {case:係數}] 陣列，後續純做加權和。
     （V4.15.0 是在每個斷面位置對每個組合各攤平一次 →
       工務大樓 1628 支 × 373 組合 × 多斷面 ≈ 數百萬次，瀏覽器會卡住。） */
  /* V4.15.0：依 SAP 自身的 SteelDesign 旗標篩選組合。
     COMBINATION DEFINITIONS 每個組合都帶 SteelDesign=Strength／Deflection／None，
     SAP 只用 Strength 做鋼構強度設計。舊版把全部組合都丟進來，於是
     WSD（工作應力法，未係數化）、DEF（使用性）、AMP（放大地震力，僅供特定構材）
     也一併參與，產生大量假 NG——工務大樓 373 個組合中只有 79 個是 Strength，
     最大應力比那支 Frame 523 的控制組合 AMP005（含 −3.5×EXP）根本不是鋼構設計組合。 */
  const scope=comboScopeOf('mem-combo-scope');
  const {names:scopeNames,excluded}=comboScopeNames(defs,scope);
  const cbMode=$('mem-cb-mode')?.value||'fixed';
  /* ══ V4.15.0：修正 V4.15.0 的實作缺陷 ══
     ELEMENT FORCES 的 Station 是**各 FrameElem 的區域座標**，不是沿整支
     構材（object）的絕對位置。SAP 會把一個 object 切成多個 element：
     PR B 的 Frame 56 長 14.50 m 卻被切成 10 段，station 只到 1.45 m。
     V4.15.0 直接拿 station 去找 object 全長的 1/4、1/2、3/4 點，
     三個點全部塌縮到同一位置（實測 MA=MB=MC=0.1541），Cb 因而失真。
     修正：由 `OBJECTS AND ELEMENTS - FRAMES` 的 ElemJtI 與節點座標算出
     每個 element 起點距 object 起點的距離，絕對位置 = 該偏移 + 區域 station。
     全案只建一次（逐 object 掃描全部 element 會是 O(n²)）。 */
  let elemAbs=null;
  if(cbMode==='diagram'){
    elemAbs=new Map();
    const frameById=new Map((model?.frames||[]).map(fr=>[String(fr.id),fr]));
    for(const el of (V304.imported?.elements||[])){
      const fr=frameById.get(String(el.object));if(!fr)continue;
      const a0=model?.joints?.[String(fr.i)],j0=model?.joints?.[String(el.jointI)];
      if(a0&&j0)elemAbs.set(String(el.id),Math.hypot(j0.x-a0.x,j0.y-a0.y,j0.z-a0.z));
    }
  }
  const flatCombos=[];
  for(const name of scopeNames){
    const fl=v304FlattenLinear(String(name),defs);
    if(fl.ok&&Object.keys(fl.factors).length)
      flatCombos.push([String(name),Object.entries(fl.factors)]);
  }
  if(!flatCombos.length){
    memNote=scope==='strength'
      ?'沒有標記為 SteelDesign=Strength 的組合；請改選「全部組合」。'
      :'沒有可攤平的線性組合。';
    renderMemSummary();return}
  /* 依桿件彙整：取各斷面位置、各組合的最大合併應力比 */
  const byObj=new Map();
  for(const e of idx.values()){
    if(!byObj.has(e.object))byObj.set(e.object,[]);
    byObj.get(e.object).push(e);
  }
  const phic=0.85,phib=0.9,phit=0.9,phitr=0.75,phiv=0.9;
  const out=[];let skipped=0;
  for(const [objId,entries] of byObj){
    const f=(model?.frames||[]).find(x=>String(x.id)===String(objId));
    const p=f?props.get(f.sect):null;
    if(!p||!(p.A>0)||!(p.Z33>0)){skipped++;continue}
    const a=model?.joints?.[String(f.i)],b=model?.joints?.[String(f.j)];
    const L=a&&b?Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)*100:0;   /* cm */
    if(!(L>0)){skipped++;continue}
    const r33=Math.sqrt(Math.max(p.I33,1e-9)/p.A),r22=Math.sqrt(Math.max(p.I22,1e-9)/p.A);
    const rmin=Math.min(r33,r22);
    /* 梁（兩端近同高）通常由樓版提供側撐，無側撐長度可另設 */
    const isBeam=!!(a&&b&&Math.abs(b.z-a.z)<=0.5);
    const Lb=(isBeam?lbB:lbR)*L;
    /* V4.15.0：軸壓細長比改逐軸計算。
       原本恆用 K·L/rmin，等於「弱軸永遠以整支長度挫屈」——
       使用者為梁設定的 Lb/L 只餵給了 LTB 的 Mn，沒有作用到軸壓項，
       導致有樓版側撐的梁 φcPn 被大幅低估（與 SAP 自身設計結果差 5～9 倍）。
       AISC 中提供 LTB 側撐與抑制弱軸挫屈的是同一批支撐點，故弱軸套用 Lb。
       Lb/L = 1 時 max(K·L/r33, K·L/r22) = K·L/rmin，與舊版完全等價（無回歸）。 */
    const sl33=K*L/r33, sl22=K*Lb/r22;
    const slc=Math.max(sl33,sl22);
    const lc=slc/Math.PI*Math.sqrt(Fy/E);                      /* λc */
    const Fcr=lc<=1.5?Math.pow(0.658,lc*lc)*Fy:(0.877/(lc*lc))*Fy;
    const Pnc=phic*p.A*Fcr;                                    /* tf */
    const Pnt=Math.min(phit*Fy*p.A,phitr*Fu*aeR*p.A);
    const mS=memMnStrong(p,Fy,E,Lb,Cb);
    const Mnx=phib*mS.Mn;                                      /* tf·m */
    /* ══ V4.15.0：逐桿件 Cb（AISC 360 F1-1）══
         Cb = 12.5·Mmax / (2.5·Mmax + 3·MA + 3·MB + 3·MC) ≤ 3.0
       MA／MB／MC 為無側撐段 1/4、1/2、3/4 點之 |M|。
       原本 Cb 為全域單一值（預設 1.0＝最保守的均勻彎矩假設），
       梁的 LTB 正是超限主因，逐桿件計算可去掉這層過度保守。
       ⚠ 本實作取**整支構材**的彎矩圖，故嚴格而言僅在 Lb = L 時等同規範定義；
          Lb/L < 1 時真正的 Cb 應逐段計算，此時輸出會標註提醒。
       ⚠ Cb 隨載重組合而變 → φbMnx 必須逐組合重算（不能沿用單一 Mnx）。 */
    let cbStations=null,cbQ=null,cbSpan=0;
    if(cbMode==='diagram'){
      const absOf=e=>(elemAbs?.get(String(e.resultId))||0)+(e.station||0);
      /* V4.15.0：依絕對位置去重。
         相鄰 element 在交界處各自輸出一筆端點值，同一個斷面因而出現兩筆資料；
         不去重會讓「最接近 1/4 點」的取樣結果取決於資料順序，
         Cb 隨之浮動（實測 Frame 56：去重前 1.296、去重後 1.2746，差 1.7%）。
         物理上同一斷面只該有一個彎矩值，故以位置為鍵合併（保留先出現者）。 */
      const byX=new Map();
      for(const e of entries){
        const k=absOf(e).toFixed(6);
        if(!byX.has(k))byX.set(k,{e,x:Number(k)});
      }
      cbStations=[...byX.values()].sort((u,v)=>u.x-v.x);
      cbSpan=cbStations.length?cbStations[cbStations.length-1].x-cbStations[0].x:0;
      /* 位置需真正涵蓋構材長度才有意義；否則退回固定 Cb（不猜） */
      if(cbStations.length>=3&&cbSpan>=0.5*(L/100)){
        const x0=cbStations[0].x,Lm=L/100;
        const tgt=[x0+0.25*Lm,x0+0.5*Lm,x0+0.75*Lm];
        cbQ=tgt.map(tv=>{
          let best=cbStations[0],bd=Math.abs(cbStations[0].x-tv);
          for(const c of cbStations){const d=Math.abs(c.x-tv);if(d<bd){bd=d;best=c}}
          return best.e;
        });
      }else cbStations=null;
    }
    const Mny=phib*Math.min(p.Z22*Fy/100,1.6*p.S22*Fy/100);
    const Vn2=phiv*0.6*Fy*(p.AS2>0?p.AS2:p.d*p.tw);
    const Vn3=phiv*0.6*Fy*(p.AS3>0?p.AS3:p.bf*p.tf*2);
    let worst=null,prC=null;      /* prC：13.4.1 用的純軸力比（受壓）最大值 */
    for(const e of entries){
      const cs=e.cases;
      for(const [name,terms] of flatCombos){
        let P=0,M3=0,M2=0,V2=0,V3=0,ok=true;
        for(let k=0;k<terms.length;k++){
          const r=cs.get(terms[k][0]);
          if(!r){ok=false;break}
          const w=terms[k][1];
          P+=w*r.P;M3+=w*r.M3;M2+=w*r.M2;V2+=w*r.V2;V3+=w*r.V3;
        }
        if(!ok)continue;
        M3=Math.abs(M3);M2=Math.abs(M2);V2=Math.abs(V2);V3=Math.abs(V3);
        const Pcap=P<0?Pnc:Pnt;                                /* SAP：P<0 為壓 */
        const pr=Pcap>0?Math.abs(P)/Pcap:Infinity;
        let MnxUse=Mnx,cbUse=Cb;
        if(cbQ){
          /* 該組合下沿桿件的 |M3|：Mmax 取所有斷面位置之最大 */
          let Mmax=0;
          for(const c2 of cbStations){
            const e2=c2.e;
            let m=0,ok2=true;
            for(let q=0;q<terms.length;q++){
              const rr=e2.cases.get(terms[q][0]);
              if(!rr){ok2=false;break}
              m+=terms[q][1]*rr.M3;
            }
            if(ok2){const am=Math.abs(m);if(am>Mmax)Mmax=am}
          }
          const qv=cbQ.map(e2=>{
            let m=0,ok2=true;
            for(let q=0;q<terms.length;q++){
              const rr=e2.cases.get(terms[q][0]);
              if(!rr){ok2=false;break}
              m+=terms[q][1]*rr.M3;
            }
            return ok2?Math.abs(m):0;
          });
          const den=2.5*Mmax+3*(qv[0]+qv[1]+qv[2]);
          cbUse=den>1e-9?Math.min(3,12.5*Mmax/den):1;
          if(!(cbUse>0))cbUse=1;
          MnxUse=phib*memMnStrong(p,Fy,E,Lb,cbUse).Mn;
        }
        const mrx=MnxUse>0?M3/MnxUse:Infinity,mry=Mny>0?M2/Mny:Infinity;
        const ratio=pr>=0.2?pr+8/9*(mrx+mry):pr/2+(mrx+mry);
        const vr=Math.max(Vn2>0?V2/Vn2:Infinity,Vn3>0?V3/Vn3:Infinity);
        const gov=Math.max(ratio,vr);
        /* V4.15.0：13.4.1 免檢核門檻要的是「純軸力比」Pu/(φcPn)，不含彎矩項。
           與 gov（H1 合併比）分開追蹤——SAP 的總應力比同樣不能拿來當門檻。 */
        if(P<0&&Pnc>0){
          const prc=Math.abs(P)/Pnc;
          if(!prC||prc>prC.val)prC={val:prc,combo:name,P:Math.abs(P)};
        }
        if(!worst||gov>worst.gov)
          worst={gov,ratio,vr,pr,mrx,mry,P,M3,M2,V2,V3,combo:name,cbUse,MnxUse,
                 station:e.station,resultId:e.resultId,comp:P<0};
      }
    }
    if(!worst){skipped++;continue}
    if(worst&&worst.MnxUse!=null&&Number.isFinite(worst.MnxUse))worst.MnxEff=worst.MnxUse;
    out.push({obj:objId,sect:f.sect,L:L/100,isBeam,lc,Fcr,Pnc,Pnt,
              Mnx:(worst&&worst.MnxEff!=null)?worst.MnxEff:Mnx,MnxFixed:Mnx,Mny,Vn2,Vn3,
              sl33,sl22,slGov:slc>0?(sl33>=sl22?'33（主軸，全長 L）':'22（弱軸，Lb）'):'-',
              Lp:mS.Lp,Lr:mS.Lr,Lb:Lb/100,
              /* 詳細算式所需的中間值 */
              A:p.A,I33:p.I33,I22:p.I22,S33:p.S33,S22:p.S22,Z33:p.Z33,Z22:p.Z22,
              Jt:p.J,dsec:p.d,bf:p.bf,tfs:p.tf,tws:p.tw,AS2:p.AS2,AS3:p.AS3,
              r33,r22,rmin,Lcm:L,Lbcm:Lb,Mp:mS.Mp,MnRaw:mS.Mn,
              prC:prC?prC.val:0,prCcombo:prC?prC.combo:'',prCP:prC?prC.P:0,
              ...worst});
  }
  if(!out.length){memNote='沒有可檢核的桿件（缺斷面性質或內力）。';renderMemSummary();return}
  out.sort((a,b)=>b.gov-a.gov);
  memNote='';
  memComboInfo={scope,used:flatCombos.length,excluded};
  /* ══ V4.15.0：鋼結構極限設計法 13.4.1 放大地震力「免檢核門檻」篩選 ══
     依據 `_台電計算書製作_wiki\wiki\methods\方法_放大地震力判定與組合.md`：
       放大地震力 E' = 1.4·Fu·E（13.3），Fu 不必超過 2.5 → 1.4×2.5 = 3.5
       （與工務大樓 AMP 組合實際使用的 ±3.5×EXP 吻合，交叉驗證成立）。
     13.4.1 末段的免檢核門檻（**先篩再建組合，順序反了會白建**）：
       抗彎矩構架柱，考慮垂直地震時 Pu/(φcPn) ≤ 0.5 → 免檢核
                     不考慮垂直地震時          ≤ 0.4 → 免檢核
       兩者二選一，看柱檢核有沒有帶 EV。
     ⚠ 門檻用的是**純軸力比**，不是 SAP 的總應力比（總比含彎矩項，H1.1）。
     本模組直接用自己算的 φcPn 取 Pu/(φcPn) 受壓最大值，避開這個陷阱。 */
  /* ══ V4.15.0：13.4-1／13.4-2 所需的 D／L／E 案例辨識 ══
     不能用 LOAD PATTERN 的 DesignType 直接分類——實測兩個模型的 **EV（垂直地震）
     都是由 Dead 型樣式組成**（PR B：DEAD×0.287＋SD×0.287；工務大樓：×0.444），
     依樣式型別會把 EV 誤併進 P_D；且 DL 本身已含 DEAD＋SD，全取會重複計算。
     改用規範本身的組合形式辨識（對兩個模型皆成立）：
       1.4×單一案例        → 該案例即 D（101／USD001／LRFD001 = 1.4×DL）
       係數 1.6 出現之案例  → L        （102／LRFD002 = 1.2DL+1.6LL[+0.5LR]）
       對應 Quake 型樣式    → E        （EXP／EXN／EYP／EYN；EV 不屬之） */
  const {dCase,lCase,eCases}=amDLECases(flatCombos);
  const evUsed=flatCombos.some(([,terms])=>terms.some(t=>/^EV$|vert|垂直/i.test(String(t[0]))));
  const amThr=evUsed?0.5:0.4;
  /* 13.4-1（軸壓）：1.2P_D + kL·P_L ± 1.4Fu·P_E ≤ φcPn
     13.4-2（軸拉）：0.9P_D ± 1.4Fu·P_E ≤ φcPn
     ⚠ 規範原文式(13.4-2) 右側**確實是 φcPn**（非 φtPn），此處照規範。
     ⚠ 「1.4Fu·P_E 不必超過相接梁／斜撐傳至柱之最大軸力 1.25 倍」之上限**未套用**
        （需相接構材的極限傳遞軸力，模型未提供）→ 本結果偏保守。
     符號：SAP 的 P<0 為壓，故以 C=−P 轉為「壓為正」再計算。 */
  const amFu=Math.max(0,v300Num($('mem-fu')?.value,2.5));
  const amFuUsed=Math.min(amFu,2.5);                 /* 規範：Fu 不必超過 2.5 */
  const amAmp=1.4*amFuUsed;
  const amKL=v300Num($('mem-pl')?.value,0.5);
  const amEntries=new Map();
  for(const [objId,entries] of byObj)amEntries.set(String(objId),entries);
  for(const x of out){
    if(x.isBeam)continue;
    const entries=amEntries.get(String(x.obj))||[];
    let w=null;
    for(const e of entries){
      const cs=e.cases;
      const gv=n=>{const r=n?cs.get(n):null;return r?-v300Num(r.P):null};   /* 壓為正 */
      const CD=gv(dCase),CL=gv(lCase);
      if(CD===null)continue;
      let CE=0;for(const n of eCases){const v=gv(n);if(v!==null&&Math.abs(v)>CE)CE=Math.abs(v)}
      const Cu=1.2*CD+amKL*(CL||0)+amAmp*CE;          /* 13.4-1 軸壓 */
      const Tu=0.9*CD-amAmp*CE;                        /* <0 表淨拉力 */
      const r1=x.Pnc>0?Math.max(0,Cu)/x.Pnc:Infinity;
      const r2=x.Pnc>0?Math.max(0,-Tu)/x.Pnc:Infinity;
      const g=Math.max(r1,r2);
      if(!w||g>w.g)w={g,r1,r2,Cu,Tu,CD,CL:CL||0,CE,station:e.station,resultId:e.resultId};
    }
    if(w){x.am1=w.r1;x.am2=w.r2;x.amGov=w.g;x.amCu=w.Cu;x.amTu=w.Tu;
          x.amCD=w.CD;x.amCL=w.CL;x.amCE=w.CE;x.amStation=w.station;
      /* 13.4.4 b：放大設計地震力下柱最大軸壓力 Pu ≤ 0.4·Py 時（且兩端剛接），
         檢核放大地震力下之軸向強度時 K 得取 1.0。
         Py = Ag·Fy（全斷面降伏軸力）。
         ⚠ 條件 a「柱兩端為連續或接頭均為剛性接合」無法由 s2k 判定 → 需人工確認。 */
      x.amPy=x.A*Fy;                                   /* tf */
      x.am44=x.amPy>0?Math.max(0,w.Cu)/(0.4*x.amPy):Infinity;
      /* 13.4.3：銲接組合箱型柱，放大地震力下設計軸壓力在設計軸壓強度 80% 以下時，
         相鄰柱板間之銲接得以部分滲透銲（PJP）為之；惟梁柱接頭區及其上下各一倍柱寬
         範圍內仍須全滲透銲（CJP），且含柱續接樓層之柱應全長採 CJP。 */
      x.amBox=/BOX|箱/i.test(String(x.sect||''));
      x.am43=x.Pnc>0?Math.max(0,w.Cu)/(0.8*x.Pnc):Infinity;
    }
  }
  const amAll=out.filter(x=>!x.isBeam).sort((a,b)=>b.prC-a.prC);
  const amBox=amAll.filter(x=>x.amBox);
  const am43Ok=amBox.filter(x=>x.am43<=1).length;      /* 可用 PJP 者 */
  const am44Ok=amAll.filter(x=>x.am44<=1).length;      /* 滿足 0.4Py 者 */
  const amCols=amAll.filter(x=>x.prC>amThr);
  const amTotalCols=amAll.length;
  const amPeak=amAll[0]||null;
  memResult={Fy,Fu,E,K,lbR,lbB,Cb,aeR,topN,total:out.length,skipped,cbMode,
             ng:out.filter(x=>x.gov>1).length,rows:out,
             am:{evUsed,thr:amThr,cols:amCols,totalCols:amTotalCols,peak:amPeak,
                 Fu:amFu,FuUsed:amFuUsed,amp:amAmp,kL:amKL,dCase,lCase,eCases,
                 ng:amCols.filter(x=>x.amGov>1).length,
                 all:amAll,box:amBox,box43Ok:am43Ok,c44Ok:am44Ok}};
  renderMemSummary();
  try{renderMemCompare()}catch(e){console.error(e)}
}
function renderMemSummary(){
  const sum=$('mem-summary'),bdg=$('bdg-mem'),opt=$('mem-opt'),tb=$('mem-table');
  if(!sum)return;
  const ready=!!(V304.imported?.rows||[]).length;
  if(!ready){
    sum.innerHTML='<b>尚未載入 Element Forces</b><br>請匯入第二個 Analysis Results S2K。';
    if(opt)opt.style.display='none';if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(opt)opt.style.display='';
  const r=memResult;
  if(!r){
    sum.innerHTML='已就緒：<b>'+studObjects().size+'</b> 支桿件有內力結果<br>設定材料與長度係數後按「執行全桿件應力比檢核」。'+
      (memNote?'<br>'+v300Esc(memNote):'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const w=r.rows[0];
  const am=r.am;
  const amTxt=am?('<br><b>13.4.1 放大地震力</b>：門檻 Pu/φcPn ≤ <b>'+am.thr+'</b>'+
    (am.evUsed?'（組合含 EV）':'（組合不含 EV）')+'　柱 '+am.totalCols+' 支，'+
    (am.cols.length?'<b style="color:var(--warn)">'+am.cols.length+' 支超標需檢核</b>'
                   :'<b style="color:var(--ok,#3ecf8e)">全數免檢核</b>')+
    (am.peak?'（最大 '+am.peak.prC.toFixed(4)+' @ Frame '+v300Esc(am.peak.obj)+'）':'')+
    (am.cols.length?'<br>　13.4-1／13.4-2（1.4Fu='+am.amp.toFixed(2)+'）：NG <b class="'+
      (am.ng?'ng':'ok')+'">'+am.ng+'</b>/'+am.cols.length+' 支':'')):'';
  const ci=memComboInfo;
  sum.innerHTML=(ci?'載重組合 <b>'+ci.used+'</b> 組'+
      (ci.scope==='strength'&&ci.excluded?'（已排除 '+ci.excluded+' 組非鋼構設計組合）':'（全部組合）')+'<br>':'')+
    '檢核 <b>'+r.total+'</b> 支桿件（略過 '+r.skipped+' 支）<br>'+
    '最大應力比 <b>'+w.gov.toFixed(3)+'</b>（Frame '+v300Esc(w.obj)+'　'+v300Esc(w.sect)+'　'+
    v300Esc(w.combo)+'　'+(w.comp?'壓':'拉')+'）<br>'+
    '超限 <b>'+r.ng+'</b>/'+r.total+' 支'+amTxt+
    (r.ng&&r.lbB>=1&&r.rows.filter(x=>x.gov>1&&x.isBeam).length>r.ng*0.5?
      '<br><b style="color:var(--warn)">⚠ 超限者過半為梁，且梁的 Lb/L 仍設為 '+r.lbB+
      '（＝全跨無側撐）。若樓版提供側撐，請調小後重跑。</b>':'')+
    '<span class="pm-origin">鋼結構極限設計法：受壓 λc 分段（φc=0.85）、受拉取降伏與斷裂較小者、'+
    '受撓 Lp／Lr／LTB（φb=0.9）、合併用 H1 兩式、剪力 φv=0.9。'+
    '<b>假設</b>：Lb/L 柱='+r.lbR+'／梁='+r.lbB+'、K='+r.K+'、Cb='+r.Cb+'、Ae/Ag='+r.aeR+
    '——實際無側撐長度與 Cb 應依側撐配置自行指定。'+
    '<b>未含</b>：局部挫屈折減（斷面分類已在「桿件斷面」圖例另行標示）、扭矩、雙軸剪力互制。</span>';
  if(bdg){bdg.textContent=r.ng?'NG '+r.ng:'完成・全 OK';bdg.className='badge '+(r.ng?'b-ng':'b-ok')}
  if(tb){
    tb.style.display='';
    tb.innerHTML='Frame 斷面              L(m)  組合      P(tf)  Mx(tf·m)  P比   Mx比  My比  剪比  合併\n'+
      r.rows.slice(0,r.topN).map(x=>{
        const f=(v,w2,p2)=>(Number.isFinite(v)?v.toFixed(p2):'—').padStart(w2);
        return String(x.obj).padEnd(6)+String(x.sect||'—').padEnd(18)+
               f(x.L,5,2)+'  '+String(x.combo).padEnd(9)+
               f(x.P,7,1)+f(x.M3,10,2)+f(x.pr,6,2)+f(x.mrx,6,2)+f(x.mry,6,2)+f(x.vr,6,2)+
               f(x.gov,7,3)+(x.gov<=1?'  ok':'  NG');
      }).join('\n')+(r.total>r.topN?'\n…（僅列比值最大的 '+r.topN+' 支，共 '+r.total+' 支）':'');
  }
}
/* ==== V4.15.0 結構計算書產出（計算書章節 H）====
   彙整各模組的結果物件成一份可列印的報告；未執行的模組明確標示「未執行」，
   不以空白或預設值蒙混。章節編號對齊興達維修廠房結構計算書。 */
function rptEsc(x){return v300Esc(String(x??''))}
function rptTable(head,rows){
  if(!rows||!rows.length)return '<div class="rpt-none">（無資料）</div>';
  return '<table><thead><tr>'+head.map(h=>'<th>'+rptEsc(h)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(r=>'<tr>'+r.map(c=>'<td>'+(typeof c==='string'&&/^<span/.test(c)?c:rptEsc(c))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table>';
}
function rptFlag(ok){return ok?'<span class="ok">OK</span>':'<span class="ng">NG</span>'}
function rptNone(why){return '<div class="rpt-none">未執行——'+rptEsc(why)+'</div>'}
/* 3D 模型快照：renderer 未開 preserveDrawingBuffer，需同步 render 後立刻 toDataURL */
function rptModelImage(){
  try{
    if(typeof renderer==='undefined'||!renderer||!scene||!activeCam)return '';
    renderer.render(scene,activeCam);
    return renderer.domElement.toDataURL('image/png');
  }catch(e){return ''}
}
/* 代表性構材的完整推導：把數字代進式子逐步列出，供計算書查核 */
function rptEq(label,formula,subst,result,unit){
  return '<tr><td>'+rptEsc(label)+'</td><td><code>'+rptEsc(formula)+'</code></td>'+
         '<td><code>'+rptEsc(subst)+'</code></td><td><b>'+rptEsc(result)+'</b> '+rptEsc(unit||'')+'</td></tr>';
}
function rptMemDetail(x,r){
  if(!x)return '';
  const n=(v,p)=>Number.isFinite(v)?v.toFixed(p):'—';
  const H=[];
  H.push('<h3>6.5.1 代表性構材詳細計算（控制構材 Frame '+rptEsc(x.obj)+'）</h3>');
  H.push('<div>斷面 <b>'+rptEsc(x.sect)+'</b>　構材長 L = '+n(x.L,3)+' m　'+
    (x.isBeam?'（判定為梁）':'（判定為柱）')+'　控制組合 <b>'+rptEsc(x.combo)+'</b>'+
    '　控制斷面 '+rptEsc(x.resultId)+' @ '+n(x.station,3)+' m</div>');
  H.push('<h4 style="margin:10px 0 4px;font-size:.86rem">（1）斷面性質（取自 SAP2000 FRAME SECTION PROPERTIES）</h4>');
  H.push(rptTable(['項目','數值','項目','數值'],[
    ['A (cm²)',n(x.A,3),'J (cm⁴)',n(x.Jt,3)],
    ['I33 (cm⁴)',n(x.I33,1),'I22 (cm⁴)',n(x.I22,1)],
    ['S33 (cm³)',n(x.S33,1),'S22 (cm³)',n(x.S22,1)],
    ['Z33 (cm³)',n(x.Z33,1),'Z22 (cm³)',n(x.Z22,1)],
    ['d (cm)',n(x.dsec,2),'bf (cm)',n(x.bf,2)],
    ['tf (cm)',n(x.tfs,2),'tw (cm)',n(x.tws,2)],
    ['AS2 (cm²)',n(x.AS2,2),'AS3 (cm²)',n(x.AS3,2)]]));
  H.push('<h4 style="margin:10px 0 4px;font-size:.86rem">（2）受壓強度 φcPn</h4>');
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('迴轉半徑 r33','√(I33/A)',n(x.I33,1)+' / '+n(x.A,3),n(x.r33,4),'cm')+
    rptEq('迴轉半徑 r22','√(I22/A)',n(x.I22,1)+' / '+n(x.A,3),n(x.r22,4),'cm')+
    rptEq('主軸細長比 K·L/r33','K·L/r33',
      r.K+'×'+n(x.Lcm,1)+'/'+n(x.r33,4),n(x.sl33,2),'')+
    rptEq('弱軸細長比 K·Lb/r22','K·Lb/r22（Lb 為無側撐長度）',
      r.K+'×'+n(x.Lbcm,1)+'/'+n(x.r22,4),n(x.sl22,2),'')+
    '<tr><td>控制軸</td><td colspan="2"><code>'+rptEsc(x.slGov)+
      '　（取兩軸較大者）</code></td><td><b>'+n(Math.max(x.sl33,x.sl22),2)+'</b></td></tr>'+
    rptEq('細長參數 λc','(K·L/r)max/π·√(Fy/E)',
      n(Math.max(x.sl33,x.sl22),2)+'/π·√('+r.Fy+'/'+r.E+')',n(x.lc,4),'')+
    rptEq('臨界應力 Fcr',x.lc<=1.5?'0.658^(λc²)·Fy':'0.877·Fy/λc²',
      x.lc<=1.5?'0.658^('+n(x.lc*x.lc,4)+')×'+r.Fy:'0.877×'+r.Fy+'/'+n(x.lc*x.lc,4),n(x.Fcr,4),'tf/cm²')+
    rptEq('受壓強度 φcPn','0.85·A·Fcr','0.85×'+n(x.A,3)+'×'+n(x.Fcr,4),n(x.Pnc,4),'tf')+
    rptEq('受拉強度 φtPn','min(0.9FyA, 0.75Fu·(Ae/Ag)·A)',
      'min(0.9×'+r.Fy+'×'+n(x.A,3)+', 0.75×'+r.Fu+'×'+r.aeR+'×'+n(x.A,3)+')',n(x.Pnt,4),'tf')+
    '</tbody></table>');
  H.push('<h4 style="margin:10px 0 4px;font-size:.86rem">（3）受撓強度 φbMn</h4>');
  const seg=x.Lbcm<=x.Lp?'Lb ≤ Lp（塑性段，Mn = Mp）':
            x.Lbcm<=x.Lr?'Lp < Lb ≤ Lr（非彈性 LTB，線性內插）':'Lb > Lr（彈性 LTB）';
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('塑性彎矩 Mp','Z33·Fy',n(x.Z33,1)+'×'+r.Fy+'/100',n(x.Mp,4),'tf·m')+
    rptEq('Lp','1.76·ry·√(E/Fy)','1.76×'+n(x.r22,4)+'×√('+r.E+'/'+r.Fy+')',n(x.Lp,2),'cm')+
    rptEq('Lr','ry·X1/FL·√(1+√(1+X2·FL²))','（X1、X2 依 Cw=I22·ho²/4 與 J 計算）',n(x.Lr,2),'cm')+
    rptEq('無側撐長度 Lb','(Lb/L)×L',(x.isBeam?r.lbB:r.lbR)+'×'+n(x.Lcm,1),n(x.Lbcm,2),'cm')+
    rptEq('彎矩修正係數 Cb',
      r.cbMode==='diagram'?'12.5Mmax/(2.5Mmax+3MA+3MB+3MC) ≤ 3（AISC F1-1，沿構材絕對位置取點）':'使用者固定值',
      r.cbMode==='diagram'?'由該控制組合之彎矩圖計算':'輸入值',
      n(x.cbUse==null?r.Cb:x.cbUse,4),'')+
    '<tr><td>適用段</td><td colspan="2"><code>'+rptEsc(seg)+'</code></td><td><b>Mn = '+n(x.MnRaw,4)+'</b> tf·m</td></tr>'+
    rptEq('強軸 φbMnx','0.9·Mn','0.9×'+n(x.MnRaw,4),n(x.Mnx,4),'tf·m')+
    rptEq('弱軸 φbMny','0.9·min(Z22·Fy, 1.6·S22·Fy)',
      '0.9×min('+n(x.Z22,1)+'×'+r.Fy+'/100, 1.6×'+n(x.S22,1)+'×'+r.Fy+'/100)',n(x.Mny,4),'tf·m')+
    '</tbody></table>');
  H.push('<h4 style="margin:10px 0 4px;font-size:.86rem">（4）設計內力與合併應力比</h4>');
  const useC=x.comp,cap=useC?x.Pnc:x.Pnt;
  const h1=x.pr>=0.2?'Pu/φPn + (8/9)·(Mux/φMnx + Muy/φMny)':'Pu/(2φPn) + (Mux/φMnx + Muy/φMny)';
  const h1s=x.pr>=0.2?
    n(x.pr,5)+' + (8/9)×('+n(x.mrx,5)+' + '+n(x.mry,5)+')':
    n(x.pr,5)+'/2 + ('+n(x.mrx,5)+' + '+n(x.mry,5)+')';
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('軸力 Pu','組合 '+x.combo+' 展開','—',n(x.P,4)+'（'+(useC?'壓':'拉')+'）','tf')+
    rptEq('強軸彎矩 Mux','組合展開 |M3|','—',n(x.M3,4),'tf·m')+
    rptEq('弱軸彎矩 Muy','組合展開 |M2|','—',n(x.M2,4),'tf·m')+
    rptEq('軸力比','Pu/φPn',n(Math.abs(x.P),4)+' / '+n(cap,4),n(x.pr,5),'')+
    rptEq('強軸彎矩比','Mux/φMnx',n(x.M3,4)+' / '+n(x.Mnx,4),n(x.mrx,5),'')+
    rptEq('弱軸彎矩比','Muy/φMny',n(x.M2,4)+' / '+n(x.Mny,4),n(x.mry,5),'')+
    rptEq('合併應力比（H1，Pu/φPn '+(x.pr>=0.2?'≥':'<')+' 0.2）',h1,h1s,n(x.ratio,5),'')+
    rptEq('剪力比','max(V2/φvVn2, V3/φvVn3)',
      'max('+n(x.V2,3)+'/'+n(x.Vn2,3)+', '+n(x.V3,3)+'/'+n(x.Vn3,3)+')',n(x.vr,5),'')+
    '<tr><td><b>控制比值</b></td><td colspan="2">max(合併, 剪力)</td><td><b>'+n(x.gov,5)+'</b>　'+
      rptFlag(x.gov<=1)+'</td></tr>'+
    '</tbody></table>');
  return H.join('\n');
}
/* 柱基版與錨栓：控制柱腳的完整推導 */
function rptBpDetail(x,r){
  if(!x)return '';
  const n=(v,p)=>v!==null&&Number.isFinite(v)?v.toFixed(p):'—';
  const H=[];
  H.push('<h3>7.1.3.1 代表性柱腳詳細計算（控制柱腳 J'+rptEsc(x.joint)+'）</h3>');
  H.push('<div>柱斷面 <b>'+rptEsc(x.col?.sect||'—')+'</b>　基版 '+r.B+'×'+r.N+'×'+r.t+' mm　錨栓 '+
    r.n+'-M'+r.dnom+'</div>');
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('強度組合包絡 Pu','各 Load Comb 展開取最大壓','',n(x.PuStr==null?x.Pu:x.PuStr,3),'tf')+
    rptEq('強度組合包絡 Tu','取最大拉','',n(x.TuStr==null?x.Tu:x.TuStr,3),'tf')+
    (x.ampOn?rptEq('13.4-1 放大地震力 Pu','1.2R_D + kL·R_L + 1.4Fu·|R_E|','',n(x.PuAmp||0,3),'tf')+
             rptEq('13.4-2 放大地震力 Tu','−(0.9R_D − 1.4Fu·|R_E|)','',n(x.TuAmp||0,3),'tf'):'')+
    rptEq('設計 Pu','兩者取大','控制 '+x.PuCombo,n(x.Pu,3),'tf')+
    rptEq('設計 Tu','兩者取大','控制 '+x.TuCombo,n(x.Tu,3),'tf')+
    rptEq('反力包絡 Vu','max √(F1²+F2²)','控制組合 '+x.VuCombo,n(x.Vu,3),'tf')+
    rptEq('基版承壓 fp','Pu/(B·N)',n(x.Pu*1000,0)+' / ('+(r.B/10)+'×'+(r.N/10)+')',n(x.fp,2),'kgf/cm²')+
    rptEq('承壓上限','φc·0.85·f\u0027c·√(A2/A1)','0.65×0.85×'+r.fc+'×'+r.a2a1,n(x.fpCap,2),'kgf/cm²')+
    rptEq('承壓比','fp / 上限',n(x.fp,2)+' / '+n(x.fpCap,2),n(x.brg,4),'')+
    rptEq('懸臂 m／n','(N−0.95d)/2 ／ (B−0.8bf)/2','—',n(x.mm,2)+' ／ '+n(x.nn,2),'mm')+
    rptEq('所需板厚 t,req','ℓ·√(2Pu/(0.9·Fy·B·N))','ℓ='+n(x.ell,2)+' mm',n(x.treq,2),'mm')+
    rptEq('板厚比','t,req / t',n(x.treq,2)+' / '+r.t,n(x.tRatio,4),'')+
    rptEq('錨栓有效面積 Ase','π(d−扣牙)²/4','π×'+(r.dnom-(r.dnom-r.dEff))+'²/4',n(r.Ase,2),'mm²')+
    rptEq('錨栓剪力強度 φVn','γm·φ·n·0.6·Ase·futa',
      r.gm+'×'+r.phi+'×'+r.n+'×0.6×'+n(r.Ase,2)+'×'+r.futa+'/1000',n(r.phiVn,2),'kN')+
    rptEq('錨栓拉力強度 φNn','γm·φ·n·Ase·futa',
      r.gm+'×'+r.phi+'×'+r.n+'×'+n(r.Ase,2)+'×'+r.futa+'/1000',n(r.phiNn,2),'kN')+
    rptEq('剪力比','Vu/φVn',n(x.VuKN,2)+' / '+n(r.phiVn,2),n(x.vR,4),'')+
    rptEq('拉力比','Tu/φNn',n(x.TuKN,2)+' / '+n(r.phiNn,2),n(x.tR,4),'')+
    rptEq('拉剪互制','(Tu/φNn)^(5/3) + (Vu/φVn)^(5/3) ≤ 1',
      n(x.tR,4)+'^(5/3) + '+n(x.vR,4)+'^(5/3)',n(x.inter,4),'')+
    (r.arOn?
      rptEq('錨定補強 主筋 Tbar','n·φs·fy·As·Fredu',r.mN+'×'+n(r.Ts,3)+'×'+n(r.FreduM,3),n(r.Tbar,2),'kN')+
      rptEq('主筋比','Tu/Tbar',n(x.TuKN,2)+' / '+n(r.Tbar,2),n(x.arT,4),'')+
      rptEq('錨定補強 箍筋 Ttie','層數·肢數·φs·fy·As·Fredu','—',n(r.Ttie,2),'kN')+
      rptEq('箍筋比','Vu/Ttie',n(x.VuKN,2)+' / '+n(r.Ttie,2),n(x.arV,4),''):'')+
    '<tr><td><b>控制比值</b></td><td colspan="2">各項取最大</td><td><b>'+n(x.worst,4)+'</b>　'+
      rptFlag(x.ok)+'</td></tr>'+
    '</tbody></table>');
  return H.join('\n');
}
/* 續接：控制項的完整推導 */
function rptSplDetail(r){
  if(!r)return '';
  const n=(v,p)=>Number.isFinite(v)?v.toFixed(p):'—';
  const H=[];
  H.push('<h3>7.3.2.1 續接詳細計算（'+(r.type==='col'?'柱續接':'梁續接')+'）</h3>');
  H.push('<div>'+rptEsc(studFrameLabel(r.dem.pick.object))+'　'+rptEsc(r.dem.pick.resultId)+
    ' @ '+n(r.dem.pick.station,3)+' m　'+r.dem.combos+' 組合　'+
    (r.mode==='slip'?'摩阻型':'承壓型')+'</div>');
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('設計軸力 Pu','取'+(r.src==='max'?'實際與規範下限之大者':r.src==='ratio'?'規範下限':'實際包絡'),
      '實際 '+n(r.Pact,2)+' ／ 下限 '+r.ratio+'·Fy·Ag = '+n(r.Pmin,2),n(r.Pu,3),'tf')+
    rptEq('設計彎矩 Mu','同上','實際 '+n(r.Mact,2)+' ／ 下限 '+r.ratio+'·Fy·Z33 = '+n(r.Mmin,2),n(r.Mu,3),'tf·m')+
    rptEq('力臂','d − tf',n(r.d,2)+' − '+n(r.tf,2)+' cm',n(r.arm,4),'m')+
    rptEq('翼板力 Ff','Mu/(d−tf)'+(r.type==='col'?' + Pu·Af/Ag':''),
      n(r.Mu,3)+'/'+n(r.arm,4)+(r.type==='col'?' + '+n(r.Pu,2)+'×'+n(r.Af,1)+'/'+n(r.Ag,1):''),n(r.Ff,3),'tf')+
    rptEq('單顆滑動強度','φ·1.13·μ·Tb',r.phi+'×1.13×'+r.mu+'×'+r.Tb,n(r.Rslip,4),'tf/剪力面')+
    rptEq('翼板承壓（拼接板）','φv·min(1.2FuLct, 2.4Fudbt)','φv=0.75、t=t1',n(r.RbrgF1,3),'tf')+
    rptEq('翼板承壓（母材）','同上，t=tf','—',n(r.RbrgFm,3),'tf')+
    rptEq('翼板螺栓總強度','單顆容量 × nRow×nCol',
      n(r.capF,3)+' × '+r.nRow+'×'+r.nCol,n(r.capF*r.nf,3),'tf')+
    rptEq('翼板螺栓比','Ff / 總強度',n(r.Ff,3)+' / '+n(r.capF*r.nf,3),n(r.Ff/(r.capF*r.nf),4),'')+
    rptEq('拼接板淨斷面 Ae','min(An, 0.85Ag)，An=(b1−nCol·dm)·t1','—',n(r.Ae1,3),'cm²')+
    rptEq('淨斷面強度 φTn','φv·Fu·Ae','0.75×'+r.Fu+'×'+n(r.Ae1,3),n(r.Tn1,3),'tf')+
    rptEq('塊狀撕裂 Agv／Anv','2·Lv·t1 ／ Agv−2(nRow−0.5)·dm·t1','—',n(r.Agv,2)+' ／ '+n(r.Anv,2),'cm²')+
    rptEq('塊狀撕裂 Agt／Ant','(nCol−1)·g·t1 ／ Agt−(nCol−1)·dm·t1','—',n(r.Agt,2)+' ／ '+n(r.Ant,2),'cm²')+
    rptEq('塊狀撕裂強度','min(路徑式, 剪斷+拉斷)','—',r.Tbs===null?'n/a（單行螺栓）':n(r.Tbs,3),'tf')+
    rptEq('腹板螺栓群 Ip','Σ(x²+y²)',r.nRowW+'列×'+r.nColW+'行、s='+r.sW+'、g='+r.gW,n(r.Ip,2),'cm²')+
    rptEq('偏心彎矩 Me','V·e',n(r.Vw,3)+'×'+r.ecc,n(r.Me,3),'tf·cm')+
    rptEq('臨界螺栓合力','√((Me·y/Ip)² + (V/n + Me·x/Ip)²)',
      '不計偏心時僅 '+n(r.Vw/Math.max(r.nw,1),3),n(r.RwMax,3),'tf')+
    '<tr><td><b>控制項</b></td><td colspan="2">'+rptEsc(r.worst.item)+'</td><td><b>'+
      n(r.worst.r,4)+'</b>　'+rptFlag(r.worst.r<=1)+'</td></tr>'+
    '</tbody></table>');
  return H.join('\n');
}
/* 層間位移：控制樓層的完整推導 */
function rptDriftDetail(r){
  if(!r||!r.levels||!r.levels.length)return '';
  const n=(v,p)=>Number.isFinite(v)?v.toFixed(p):'—';
  const g=r.levels.reduce((a,b)=>b.ratio>a.ratio?b:a,r.levels[0]);
  const H=[];
  H.push('<h3>6.7.1 控制樓層詳細計算</h3>');
  H.push('<div>柱線 '+rptEsc(g.line)+'　樓層 '+n(g.zLo,2)+' → '+n(g.zHi,2)+
    ' m　控制組合 <b>'+rptEsc(g.combo)+'</b>　控制方向 '+g.dir+'</div>');
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>代入</th><th>結果</th></tr></thead><tbody>'+
    rptEq('下層節點位移','組合展開後 U1／U2','Joint '+g.jLo,
      n(g.uLo?.u1,8)+' ／ '+n(g.uLo?.u2,8),'m')+
    rptEq('上層節點位移','同上','Joint '+g.jHi,
      n(g.uHi?.u1,8)+' ／ '+n(g.uHi?.u2,8),'m')+
    rptEq('層高 h','z上 − z下',n(g.zHi,3)+' − '+n(g.zLo,3),n(g.h,3),'m')+
    rptEq('X 向位移角','|ΔU1|/h',
      '|'+n(g.uHi?.u1,8)+' − '+n(g.uLo?.u1,8)+'| / '+n(g.h,3),n(g.d1,6),'')+
    rptEq('Y 向位移角','|ΔU2|/h',
      '|'+n(g.uHi?.u2,8)+' − '+n(g.uLo?.u2,8)+'| / '+n(g.h,3),n(g.d2,6),'')+
    rptEq('控制位移角','max(X, Y)','—',n(g.ratio,6),'')+
    rptEq('限值','使用者設定','—',n(r.limit,5),'')+
    '<tr><td><b>判定</b></td><td colspan="2">Δ/h ≤ 限值</td><td><b>'+n(g.ratio/r.limit,4)+'</b>　'+
      rptFlag(g.ratio<=r.limit)+'</td></tr>'+
    '</tbody></table>');
  H.push('<div class="rpt-note">位移已乘放大倍數 '+r.amp+'。逐柱線計算，非各樓層最大位移相減。</div>');
  return H.join('\n');
}
/* 柱墩 P-M／剪力釘：需求端由本平台計算，強度端由內嵌工具計算 */
function rptPmDemandNote(){
  const ctx=pmCtx();if(!ctx)return '';
  const H=[];
  H.push('<div class="rpt-note"><b>需求端計算式（本平台）</b>：'+
    'P = Σ(f·F3)、Mx = Σ(f·(M1 + F2·H))、My = Σ(f·(M2 + F1·H))，'+
    'f 為 Load Comb 展開後的係數，H 為柱墩高度（取自基礎工作區）。'+
    '反力為 Joint Reactions 全域軸，天然含該節點所有構件（含斜撐）。'+
    '<b>強度端</b>（P-M 交互曲線）由內嵌的雙軸彎曲檢核工具依 ACI 318 逐層應變計算，'+
    '其詳細算式請見該工作區的計算書頁。</div>');
  return H.join('\n');
}
function rptStudDemandNote(){
  return '<div class="rpt-note"><b>需求端計算式（本平台）</b>：'+
    '自 ELEMENT FORCES - FRAMES 取該斷面位置各 Load Case 的局部軸內力，'+
    '依 Load Comb 遞迴攤平後線性重組（P、V2、V3、T、M2、M3），單位 tf／tf·m。'+
    '局部軸已內含桿件的 beta 角，且只含該構件自身的內力。'+
    '<b>強度端</b>（釘群彈性分配與 Qn）由內嵌的剪力釘釘群工具計算。</div>';
}
function buildReport(){
  const now=new Date(),pad=x=>String(x).padStart(2,'0');
  const ts=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+' '+pad(now.getHours())+':'+pad(now.getMinutes());
  const full=$('rpt-full')?.checked===true;
  const proj=String(currentS2KFileName||'').replace(/_model definition\.s2k$/i,'').replace(/\.(s2k|\$2k|txt)$/i,'');
  const H=[];
  /* ── 封面 ── */
  H.push('<div class="rpt-cover">'+
    '<div class="t1">結構計算書</div>'+
    '<div class="t2">'+rptEsc(proj||'（未命名工程）')+'</div>'+
    '<div class="info">'+
      '<b>模型定義</b>：'+rptEsc(currentS2KFileName||'—')+'<br>'+
      '<b>分析結果</b>：'+rptEsc(V305.analysisFileName||'—')+'<br>'+
      '<b>分析程式</b>：'+rptEsc(model?.version||'—')+'<br>'+
      '<b>單位系統</b>：'+rptEsc(model?.units||'—')+'<br>'+
      '<b>產生時間</b>：'+ts+'<br>'+
      '<b>產生工具</b>：S2K＋F2K 整合平台'+
    '</div>'+
    '<div class="rpt-sign"><div><span>設計</span></div><div><span>校核</span></div><div><span>審查</span></div></div>'+
    '</div>');
  /* ── 目次 ── */
  H.push('<div class="rpt-toc"><h2>目　次</h2><ol>'+
    ['1. 結構物概述','4. 載重計算（4.1 載重組合）',
     '5. 載重（5.1.3 風力、5.1.4 地震力）',
     '6. 結果檢核（6.1 自然頻率、6.5 桿件應力比＋詳算、6.6 韌性檢核、6.7 層間位移＋詳算）',
     '7. 細部設計（7.1 基礎、7.1.3 柱基版與錨栓＋詳算、7.2.1 柱墩 P-M、7.2.2 剪力釘、7.3.2 續接＋詳算）',
     '附註'].map(x=>'<li>'+rptEsc(x)+'</li>').join('')+'</ol></div>');
  H.push('<div class="rpt-meta">模型：'+rptEsc(currentS2KFileName||'—')+
    (V305.analysisFileName?'　分析結果：'+rptEsc(V305.analysisFileName):'')+
    '　單位：'+rptEsc(model?.units||'—')+'　產生時間：'+ts+
    '　'+(full?'<b>完整版</b>':'摘要版（構材明細僅列前 N 支）')+'</div>');
  H.push('<div class="rpt-note">本報告由各模組的實際計算結果彙整而成。未執行的項目會明確標示，'+
    '不以預設值填充。各模組的假設條件（無側撐長度、Cb、柱墩尺寸、螺栓排列等）請見各節說明。</div>');

  /* 1 結構物概述 */
  H.push('<h2>1. 結構物概述</h2>');
  if(model){
    const js=Object.values(model.joints||{});
    const xs=js.map(j=>j.x),ys=js.map(j=>j.y),zs=js.map(j=>j.z);
    H.push(rptTable(['項目','數值'],[
      ['節點數',js.length],['桿件數',(model.frames||[]).length],['面元素數',(model.areas||[]).length],
      ['X 範圍 (m)',xs.length?Math.min(...xs).toFixed(2)+' ~ '+Math.max(...xs).toFixed(2):'—'],
      ['Y 範圍 (m)',ys.length?Math.min(...ys).toFixed(2)+' ~ '+Math.max(...ys).toFixed(2):'—'],
      ['Z 範圍 (m)',zs.length?Math.min(...zs).toFixed(2)+' ~ '+Math.max(...zs).toFixed(2):'—'],
      ['束制節點（柱腳）',Object.keys(model.restraints||{}).length],
      ['分析程式',model.version||'—']]));
    const img=rptModelImage();
    if(img)H.push('<div class="rpt-fig"><img src="'+img+'"><figcaption>圖 1-1　結構分析模型（3D 視圖，擷取自目前畫面視角）</figcaption></div>');
    else H.push('<div class="rpt-note">3D 模型圖擷取失敗（可先回到 3D 畫面調整視角後再產生報告）。</div>');
  }else H.push(rptNone('尚未載入模型'));

  /* 4 載重組合 */
  H.push('<h2>4. 載重計算</h2><h3>4.1 載重組合</h3>');
  const ld=v300LoadDefinitions();
  H.push('<div>Load Case '+(ld.cases||[]).length+' 個・線性組合 '+(ld.combinations||[]).length+' 組（已遞迴攤平巢狀組合）</div>');
  const lcRows=full?(ld.combinations||[]):(ld.combinations||[]).slice(0,20);
  H.push(rptTable(['組合','成分'],lcRows.map(c=>
    [c.name,Object.entries(c.factors||{}).map(([k,v])=>k+'×'+v).join(' + ')])));
  if(!full&&(ld.combinations||[]).length>20)
    H.push('<div class="rpt-note">僅列前 20 組，共 '+ld.combinations.length+' 組。勾選「完整版」可列出全部。</div>');

  /* 5.1.3 風力 */
  H.push('<h2>5. 載重</h2><h3>5.1.3 風力</h3>');
  if(windState?.loaded){
    H.push(rptTable(['項目','數值'],[
      ['建物 X 向 (m)',windState.dx],['建物 Y 向 (m)',windState.dy],['柱頂標高 (m)',windState.ztop],
      ['耐風工作區採用 h (m)',windState.input?.h??'—'],['柱數',windState.nCols]]));
    H.push(rptTable(['迎風面','柱數','總長 (m)'],(windState.faces||[]).map(f=>[f.wind,f.nCols,f.total])));
    const wtxt=$('wind-s2k')?.textContent||'';
    if(wtxt&&getComputedStyle($('wind-s2k')).display!=='none')
      H.push('<h3>5.1.3.1 逐柱線載重（FRAME LOADS）</h3><pre>'+rptEsc(wtxt.slice(0,4000))+'</pre>');
  }else H.push(rptNone('風力模組未帶入模型幾何'));

  /* 5.1.4 地震力 */
  H.push('<h3>5.1.4 地震力</h3>');
  const ex=seisExisting();
  if(ex){
    H.push('<div>模型現況（AUTO SEISMIC － USER COEFFICIENT）　W = '+(ex.W?ex.W.toFixed(3):'—')+' tf</div>');
    H.push(rptTable(['Load Pattern','方向','偏心','C','V = C·W (tf)'],
      ex.items.map(i=>[i.pat,i.dir,i.ecc,i.C,i.V?i.V.toFixed(3):'—'])));
  }else H.push('<div class="rpt-none">此模型無 AUTO SEISMIC 表</div>');
  if(seisState&&Number.isFinite(seisState.Cx))
    H.push('<div>反應譜新算：C_X = '+seisState.Cx+'　C_Y = '+seisState.Cy+
      (Number.isFinite(seisState.ahMME)?'　垂直 '+seisState.ahMME:'')+'</div>');
  else H.push('<div class="rpt-none">反應譜工作區未算出係數</div>');

  /* 6.1 自然頻率 */
  H.push('<h2>6. 結果檢核</h2><h3>6.1 自然頻率與基本震動週期</h3>');
  if(modResult){
    const rows=modResult.rows,last=rows[rows.length-1];
    const pick=k=>rows.reduce((a,b)=>(b[k]??0)>(a?.[k]??-1)?b:a,null);
    const bx=pick('UX'),by=pick('UY');
    H.push('<div>共 '+rows.length+' 個模態・第一模態 T₁ = <b>'+rows[0].T.toFixed(4)+'</b> s'+
      (bx?'　X 向主控 '+rptEsc(bx.mode)+' T='+bx.T.toFixed(4)+' s':'')+
      (by?'　Y 向主控 '+rptEsc(by.mode)+' T='+by.T.toFixed(4)+' s':'')+'</div>');
    H.push(rptTable(['模態','T (s)','UX','UY','UZ','ΣUX','ΣUY'],
      rows.slice(0,full?rows.length:20).map(x=>{const g=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(4);
        return [x.mode,x.T.toFixed(4),g(x.UX),g(x.UY),g(x.UZ),g(x.SumUX),g(x.SumUY)]})));
    H.push('<div class="rpt-note">來源：'+rptEsc(modResult.fileName)+
      '。累積有效質量 ΣUX '+((last.SumUX??0)*100).toFixed(1)+'%、ΣUY '+((last.SumUY??0)*100).toFixed(1)+
      '%（規範一般要求 ≥ 90%）。</div>');
  }else H.push(rptNone('未載入 Modal 資料'));
  /* 6.5 桿件應力比 */
  H.push('<h3>6.5 桿件應力比（鋼構 LRFD）</h3>');
  if(memResult){
    const r=memResult;
    H.push('<div>檢核 '+r.total+' 支・超限 <b class="'+(r.ng?'ng':'ok')+'">'+r.ng+'</b> 支</div>');
    H.push('<div class="rpt-note">假設：Lb/L 柱='+r.lbR+'／梁='+r.lbB+'、K='+r.K+'、Cb='+r.Cb+
      '、Ae/Ag='+r.aeR+'、Fy='+r.Fy+' tf/cm²。未含局部挫屈折減與扭矩。</div>');
    const memRows=full?r.rows:r.rows.slice(0,r.topN);
    H.push(rptTable(['Frame','斷面','L (m)','控制組合','P (tf)','Mx (tf·m)','合併比','判定'],
      memRows.map(x=>[x.obj,x.sect,x.L.toFixed(2),x.combo,x.P.toFixed(1),x.M3.toFixed(2),
        x.gov.toFixed(3),rptFlag(x.gov<=1)])));
    if(!full&&r.rows.length>r.topN)
      H.push('<div class="rpt-note">僅列應力比最大的 '+r.topN+' 支，共 '+r.rows.length+
        ' 支。勾選工具列「完整版」可列出全部。</div>');
    H.push(rptMemDetail(r.rows[0],r));
    if(memSap){
      const mine=new Map(r.rows.map(x=>[String(x.obj),x]));
      const cmp=memSap.rows.map(sp=>({sp,m:mine.get(String(sp.frame))})).filter(x=>x.m);
      if(cmp.length){
        const rr=cmp.map(x=>x.sp.ratio>0?x.m.gov/x.sp.ratio:NaN).filter(Number.isFinite);
        const avg=rr.reduce((a,b)=>a+b,0)/Math.max(rr.length,1);
        H.push('<h3>6.5.2 與 SAP2000 Steel Design 結果比對</h3>');
        H.push('<div>來源：'+rptEsc(memSap.fileName)+'　比對 '+cmp.length+' 支　'+
          '本模組/SAP 平均倍率 <b>'+avg.toFixed(2)+'</b></div>');
        H.push('<div class="rpt-note">SAP 使用模型內的有效長度與 Design Overwrites；'+
          '本模組的 K、Lb、Cb 為使用者假設。倍率明顯大於 1 表示本模組偏保守，'+
          '應依實際側撐配置調整 Lb/L 後重跑。</div>');
        cmp.sort((a,b)=>(b.m.gov/Math.max(b.sp.ratio,1e-9))-(a.m.gov/Math.max(a.sp.ratio,1e-9)));
        H.push(rptTable(['Frame','斷面','類型','SAP TotalRatio','本模組','倍率'],
          cmp.slice(0,full?cmp.length:20).map(x=>[x.sp.frame,x.sp.sect||x.m.sect,x.sp.type||'—',
            x.sp.ratio.toFixed(4),x.m.gov.toFixed(4),
            x.sp.ratio>0?(x.m.gov/x.sp.ratio).toFixed(2):'—'])));
      }
    }
  }else H.push(rptNone('桿件應力比模組未執行'));

  /* 6.6 韌性檢核 */
  H.push('<h3>6.6 韌性檢核（強柱弱梁／梁柱交會區）</h3>');
  H.push('<div>強柱弱梁：'+rptEsc(($('scwb-status')?.textContent||'').replace(/\s+/g,' ').trim()||'未執行')+'</div>');
  H.push('<div>梁柱交會區：'+rptEsc(($('pjz-status')?.textContent||'').replace(/\s+/g,' ').trim()||'未執行')+'</div>');

  /* 6.7 層間位移 */
  H.push('<h3>6.7 層間位移檢核</h3>');
  if(driftResult){
    const r=driftResult;
    H.push('<div>檢核 '+r.combos+' 組載重・'+r.lines+' 條柱線・限值 Δ/h = '+r.limit+
      '　最大 <b>'+r.worst.ratio.toFixed(5)+'</b>（'+rptEsc(r.worst.combo)+'）</div>');
    H.push(rptTable(['樓層 z (m)','h (m)','Δ/h','控制組合','判定'],
      r.levels.map(x=>[x.zLo.toFixed(2)+' → '+x.zHi.toFixed(2),x.h.toFixed(2),x.ratio.toFixed(5),
        x.combo+' '+x.dir,rptFlag(x.ratio<=r.limit)])));
    H.push('<div class="rpt-note">逐柱線計算；位移放大倍數 '+r.amp+'；限值須與組合等級相符。</div>');
    H.push(rptDriftDetail(r));
  }else H.push(rptNone('層間位移模組未執行'));

  /* 7.1.3 柱基版與錨栓 */
  H.push('<h2>7. 細部設計</h2><h3>7.1.3 柱基版與錨栓</h3>');
  if(bpResult){
    const r=bpResult;
    H.push('<div>基版 '+r.B+'×'+r.N+'×'+r.t+' mm・錨栓 '+r.n+'-M'+r.dnom+
      '（Ase='+r.Ase.toFixed(2)+' mm²）・φVn='+r.phiVn.toFixed(2)+' kN・φNn='+r.phiNn.toFixed(2)+' kN</div>');
    if(r.arOn)H.push('<div>錨定補強：Tbar = '+r.Tbar.toFixed(2)+' kN（主筋 '+r.mN+' 支）・Ttie = '+r.Ttie.toFixed(2)+' kN</div>');
    else H.push('<div class="rpt-note">未啟用錨定補強——本節只代表鋼材強度，混凝土破壞模式未檢核。</div>');
    H.push(rptTable(['柱腳','斷面','Pu (tf)','Pu 來源','Vu (tf)','Tu (tf)','Tu 來源','承壓比','板厚比','剪力比','拉力比','互制','主筋比','箍筋比','判定'],
      r.rows.map(x=>{const f=v=>v!==null&&Number.isFinite(v)?v.toFixed(3):'—';
        return ['J'+x.joint,x.col?.sect||'—',x.Pu.toFixed(2),(x.PuCombo||'—'),x.Vu.toFixed(2),x.Tu.toFixed(2),(x.TuCombo||'—'),
          f(x.brg),f(x.tRatio),f(x.vR),f(x.tR),f(x.inter),f(x.arT),f(x.arV),rptFlag(x.ok)]})));
    const gov=r.rows.reduce((a,b)=>!a||b.worst>a.worst?b:a,null);
    H.push(rptBpDetail(gov,r));
  }else H.push(rptNone('柱基版與錨栓模組未執行'));

  /* 7.2 柱設計 */
  H.push('<h3>7.2.1 柱墩 RC 雙軸 P-M 檢核</h3>');
  if(pmResults&&pmResults.size){
    H.push(rptTable(['柱腳','最大 ratio','控制組合','判定'],
      [...pmResults.entries()].map(([j,r])=>[('J'+j),
        Number.isFinite(r.worstRatio)?r.worstRatio.toFixed(3):'超限',r.worstName||'—',rptFlag(r.ok)])));
    H.push(rptPmDemandNote());
  }else H.push(rptNone('柱墩 P-M 模組未執行'));

  H.push('<h3>7.2.2 RC 柱與鋼柱－剪力釘接合</h3>');
  if(studResult&&studResult.count){
    H.push('<div>'+rptEsc(studResult.label||'')+'</div>');
    H.push(rptTable(['項目','數值'],[['載重組合數',studResult.count],
      ['最大 ratio',studResult.worstRatio==null?'—':Number(studResult.worstRatio).toFixed(3)],
      ['控制組合',studResult.worstCombo||'—'],['判定',studResult.ok?'OK':'NG']]));
    H.push(rptStudDemandNote());
  }else H.push(rptNone('剪力釘模組未執行'));

  /* 7.3.2 構材細長比 */
  H.push('<h3>7.3.2a 構材細長比</h3>');
  if(slResult){
    const r=slResult;
    H.push('<div>檢核 '+r.total+' 支・超限 <b class="'+(r.ng?'ng':'ok')+'">'+r.ng+'</b> 支　'+
      'K='+r.K+'、受壓限值 '+r.limC+'、斜撐（受拉）限值 '+r.limT+'</div>');
    H.push(rptTable(['Frame','斷面','型式','L (m)','rmin (cm)','KL/r','限值','判定'],
      r.rows.slice(0,full?r.rows.length:20).map(x=>[x.id,x.sect,x.kind,x.L.toFixed(2),
        x.rmin.toFixed(2),x.kl.toFixed(1),x.lim,rptFlag(x.ok)])));
  }else H.push(rptNone('細長比模組未執行'));
  /* 7.3.2 續接 */
  H.push('<h3>7.3.2 鋼構接合設計（柱續接／梁續接）</h3>');
  if(splResult){
    const r=splResult;
    H.push('<div>'+(r.type==='col'?'柱續接':'梁續接')+'　'+rptEsc(studFrameLabel(r.dem.pick.object))+
      '　'+rptEsc(r.dem.pick.resultId)+' @ '+r.dem.pick.station.toFixed(3)+' m</div>');
    H.push('<div>設計內力：P = '+r.Pu.toFixed(2)+' tf・M = '+r.Mu.toFixed(2)+' tf·m・V = '+r.Vu.toFixed(2)+
      ' tf　翼板力 Ff = '+r.Ff.toFixed(2)+' tf</div>');
    H.push(rptTable(['檢核項目','需求','強度','比值','判定'],
      r.rows.map(x=>[x.item,Number.isFinite(x.dem)?x.dem.toFixed(2):'—',
        Number.isFinite(x.cap)?x.cap.toFixed(2):'—',
        x.r!==null&&Number.isFinite(x.r)?x.r.toFixed(3):'—',
        x.r===null||!Number.isFinite(x.r)?'<span class="rpt-none">n/a</span>':rptFlag(x.r<=1)])));
    H.push(rptSplDetail(r));
  }else H.push(rptNone('續接模組未執行'));

  /* 基礎 */
  H.push('<h3>7.1 基礎（穩定性／SAFE F2K）</h3>');
  const fs=foundationState?.foundations||[];
  if(fs.length){
    H.push(rptTable(['基礎','Joint 數','狀態'],fs.map(f=>[f.name,(f.joints||[]).length,
      f.lastResult?.status||'未計算'])));
  }else H.push(rptNone('基礎工作區未建立基礎'));

  H.push('<h2>附註</h2>');
  H.push('<div class="rpt-note">本平台以 SAP2000 的 model definition 與 analysis results 兩個 s2k 為唯一資料來源，'+
    '所有載重組合皆由 COMBINATION DEFINITIONS 遞迴攤平計算，未使用任何人工轉貼數值。'+
    '各項檢核之涵蓋範圍與未涵蓋項目，請見平台側欄各模組的說明文字。</div>');
  return H.join('\n');
}
/* ==== V4.15.0 原生模組的 HTML 工作區 ====
   桿件應力比、細長比、層間位移、柱基版與錨栓、續接、自然頻率原本只在側欄顯示（寬度僅 231 px、
   表格截斷成 210 px 高）。這裡加一個共用全螢幕工作區，以分頁切換顯示「完整」結果與推導算式。
   輸入欄位仍留在側欄——避免 id 重複，也讓使用者能邊看 3D 邊調參數。 */
/* 計算書體例助手（與使用者自製計算書一致：公式前標規範式號） */
function cbSec(t){return '<div class="cb-sec">'+t+'</div>'}
function cbF(no,expr,sub){
  return '<div class="cb-formula">'+(no?'<span class="no">'+rptEsc(no)+'</span>':'')+expr+
    (sub?'<div style="font-size:12.5px;color:#456;margin-top:5px">'+sub+'</div>':'')+'</div>';
}
function cbNote(t,warn){return '<div class="cb-note'+(warn?' cb-warn':'')+'">'+t+'</div>'}
function cbKV(pairs){
  const cells=pairs.filter(Boolean);
  let h='<table class="cb-kv"><tbody>';
  for(let i=0;i<cells.length;i+=2){
    h+='<tr><td>'+cells[i][0]+'</td><td>'+cells[i][1]+'</td>';
    if(cells[i+1])h+='<td>'+cells[i+1][0]+'</td><td>'+cells[i+1][1]+'</td>';
    else h+='<td></td><td></td>';
    h+='</tr>';
  }
  return h+'</tbody></table>';
}
function cbBadge(ok){return '<span class="cb-badge '+(ok?'cb-ok':'cb-ng')+'">'+(ok?'O.K':'N.G')+'</span>'}
function cbRefs(rows){
  return cbSec('規範來源對照')+
    '<table class="rpt-t"><thead><tr><th>項目</th><th>依據</th><th>條文／式號</th></tr></thead><tbody>'+
    rows.map(r=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td><td>'+r[2]+'</td></tr>').join('')+
    '</tbody></table>';
}
const CALC_TABS=[
  {id:'mem',  name:'桿件應力比'},
  {id:'sl',   name:'構材細長比'},
  {id:'drift',name:'層間位移'},
  {id:'bp',   name:'柱基版與錨栓'},
  {id:'spl',  name:'續接'},
  {id:'mod',  name:'自然頻率'}
];
let calcTab='mem';
function calcRenderMem(){
  const r=memResult;
  if(!r)return '<h2>6.5 桿件應力比（鋼構 LRFD）</h2>'+rptNone('模組尚未執行——請在側欄按「執行全桿件應力比檢核」');
  const H=['<h2>6.5 桿件應力比（鋼構 LRFD）</h2>'];
  H.push('<div>檢核 <b>'+r.total+'</b> 支（略過 '+r.skipped+'）・超限 <b class="'+(r.ng?'ng':'ok')+'">'+
    r.ng+'</b> 支</div>');
  H.push('<div class="rpt-note">假設：Lb/L 柱='+r.lbR+'／梁='+r.lbB+'、K='+r.K+'、Cb='+r.Cb+
    '、Ae/Ag='+r.aeR+'、Fy='+r.Fy+' tf/cm²。未含局部挫屈折減與扭矩。</div>');
  H.push(rptTable(['Frame','斷面','型式','L (m)','控制組合','P (tf)','Mx (tf·m)','Cb','φbMnx','P比','Mx比','My比','剪比','合併','判定'],
    r.rows.map(x=>[x.obj,x.sect,x.isBeam?'梁':'柱',x.L.toFixed(2),x.combo,x.P.toFixed(2),x.M3.toFixed(3),
      (x.cbUse==null?r.Cb:x.cbUse).toFixed(3),x.Mnx.toFixed(3),
      x.pr.toFixed(3),x.mrx.toFixed(3),x.mry.toFixed(3),x.vr.toFixed(3),x.gov.toFixed(3),rptFlag(x.gov<=1)])));
  H.push(rptMemDetail(r.rows[0],r));
  H.push(calcRenderAmplified(r));
  return H.join('\n');
}
/* V4.15.0：13.4.1 放大地震力免檢核門檻明細
   依據 `_台電計算書製作_wiki／方法_放大地震力判定與組合.md`：
   先用一般 LRFD 組合取純軸力比篩選，超標柱才需要建放大地震力組合（E'=1.4Fu·E，
   Fu 封頂 2.5 → 1.4×2.5=3.5）。順序反了會白建組合。 */
function calcRenderAmplified(r){
  const am=r&&r.am;
  if(!am)return '';
  const H=['<h2>13.4.1 放大地震力免檢核門檻</h2>'];
  H.push('<div>門檻 Pu/(φcPn) ≤ <b>'+am.thr+'</b>　'+
    (am.evUsed?'（檢核組合<b>含</b>垂直地震 EV）':'（檢核組合<b>不含</b>垂直地震 EV）')+
    '　柱 <b>'+am.totalCols+'</b> 支・超標 <b class="'+(am.cols.length?'ng':'ok')+'">'+
    am.cols.length+'</b> 支'+
    (am.peak?'　最大純軸力比 <b>'+am.peak.prC.toFixed(4)+'</b>（Frame '+
      rptEsc(am.peak.obj)+'，組合 '+rptEsc(am.peak.prCcombo)+'）':'')+'</div>');
  H.push('<div class="rpt-note">門檻取<b>純軸力比</b> Pu/(φcPn)，<b>不含彎矩項</b>——'+
    'SAP 的「總應力比」依 AISC 360 H1.1 含彎矩，不可拿來當門檻。'+
    '本表的 Pu 取一般強度組合下的<b>受壓</b>最大值。'+
    '超標者才需依 13.4-1／13.4-2 建 E′=1.4·Fu·E（Fu ≤ 2.5，即係數 ≤ 3.5）的組合檢核；'+
    '全數未超標則整案免檢核。</div>');
  if(!am.cols.length){
    H.push(rptNone('所有柱的純軸力比皆未超過門檻 '+am.thr+'，依 13.4.1 免做放大地震力檢核'));
    H.push(calcRenderAmp4344(am));
    return H.join('\n');
  }
  H.push('<h3 style="margin:12px 0 4px;font-size:.9rem">（1）超標柱清單</h3>');
  H.push(rptTable(['Frame','斷面','L (m)','控制組合','Pu (tf，壓)','φcPn (tf)','純軸力比','門檻','判定'],
    am.cols.map(x=>[x.obj,x.sect,x.L.toFixed(2),x.prCcombo,x.prCP.toFixed(2),x.Pnc.toFixed(2),
      x.prC.toFixed(3),String(am.thr),'需檢核'])));
  H.push('<h3 style="margin:12px 0 4px;font-size:.9rem">（2）13.4-1／13.4-2 放大地震力檢核</h3>');
  H.push('<table><thead><tr><th>項目</th><th>公式</th><th>採用</th></tr></thead><tbody>'+
    rptEq('放大係數','1.4·Fu（Fu 不必超過 2.5）',
      '1.4×'+am.FuUsed.toFixed(2)+(am.Fu>am.FuUsed?'（輸入 '+am.Fu+' 已封頂）':''),
      am.amp.toFixed(3),'')+
    '<tr><td>13.4-1 軸壓</td><td colspan="2"><code>1.2·P_D + '+am.kL+'·P_L ± '+
      am.amp.toFixed(2)+'·P_E ≤ φcPn</code></td></tr>'+
    '<tr><td>13.4-2 軸拉</td><td colspan="2"><code>0.9·P_D ± '+
      am.amp.toFixed(2)+'·P_E ≤ φcPn</code>（規範原文右側即為 φcPn）</td></tr>'+
    '<tr><td>D／L／E 案例</td><td colspan="2"><code>D='+rptEsc(am.dCase||'(未辨識)')+
      '　L='+rptEsc(am.lCase||'(無)')+'　E='+rptEsc(am.eCases.join('／')||'(無)')+'</code></td></tr>'+
    '</tbody></table>');
  H.push('<div class="rpt-note">D／L／E 由組合形式辨識（1.4×單一案例→D、係數 1.6 之案例→L、'+
    '對應 Quake 型樣式→E）。**不可依 LOAD PATTERN 的 DesignType 直接分類**——'+
    '本案的 <b>EV 垂直地震是由 Dead 型樣式組成</b>，那樣會把 EV 誤併進 P_D。'+
    '<b>1.4Fu·P_E 不必超過相接梁／斜撐傳至柱之最大軸力 1.25 倍</b>的上限**未套用**'+
    '（需相接構材的極限傳遞軸力，模型未提供）→ 本結果偏保守。</div>');
  H.push(rptTable(['Frame','斷面','P_D (tf,壓)','P_L (tf,壓)','P_E (tf)','13.4-1 Pu','比值',
                   '13.4-2 Tu','比值','判定'],
    am.cols.map(x=>[x.obj,x.sect,
      x.amCD==null?'-':x.amCD.toFixed(2), x.amCL==null?'-':x.amCL.toFixed(2),
      x.amCE==null?'-':x.amCE.toFixed(2),
      x.amCu==null?'-':x.amCu.toFixed(2), x.am1==null?'-':x.am1.toFixed(3),
      x.amTu==null?'-':x.amTu.toFixed(2), x.am2==null?'-':x.am2.toFixed(3),
      x.amGov==null?'-':rptFlag(x.amGov<=1)])));
  H.push(calcRenderAmp4344(am));
  return H.join('\n');
}
/* V4.15.0：13.4.3（箱型柱銲接）與 13.4.4（K 得取 1.0）之判準
   兩者都以「放大地震力下的設計軸壓力 Pu」為基準，故與 13.4-1 一併呈現。
   13.4.3：Pu ≤ 0.8·φcPn → 相鄰柱板得用部分滲透銲（PJP）
   13.4.4b：Pu ≤ 0.4·Py（Py=Ag·Fy）→ 配合兩端剛接時 K 得取 1.0 */
function calcRenderAmp4344(am){
  if(!am||!am.all||!am.all.length)return '';
  const H=['<h2>13.4.3／13.4.4 放大地震力下的附帶判定</h2>'];
  H.push('<div>柱 <b>'+am.all.length+'</b> 支　其中箱型柱 <b>'+am.box.length+'</b> 支</div>');
  H.push('<h3 style="margin:12px 0 4px;font-size:.9rem">13.4.4　有效長度係數 K 得取 1.0 之條件</h3>');
  H.push('<div>條件 b（Pu ≤ 0.4·Py）：<b class="'+(am.c44Ok===am.all.length?'ok':'ng')+'">'+
    am.c44Ok+'</b>/'+am.all.length+' 支滿足</div>');
  H.push('<div class="rpt-note"><b>條件 a「柱在兩端為連續或接頭均為剛性接合」無法由 s2k 判定，'+
    '須人工確認</b>。兩條件都滿足時，檢核放大地震力下之軸向強度才可取 K=1.0；'+
    '本模組的 K 由使用者輸入（目前為 '+(memResult?memResult.K:1)+'），此處僅提供條件 b 的判定。</div>');
  if(am.box.length){
    H.push('<h3 style="margin:12px 0 4px;font-size:.9rem">13.4.3　銲接組合箱型柱之銲接型式</h3>');
    H.push('<div>Pu ≤ 0.8·φcPn：<b class="'+(am.box43Ok===am.box.length?'ok':'ng')+'">'+
      am.box43Ok+'</b>/'+am.box.length+' 支滿足 → 該些柱之相鄰柱板得採部分滲透銲</div>');
    H.push('<div class="rpt-note">即使滿足，<b>梁柱接頭區及其上下方各一倍柱寬範圍內仍須全滲透銲</b>，'+
      '且<b>含柱續接樓層之柱應全長採全滲透銲</b>——此二者為構造規定，非本表可判定。</div>');
    H.push(rptTable(['Frame','斷面','Pu (tf)','φcPn (tf)','0.8·φcPn','Pu/0.8φcPn','Py (tf)',
                     '0.4·Py','Pu/0.4Py','13.4.3','13.4.4b'],
      am.box.slice(0,60).map(x=>[x.obj,x.sect,
        (x.amCu||0).toFixed(2),x.Pnc.toFixed(2),(0.8*x.Pnc).toFixed(2),
        Number.isFinite(x.am43)?x.am43.toFixed(3):'—',
        (x.amPy||0).toFixed(2),(0.4*(x.amPy||0)).toFixed(2),
        Number.isFinite(x.am44)?x.am44.toFixed(3):'—',
        x.am43<=1?'可用 PJP':'須 CJP', x.am44<=1?'符合':'不符'])));
    if(am.box.length>60)H.push('<div class="rpt-note">僅列前 60 支箱型柱，共 '+am.box.length+' 支。</div>');
  }else{
    H.push('<div class="rpt-note">本案無箱型柱（斷面名稱不含 BOX），13.4.3 不適用。</div>');
  }
  return H.join('\n');
}
function calcRenderSl(){
  const r=slResult;
  if(!r)return '<h2>7.3.2a 構材細長比</h2>'+rptNone('模組尚未執行');
  return '<h2>7.3.2a 構材細長比</h2>'+
    '<div>檢核 <b>'+r.total+'</b> 支・超限 <b class="'+(r.ng?'ng':'ok')+'">'+r.ng+'</b> 支　'+
    'K='+r.K+'、受壓限值 '+r.limC+'、斜撐限值 '+r.limT+'</div>'+
    '<div class="rpt-note">rmin = √(Imin/A)；<b>L 取構材全長</b>——實際有效長度通常較短，'+
    '超限數量應視為上限。</div>'+
    rptTable(['Frame','斷面','型式','L (m)','rmin (cm)','KL/r','限值','判定'],
      r.rows.map(x=>[x.id,x.sect,x.kind,x.L.toFixed(2),x.rmin.toFixed(2),x.kl.toFixed(1),x.lim,rptFlag(x.ok)]));
}
function calcRenderDrift(){
  const r=driftResult;
  if(!r)return '<h2>6.7 層間位移檢核</h2>'+rptNone('模組尚未執行');
  const H=['<h2>6.7 層間相對側向位移檢核</h2>'];
  H.push(cbSec('1. 一般設計資訊'));
  H.push(cbKV([
    ['設計規範','建築物耐震設計規範及解說'],
    ['模型來源',rptEsc(currentS2KFileName||'—')],
    ['位移來源','Joint Displacements（U1／U2）'],
    ['檢核對象',r.srcMode==='case'?'原始 Load Case':'載重組合'],
    ['檢核數量',r.combos+' 組 × '+r.lines+' 條柱線 = '+r.checked+' 次比對'],
    ['位移放大倍數 α',String(r.amp)]
  ]));
  H.push(cbSec('2. 檢核式'));
  H.push(cbF('','Δ<sub>i</sub> = α · | u<sub>i</sub> − u<sub>i−1</sub> |　（逐柱線、逐方向）',
    'u 取該柱線在各樓層之水平位移；α 為位移放大倍數。'));
  H.push(cbF('','θ<sub>i</sub> = Δ<sub>i</sub> / h<sub>i</sub> ≤ '+r.limit,
    '最大值 <b>'+r.worst.ratio.toFixed(5)+'</b>（'+rptEsc(r.worst.combo)+'）　'+
    cbBadge(r.worst.ratio<=r.limit)));
  H.push(cbNote('<b>逐柱線</b>計算而非取樓層平均——扭轉效應下不同柱線的層間位移可能差異甚大，'+
    '取平均會低估角隅柱線。附件D 之送審格式為<b>逐 Load Case</b>（EXP／EXN／EYP／EYN），'+
    '本模組可切換「檢核對象」以對齊。'));
  H.push(cbSec('3. 逐樓層結果'));
  H.push(rptTable(['樓層 z (m)','h (m)','Δ/h','控制組合','方向','柱線','判定'],
    r.levels.map(x=>[x.zLo.toFixed(2)+' → '+x.zHi.toFixed(2),x.h.toFixed(2),x.ratio.toFixed(5),
      x.combo,x.dir,x.line,cbBadge(x.ratio<=r.limit)])));
  H.push(cbSec('4. 控制樓層詳細計算'));
  H.push(rptDriftDetail(r));
  H.push(cbRefs([
    ['層間相對側向位移角限值','建築物耐震設計規範及解說','第二章（θ ≤ '+r.limit+'）'],
    ['位移放大倍數','建築物耐震設計規範及解說','依結構系統與分析法採用'],
    ['送審格式（逐 Load Case）','PR B 附件D','梁桿件位移／層間位移檢核表']
  ]));
  return H.join('\n');
}
function calcRenderBp(){
  const r=bpResult;
  if(!r)return '<h2>7.1.2／7.1.3 柱基版與錨栓設計</h2>'+rptNone('模組尚未執行');
  const gov=r.rows.reduce((a,b)=>!a||b.worst>a.worst?b:a,null);
  const ci=bpComboInfo,cb=bpCbf;
  const n=(v,d)=>Number.isFinite(v)?v.toFixed(d):'—';
  const H=['<h2>7.1.2／7.1.3 柱基版與錨栓設計</h2>'];
  H.push(cbSec('1. 一般設計資訊'));
  H.push(cbKV([
    ['設計規範','AISC Design Guide 1（基版）／ACI 318-19 第 17 章（錨栓）'],
    ['模型來源',rptEsc(currentS2KFileName||'—')],
    ['內力來源','Joint Reactions（全域軸）'],
    ['載重組合',ci?ci.used+' 組'+(ci.scope==='strength'?'（SteelDesign=Strength）':'（全部）'):'—'],
    ['設計內力',ci&&ci.forceMode!=='strength'?'強度包絡與 13.4.5 放大地震力取大':'僅強度組合包絡'],
    ['柱腳數',String(r.rows.length)]
  ]));
  H.push(cbSec('2. 材料與斷面'));
  H.push(cbKV([
    ['基版 Fy',r.Fy+' kgf/cm²'],['基礎 f′c',r.fc+' kgf/cm²'],
    ['基版尺寸',r.B+' × '+r.N+' × '+r.t+' mm'],['√(A₂/A₁)',String(r.a2a1)],
    ['錨栓',r.n+'-M'+r.dnom+'（扣牙後 d='+n(r.dEff,1)+' mm）'],['Ase',n(r.Ase,2)+' mm²'],
    ['錨栓 futa',r.futa+' MPa'],['φ（剪力／拉力）',String(r.phi)]
  ]));
  H.push(cbSec('3. 混凝土承壓與基版厚度'));
  H.push(cbF('DG1 (3.1)','f<sub>p,max</sub> = φ<sub>c</sub> · 0.85 · f′<sub>c</sub> · √(A₂/A₁) ≤ φ<sub>c</sub> · 1.7 f′<sub>c</sub>',
    'φ<sub>c</sub> = 0.65　→　f<sub>p,max</sub> = '+n(r.fpCap,1)+' kgf/cm²'));
  H.push(cbF('DG1 (3.3)','m = (N − 0.95d)/2、n = (B − 0.8b<sub>f</sub>)/2、ℓ = max(m, n)'));
  H.push(cbF('DG1 (3.3.14a)','t<sub>req</sub> = ℓ · √( 2P<sub>u</sub> / (0.9 F<sub>y</sub> B N) )'));
  H.push(cbNote('本模組採 <b>AISC DG1 的懸臂板法</b>。附件E 之 midas Design+ 則是'+
    '以基版有限元的彎矩圖取平均值（M<sub>ux</sub>／M<sub>uy</sub>）再驗 φM<sub>n</sub> = F<sub>y</sub>·t²/4。'+
    '兩者皆為業界作法但**取值方式不同**，比對時勿直接對數字。'));
  H.push(cbSec('4. 錨栓強度'));
  H.push(cbF('ACI §17.7.1','N<sub>sa</sub> = n · A<sub>se,N</sub> · f<sub>uta</sub>　（f<sub>uta</sub> ≤ min(f<sub>uta</sub>, 1.9f<sub>ya</sub>, 860 MPa)）',
    'φN<sub>sa</sub> = '+n(r.phiNn,2)+' kN'));
  H.push(cbF('ACI §17.7.2','V<sub>sa</sub> = n · 0.6 · A<sub>se,V</sub> · f<sub>uta</sub>',
    'φV<sub>sa</sub> = '+n(r.phiVn,2)+' kN'));
  if(r.cbfOn&&cb){
    H.push(cbSec('5. 混凝土破壞模式'));
    H.push(cbF('ACI §17.6.2','N<sub>cbg</sub> = (A<sub>Nc</sub>/A<sub>Nco</sub>) · ψ<sub>ec,N</sub> ψ<sub>ed,N</sub> ψ<sub>c,N</sub> ψ<sub>cp,N</sub> · N<sub>b</sub>',
      'N<sub>b</sub> = k<sub>c</sub> λ<sub>a</sub> √f′<sub>c</sub> h<sub>ef</sub><sup>1.5</sup> = '+n(cb.Nb/9.80665,2)+' tf'+
      '　A<sub>Nc</sub>/A<sub>Nco</sub> = '+n(cb.ANc/cb.ANco,3)+'　ψ<sub>ed,N</sub> = '+n(cb.psiEd,3)+
      '　→　φN<sub>cbg</sub> = '+n(0.75*cb.NcbgKN/9.80665,2)+' tf'));
    H.push(cbF('ACI §17.6.2.1.2','h′<sub>ef</sub> = max( c<sub>a,max</sub>/1.5 , s<sub>max</sub>/3 ) = '+n(cb.hefUse,1)+' mm'));
    H.push(cbF('ACI §17.6.3','N<sub>pn</sub> = ψ<sub>c,P</sub> · 8 · A<sub>brg</sub> · f′<sub>c</sub>',
      'A<sub>brg</sub> = '+n(cb.Abrg,0)+' mm²　→　φN<sub>pn</sub> = '+n(0.75*cb.NpnKN/9.80665,2)+' tf'));
    H.push(cbF('ACI §17.6.4','N<sub>sbg</sub> = (1 + s/6c<sub>a1</sub>) · 13 c<sub>a1</sub> √A<sub>brg</sub> λ<sub>a</sub> √f′<sub>c</sub>',
      cb.needSb?'φN<sub>sbg</sub> = '+n(0.75*cb.NsbgKN/9.80665,2)+' tf':'c<sub>a1</sub> ≥ 0.4h<sub>ef</sub>，本項不控制'));
    H.push(cbF('ACI §17.7.2','V<sub>cbg</sub> = (A<sub>Vc</sub>/A<sub>Vco</sub>) ψ<sub>ec,V</sub> ψ<sub>ed,V</sub> ψ<sub>c,V</sub> ψ<sub>h,V</sub> · V<sub>b</sub>',
      'V<sub>b</sub> = 0.6(ℓ<sub>e</sub>/d<sub>a</sub>)<sup>0.2</sup>√d<sub>a</sub> λ<sub>a</sub> √f′<sub>c</sub> c<sub>a1</sub><sup>1.5</sup> = '+
      n(cb.VbKN/9.80665,2)+' tf　→　φV<sub>cbg</sub> = '+n(0.70*cb.VcbgKN/9.80665,2)+' tf'));
    H.push(cbF('ACI §17.7.3','V<sub>cpg</sub> = k<sub>cp</sub> · N<sub>cbg</sub>（k<sub>cp</sub>=2.0）',
      'φV<sub>cpg</sub> = '+n(0.70*cb.VcpgKN/9.80665,2)+' tf'));
    H.push(cbF('ACI §17.8.3','N<sub>ua</sub>/(φN<sub>n</sub>) + V<sub>ua</sub>/(φV<sub>n</sub>) ≤ 1.2'));
    H.push(cbNote('ℓ<sub>e</sub> 取<b>實際埋深</b>（非 §17.6.2.1.2 折減後的 h′<sub>ef</sub>）；'+
      'h′<sub>ef</sub> 用 <b>c<sub>a,max</sub></b> 與 <b>s<sub>max</sub></b>，而投影面積 A<sub>Nc</sub>／A<sub>Vc</sub> 用 <b>s<sub>min</sub></b>。'+
      '此三點以附件E（midas Design+）之 BP-02 逐位反推確認：φN<sub>cbg</sub> 7.79 vs 7.785、'+
      'φN<sub>pn</sub> 39.70 vs 39.705、V<sub>cbg</sub> 6.486 vs 6.483、V<sub>cpg</sub> 20.77 vs 20.77。'));
    H.push(cbNote('簡化：群錨拉力取該柱腳淨上拔 T<sub>u</sub>，受拉側支數由使用者給定（'+cb.nT+' 支）；'+
      '偏心 ψ<sub>ec,N</sub> 取 1；剪力平行邊緣的 V<sub>cbg</sub>×2（§17.7.2.1(c)）未套用。',true));
  }
  if(r.arOn){
    H.push(cbSec((r.cbfOn?'6':'5')+'. 錨定補強（取代混凝土錐體破壞）'));
    H.push(cbF('ACI §17.5.2.1','T<sub>bar</sub> = n · φ<sub>s</sub> f<sub>y</sub> A<sub>s</sub> · F<sub>redu</sub>、F<sub>redu</sub> = min(1, L<sub>d,avail</sub>/L<sub>d</sub>)',
      'T<sub>bar</sub> = '+n(r.Tbar,2)+' kN　T<sub>tie</sub> = '+n(r.Ttie,2)+' kN'));
  }
  H.push(cbSec((r.cbfOn?(r.arOn?'7':'6'):(r.arOn?'6':'5'))+'. 逐柱腳檢核結果'));
  H.push(
    '<div>基版 '+r.B+'×'+r.N+'×'+r.t+' mm・錨栓 '+r.n+'-M'+r.dnom+
    '・φVn='+r.phiVn.toFixed(2)+' kN・φNn='+r.phiNn.toFixed(2)+' kN'+
    (r.arOn?'・Tbar='+r.Tbar.toFixed(2)+' kN・Ttie='+r.Ttie.toFixed(2)+' kN':'')+'</div>'+
    rptTable(['柱腳','斷面','Pu (tf)','Pu 來源','Vu (tf)','Tu (tf)','Tu 來源','承壓比','板厚比','剪力比','拉力比','互制','主筋比','箍筋比','判定'],
      r.rows.map(x=>{const f=v=>v!==null&&Number.isFinite(v)?v.toFixed(3):'—';
        return ['J'+x.joint,x.col?.sect||'—',x.Pu.toFixed(2),(x.PuCombo||'—'),x.Vu.toFixed(2),x.Tu.toFixed(2),(x.TuCombo||'—'),
          f(x.brg),f(x.tRatio),f(x.vR),f(x.tR),f(x.inter),f(x.arT),f(x.arV),cbBadge(x.ok)]})));
  H.push(cbSec('控制柱腳 J'+(gov?gov.joint:'—')+' 詳細計算'));
  H.push(rptBpDetail(gov,r));
  H.push(cbRefs([
    ['混凝土承壓 f<sub>p,max</sub>','AISC Design Guide 1','式 (3.1)'],
    ['基版厚度 t<sub>req</sub>','AISC Design Guide 1','式 (3.3.14a)'],
    ['錨栓鋼材受拉 N<sub>sa</sub>','ACI 318-19','§17.7.1'],
    ['錨栓鋼材受剪 V<sub>sa</sub>','ACI 318-19','§17.7.2'],
    ['混凝土錐體受拉 N<sub>cbg</sub>','ACI 318-19','§17.6.2'],
    ['拔出 N<sub>pn</sub>','ACI 318-19','§17.6.3'],
    ['側面爆出 N<sub>sbg</sub>','ACI 318-19','§17.6.4'],
    ['混凝土錐體受剪 V<sub>cbg</sub>','ACI 318-19','§17.7.2'],
    ['撬破 V<sub>cpg</sub>','ACI 318-19','§17.7.3'],
    ['拉剪互制','ACI 318-19','§17.8.3'],
    ['錨定補強','ACI 318-19','§17.5.2.1'],
    ['柱基放大地震力','鋼結構極限設計法','13.4.5（載重依 13.4.1）']
  ]));
  return H.join('\n');
}
function calcRenderSpl(){
  const r=splResult;
  const isCol=r&&r.type==='col';
  const ttl='<h2>7.2.2／7.1.4 '+(isCol?'柱續接接合設計':'梁續接接合設計')+'</h2>';
  if(!r)return '<h2>7.2.2 續接接合設計</h2>'+rptNone('模組尚未執行');
  const n=(v,d)=>Number.isFinite(v)?v.toFixed(d):'—';
  const pick=r.dem&&r.dem.pick;
  const H=[ttl];
  H.push(cbSec('1. 一般設計資訊'));
  H.push(cbKV([
    ['設計規範','鋼結構極限設計法／AISC 360'],
    ['模型來源',rptEsc(currentS2KFileName||'—')],
    ['斷面位置',pick?rptEsc(pick.resultId+' @ '+pick.station.toFixed(3)+' m'):'—'],
    ['斷面尺寸','d='+n(r.d,1)+'・b<sub>f</sub>='+n(r.bf,1)+'・t<sub>f</sub>='+n(r.tf,1)+'・t<sub>w</sub>='+n(r.tw,1)+' cm'],
    ['內力來源','Element Forces－Frames（局部軸）'],
    ['接合型式',r.mode==='slip'?'摩阻型（滑動臨界）':'承壓型'],
    ['設計內力來源',r.src==='max'?'實際包絡與規範下限取大':(r.src==='actual'?'僅實際包絡':'僅規範下限')],
    ['螺栓','d<sub>b</sub>='+n(r.db,1)+' cm・翼板 '+r.nf+' 支・腹板 '+r.nw+' 支']
  ]));
  H.push(cbSec('2. 設計內力'));
  H.push(cbKV([
    ['實際包絡 P',n(r.Pact,2)+' tf'],['實際包絡 M',n(r.Mact,2)+' tf·m'],
    ['規範下限 P',n(r.Pmin,2)+' tf'],['規範下限 M',n(r.Mmin,2)+' tf·m'],
    ['採用 P<sub>u</sub>',n(r.Pu,2)+' tf'],['採用 M<sub>u</sub>',n(r.Mu,2)+' tf·m'],
    ['採用 V<sub>u</sub>',n(r.Vu,2)+' tf'],['翼板力 F<sub>f</sub>',n(r.Ff,2)+' tf'],
    ['腹板剪力 V<sub>w</sub>',n(r.Vw,2)+' tf'],['力臂 arm',n(r.arm,3)+' m（= (d − t<sub>f</sub>)/100）']
  ]));
  H.push(cbF('','F<sub>f</sub> = M<sub>u</sub> / arm + P<sub>u</sub> · A<sub>f</sub>/A<sub>g</sub>',
    '以翼板承擔彎矩、軸力依面積比分配。arm = (d − t<sub>f</sub>) = '+n(r.arm,3)+' m；'+
    'A<sub>f</sub>/A<sub>g</sub> = '+n(r.Af,2)+'/'+n(r.Ag,2)+' = '+n(r.Ag>0?r.Af/r.Ag:NaN,3)+
    '（軸力項僅柱續接計入）。'));
  H.push(cbNote('<b>設計內力採「實際內力包絡」與「規範下限」取大</b>。'+
    '13.4.2 規定柱續接處須有足夠強度抵抗 13.4.1 之軸力，且續接位置'+
    '須離梁翼板 1.2 m 以上或位於 1/2 柱淨高處——<b>位置規定屬構造要求，本表不判定</b>。'));
  H.push(cbSec('3. 各項強度檢核'));
  H.push(cbF('AISC J3.8','摩阻型：φR<sub>n</sub> = φ · 1.13 · μ · T<sub>b</sub> · N<sub>s</sub> · n<sub>b</sub>'));
  H.push(cbF('AISC J3.10','承壓型：φR<sub>n</sub> = φ · min(1.2 L<sub>c</sub> t F<sub>u</sub>, 2.4 d<sub>b</sub> t F<sub>u</sub>)'));
  H.push(cbF('AISC D2','淨斷面斷裂：φR<sub>n</sub> = φ · F<sub>u</sub> · A<sub>e</sub>'));
  H.push(cbF('AISC J4.3','塊狀撕裂：φR<sub>n</sub> = φ · (0.6F<sub>u</sub>A<sub>nv</sub> + U<sub>bs</sub>F<sub>u</sub>A<sub>nt</sub>) ≤ φ(0.6F<sub>y</sub>A<sub>gv</sub> + U<sub>bs</sub>F<sub>u</sub>A<sub>nt</sub>)'));
  H.push(rptTable(['檢核項目','需求','強度','比值','判定'],
    r.rows.map(x=>[x.item,Number.isFinite(x.dem)?x.dem.toFixed(2):'—',
      Number.isFinite(x.cap)?x.cap.toFixed(2):'—',
      x.r!==null&&Number.isFinite(x.r)?x.r.toFixed(3):'—',
      x.r===null||!Number.isFinite(x.r)?'<span class="rpt-none">n/a</span>':cbBadge(x.r<=1)])));
  H.push(cbSec('4. 詳細計算'));
  H.push(rptSplDetail(r));
  H.push(cbRefs([
    ['摩阻型滑動強度','AISC 360','J3.8'],
    ['螺栓承壓強度','AISC 360','J3.10'],
    ['淨斷面斷裂','AISC 360','D2'],
    ['塊狀撕裂','AISC 360','J4.3'],
    ['柱續接軸力要求','鋼結構極限設計法','13.4.2（軸力依 13.4.1）'],
    ['續接位置與銲接型式','鋼結構極限設計法','13.4.2（構造規定，本表不判定）']
  ]));
  return H.join('\n');
}
function calcRenderMod(){
  const r=modResult;
  if(!r)return '<h2>6.1 自然頻率與基本震動週期</h2>'+rptNone('尚未載入 Modal 資料');
  const rows=r.rows,last=rows[rows.length-1];
  const pick=k=>rows.reduce((a,b)=>(b[k]??0)>(a?.[k]??-1)?b:a,null);
  const bx=pick('UX'),by=pick('UY');
  return '<h2>6.1 自然頻率與基本震動週期</h2>'+
    '<div>共 '+rows.length+' 個模態・T₁ = <b>'+rows[0].T.toFixed(4)+'</b> s'+
    (bx?'　X 向主控 '+rptEsc(bx.mode)+'（T='+bx.T.toFixed(4)+' s、UX '+(bx.UX*100).toFixed(1)+'%）':'')+
    (by?'　Y 向主控 '+rptEsc(by.mode)+'（T='+by.T.toFixed(4)+' s、UY '+(by.UY*100).toFixed(1)+'%）':'')+'</div>'+
    '<div class="rpt-note">來源：'+rptEsc(r.fileName)+'　累積有效質量 ΣUX '+
    ((last.SumUX??0)*100).toFixed(1)+'%、ΣUY '+((last.SumUY??0)*100).toFixed(1)+'%（規範一般要求 ≥ 90%）。</div>'+
    rptTable(['模態','T (s)','UX','UY','UZ','ΣUX','ΣUY'],
      rows.map(x=>{const g=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(4);
        return [x.mode,x.T.toFixed(4),g(x.UX),g(x.UY),g(x.UZ),g(x.SumUX),g(x.SumUY)]}));
}
const CALC_RENDER={mem:calcRenderMem,sl:calcRenderSl,drift:calcRenderDrift,
                   bp:calcRenderBp,spl:calcRenderSpl,mod:calcRenderMod};
function renderCalcTabs(){
  const bar=$('calc-tabs');if(!bar)return;
  bar.innerHTML=CALC_TABS.map(t=>'<button data-ct="'+t.id+'"'+(t.id===calcTab?' class="on"':'')+'>'+
    v300Esc(t.name)+'</button>').join('');
  bar.querySelectorAll('[data-ct]').forEach(b=>b.addEventListener('click',()=>{
    calcTab=b.dataset.ct;renderCalcTabs();calcMountCard(calcTab);renderCalcBody();
  }));
}
/* ══ V4.15.0：把該模組的側欄卡片搬進工作區 ══
   目標是讓原生模組的工作區與基礎／地震力／風力／PM 這些 iframe 模組一樣好用——
   後者之所以順手，關鍵在**參數就在工作區裡**，改完立刻看到結果。
   作法：不複製 DOM（會產生重複 id），而是把整張 .card **移動**過去，
   關閉或切換分頁時再放回原位（以隱藏的佔位節點記住位置）。 */
const CALC_CARD={mem:'mem-card',sl:'sl-card',drift:'drift-card',
                 bp:'bp-card',spl:'spl-card',mod:'mod-card'};
const calcCardHome=new Map();
function calcRestoreCards(){
  for(const [id,ph] of calcCardHome){
    const c=$(id);
    if(c&&ph.parentNode&&c.parentNode!==ph.parentNode)ph.parentNode.insertBefore(c,ph);
  }
}
function calcMountCard(tab){
  const side=$('calc-side');if(!side)return;
  calcRestoreCards();
  const id=CALC_CARD[tab];if(!id)return;
  const card=$(id);if(!card)return;
  if(!calcCardHome.has(id)){
    const ph=document.createElement('div');
    ph.className='calc-card-home';ph.style.display='none';
    card.parentNode.insertBefore(ph,card);
    calcCardHome.set(id,ph);
  }
  side.appendChild(card);
}
/* 在工作區內按執行／改參數後，右側結果自動重繪（延後一拍等模組算完） */
function calcBindSideRefresh(){
  const side=$('calc-side');if(!side||side.dataset.bound)return;
  side.dataset.bound='1';
  const kick=()=>setTimeout(()=>{try{renderCalcBody()}catch(e){console.error(e)}},0);
  side.addEventListener('click',e=>{if(e.target.closest('button'))kick()});
  side.addEventListener('change',kick);
}
function renderCalcBody(){
  const body=$('calc-body');if(!body)return;
  const fn=CALC_RENDER[calcTab];
  body.innerHTML=fn?fn():'';
  body.scrollTop=0;
  const st=$('calc-status');
  if(st)st.textContent=(CALC_TABS.find(t=>t.id===calcTab)?.name||'')+
    '　'+(currentS2KFileName||'—');
}
function openCalcWorkspace(tab){
  if(tab)calcTab=tab;
  const ws=$('calc-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  renderCalcTabs();calcMountCard(calcTab);calcBindSideRefresh();renderCalcBody();
}
document.querySelectorAll('[data-calc-ws]').forEach(b=>
  b.addEventListener('click',()=>openCalcWorkspace(b.dataset.calcWs)));
$('btn-calc-back').addEventListener('click',()=>{
  const ws=$('calc-workspace');ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
  calcRestoreCards();          /* 卡片必須放回側欄，否則關掉工作區就找不到參數了 */
});
/* ==== V4.15.0 工作區匯出 Excel ====
   使用者的計算書流程是「Excel 截圖貼進 Word」，故各模組的完整表格需可直接匯出。
   直接把已渲染的 <table> 轉成工作表，確保匯出內容與畫面一致（不另做一套資料組裝）。 */
function calcSafeSheetName(x){
  return String(x||'Sheet').replace(/[\\/?*\[\]:]/g,'-').slice(0,31);
}
function calcTablesToSheets(wb,html,label){
  const tmp=document.createElement('div');
  tmp.style.cssText='position:absolute;left:-99999px;top:0';
  tmp.innerHTML=html;
  document.body.appendChild(tmp);
  let n=0;
  try{
    const tables=tmp.querySelectorAll('table');
    tables.forEach((tb,i)=>{
      try{
        const ws=XLSX.utils.table_to_sheet(tb,{raw:false});
        XLSX.utils.book_append_sheet(wb,ws,calcSafeSheetName(label+(tables.length>1?'-'+(i+1):'')));
        n++;
      }catch(e){console.error(e)}
    });
  }finally{document.body.removeChild(tmp)}
  return n;
}
function calcExportOne(){
  const tab=CALC_TABS.find(t=>t.id===calcTab);
  const html=$('calc-body').innerHTML;
  if(!html.trim()){alert('本頁沒有可匯出的內容。');return}
  const wb=XLSX.utils.book_new();
  const n=calcTablesToSheets(wb,html,tab?.name||'結果');
  if(!n){alert('本頁沒有表格可匯出（模組可能尚未執行）。');return}
  const base=String(currentS2KFileName||'model').replace(/\.(s2k|\$2k|txt)$/i,'');
  XLSX.writeFile(wb,base+'_'+(tab?.name||'結果')+'.xlsx');
  $('calc-status').textContent='已匯出 '+n+' 張工作表';
}
function calcExportAll(){
  const wb=XLSX.utils.book_new();
  let total=0;
  for(const t of CALC_TABS){
    const fn=CALC_RENDER[t.id];
    if(!fn)continue;
    let html='';
    try{html=fn()}catch(e){console.error(e);continue}
    if(!html||/rpt-none/.test(html)&&!/<table/.test(html))continue;
    total+=calcTablesToSheets(wb,html,t.name);
  }
  if(!total){alert('沒有任何模組已執行，無可匯出的表格。');return}
  const base=String(currentS2KFileName||'model').replace(/\.(s2k|\$2k|txt)$/i,'');
  XLSX.writeFile(wb,base+'_全部檢核結果.xlsx');
  $('calc-status').textContent='已匯出 '+total+' 張工作表（全部模組）';
}
$('btn-calc-xls').addEventListener('click',calcExportOne);
$('btn-calc-xls-all').addEventListener('click',calcExportAll);
$('btn-calc-print').addEventListener('click',()=>{
  const body=$('calc-body');if(!body)return;
  const rb=$('rpt-body'),keep=rb.innerHTML;
  rb.innerHTML=body.innerHTML;
  const rw=$('rpt-workspace');const was=rw.classList.contains('on');
  rw.classList.add('on');window.print();
  if(!was)rw.classList.remove('on');
  rb.innerHTML=keep;
});
function openReport(){
  const ws=$('rpt-workspace');
  $('rpt-body').innerHTML=buildReport();
  $('rpt-status').textContent='已產生（'+new Date().toLocaleTimeString()+'）';
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
}
$('btn-rpt').addEventListener('click',()=>openReport());
$('btn-rpt-back').addEventListener('click',()=>{const ws=$('rpt-workspace');ws.classList.remove('on');ws.setAttribute('aria-hidden','true')});
$('btn-rpt-print').addEventListener('click',()=>window.print());
$('btn-rpt-rebuild').addEventListener('click',()=>{
  $('rpt-body').innerHTML=buildReport();
  $('rpt-status').textContent='已重新產生（'+new Date().toLocaleTimeString()+'）';
});
$('rpt-full').addEventListener('change',()=>{
  $('rpt-body').innerHTML=buildReport();
  $('rpt-status').textContent=($('rpt-full').checked?'完整版':'摘要版')+'（'+new Date().toLocaleTimeString()+'）';
});

/* ==== V4.15.0 與 SAP2000 Steel Design 結果比對 ====
   目的：本模組的 K、Lb、Cb 是使用者假設；SAP 用的是模型內的有效長度與 Overwrites。
   匯入 SAP 自己的設計表並列，可看出假設造成的差距（PR B 實測：梁的比值可差近一個數量級）。 */
let memSap=null;
function memSapNorm(x){return String(x??'').trim().toLowerCase().replace(/[\s_()]/g,'')}
function memSapFromMatrix(aoa){
  let hi=-1,map={};
  for(let i=0;i<Math.min(30,aoa.length);i++){
    const h=(aoa[i]||[]).map(memSapNorm);
    const f=(...names)=>h.findIndex(x=>names.includes(x));
    const m={frame:f('frame','framename'),sect:f('designsect','section','analsect'),
      type:f('designtype','type'),combo:f('combo','combono','outputcase'),
      loc:f('location','station'),pu:f('pu','p'),mu:f('mumajor','m3','mmajor'),
      ratio:f('totalratio','ratio'),eq:f('equation','eqn')};
    if(m.frame>=0&&m.ratio>=0){hi=i;map=m;break}
  }
  if(hi<0)return null;
  const out=[];
  for(const r of aoa.slice(hi+1)){
    const fid=String(r?.[map.frame]??'').trim();
    const rt=Number(r?.[map.ratio]);
    if(!fid||!Number.isFinite(rt))continue;
    if(/^(text|frame|unitless)$/i.test(fid))continue;
    out.push({frame:fid,sect:map.sect>=0?String(r[map.sect]??''):'',
      type:map.type>=0?String(r[map.type]??''):'',
      combo:map.combo>=0?String(r[map.combo]??''):'',
      loc:map.loc>=0?Number(r[map.loc]):null,
      Pu:map.pu>=0?Number(r[map.pu]):null,Mu:map.mu>=0?Number(r[map.mu]):null,
      eq:map.eq>=0?String(r[map.eq]??''):'',ratio:rt});
  }
  return out.length?out:null;
}
async function memSapImport(file){
  const st=$('mem-sap-status');
  st.textContent='正在讀取…';
  try{
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    let rows=null;
    if(ext==='xlsx'||ext==='xls'){
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
      for(const sn of wb.SheetNames){
        const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''});
        rows=memSapFromMatrix(aoa);
        if(rows)break;
      }
    }else{
      const text=await file.text();
      const T=parseS2K(text);
      const key=Object.keys(T).find(k=>/STEEL DESIGN|DESIGN.*SUMMARY|PMM/i.test(k));
      if(key){
        rows=(T[key]||[]).map(r=>({frame:String(r.Frame??''),sect:String(r.DesignSect??''),
          type:String(r.DesignType??''),combo:String(r.Combo??''),loc:v300Num(r.Location),
          Pu:v300Num(r.Pu),Mu:v300Num(r.MuMajor),eq:String(r.Equation??''),
          ratio:Number(r.TotalRatio)})).filter(x=>x.frame&&Number.isFinite(x.ratio));
        if(!rows.length)rows=null;
      }
      if(!rows){
        const lines=text.split(/\r?\n/).filter(Boolean),sep=lines[0]?.includes('\t')?'\t':',';
        rows=memSapFromMatrix(lines.map(l=>l.split(sep).map(x=>x.replace(/^"|"$/g,'').trim())));
      }
    }
    if(!rows)throw new Error('找不到 Frame 與 TotalRatio 欄位');
    /* 同一 Frame 取比值最大者 */
    const best=new Map();
    for(const r of rows){
      const cur=best.get(r.frame);
      if(!cur||r.ratio>cur.ratio)best.set(r.frame,r);
    }
    memSap={fileName:file.name,rows:[...best.values()],raw:rows.length};
    st.textContent='已匯入 '+file.name+'：'+rows.length+' 列、'+best.size+' 支桿件';
    renderMemCompare();
  }catch(err){
    memSap=null;st.textContent='匯入失敗：'+String(err?.message||err);
    $('mem-cmp').style.display='none';
  }
}
function renderMemCompare(){
  const box=$('mem-cmp');if(!box)return;
  if(!memSap){box.style.display='none';return}
  if(!memResult){box.style.display='';box.textContent='已匯入 SAP 結果，請先執行本模組的檢核再比對。';return}
  const mine=new Map(memResult.rows.map(r=>[String(r.obj),r]));
  const rows=[];let both=0,sumR=0,maxR=0,maxF='';
  for(const sp of memSap.rows){
    const m=mine.get(String(sp.frame));
    if(!m)continue;
    both++;
    const ratio=sp.ratio>0?m.gov/sp.ratio:Infinity;
    if(Number.isFinite(ratio)){sumR+=ratio;if(ratio>maxR){maxR=ratio;maxF=sp.frame}}
    rows.push({frame:sp.frame,sect:sp.sect||m.sect,type:sp.type,sap:sp.ratio,mine:m.gov,ratio});
  }
  if(!both){box.style.display='';box.textContent='SAP 結果與目前模型的 Frame 編號對不上，無法比對。';return}
  rows.sort((a,b)=>b.ratio-a.ratio);
  const avg=sumR/both;
  box.style.display='';
  box.innerHTML='比對 '+both+' 支　本模組/SAP 比值：平均 '+avg.toFixed(2)+'　最大 '+maxR.toFixed(2)+
    '（Frame '+maxF+'）\n'+
    (avg>1.5?'⚠ 本模組明顯保守——多半是 K、Lb 假設過大（SAP 用模型內的有效長度）。\n':'')+
    'Frame  斷面              類型    SAP     本模組   倍率\n'+
    rows.slice(0,20).map(x=>String(x.frame).padEnd(7)+String(x.sect||'—').padEnd(18)+
      String(x.type||'—').padEnd(8)+
      x.sap.toFixed(4).padStart(7)+x.mine.toFixed(4).padStart(9)+
      (Number.isFinite(x.ratio)?x.ratio.toFixed(2):'—').padStart(7)).join('\n')+
    (rows.length>20?'\n…（僅列倍率最大的 20 支，共 '+rows.length+' 支）':'');
}
$('btn-mem-sap').addEventListener('click',()=>$('mem-sap-file').click());
$('mem-sap-file').addEventListener('change',e=>{
  const f=e.target.files?.[0];if(f)memSapImport(f);e.target.value='';
});
const memSapBaseStart=startApp;
startApp=function(...a){memSap=null;const st=$('mem-sap-status');if(st)st.textContent='尚未匯入';
  const c=$('mem-cmp');if(c)c.style.display='none';return memSapBaseStart.apply(this,a)};

/* ==== V4.15.0 自然頻率（計算書 6.1）====
   資料來源：analysis results 若含 Modal 表則直接讀；否則由使用者匯入
   （PR B 的 Modal 在單獨的「6.1 自然頻率與基本震動週期.xlsx」）。 */
let modResult=null,modNote='';
function modNorm(x){return String(x??'').trim().toLowerCase().replace(/[\s_()]/g,'')}
function modFromMatrix(aoa){
  let hi=-1,m={};
  for(let i=0;i<Math.min(30,aoa.length);i++){
    const h=(aoa[i]||[]).map(modNorm);
    const f=(...n)=>h.findIndex(x=>n.includes(x));
    const c={mode:f('stepnum','mode','modenumber'),period:f('period','t'),
      ux:f('ux'),uy:f('uy'),uz:f('uz'),
      sux:f('sumux'),suy:f('sumuy'),suz:f('sumuz')};
    if(c.period>=0&&(c.ux>=0||c.uy>=0)){hi=i;m=c;break}
  }
  if(hi<0)return null;
  const out=[];
  for(const r of aoa.slice(hi+1)){
    const T=Number(r?.[m.period]);
    if(!Number.isFinite(T)||T<=0)continue;
    const g=k=>m[k]>=0?Number(r[m[k]]):null;
    out.push({mode:m.mode>=0?String(r[m.mode]??''):String(out.length+1),
      T,UX:g('ux'),UY:g('uy'),UZ:g('uz'),SumUX:g('sux'),SumUY:g('suy'),SumUZ:g('suz')});
  }
  return out.length?out:null;
}
function modFromTables(T){
  if(!T)return null;
  const key=Object.keys(T).find(k=>/MODAL PARTICIPATING MASS|MODAL PERIOD/i.test(k));
  if(!key)return null;
  const out=(T[key]||[]).map((r,i)=>({mode:String(r.StepNum??r.Mode??(i+1)),
    T:v300Num(r.Period),UX:v300Num(r.UX),UY:v300Num(r.UY),UZ:v300Num(r.UZ),
    SumUX:v300Num(r.SumUX),SumUY:v300Num(r.SumUY),SumUZ:v300Num(r.SumUZ)}))
    .filter(x=>x.T>0);
  return out.length?out:null;
}
async function modImport(file){
  const st=$('mod-summary');st.textContent='正在讀取…';
  try{
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    let rows=null;
    if(ext==='xlsx'||ext==='xls'){
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
      for(const sn of wb.SheetNames){
        rows=modFromMatrix(XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''}));
        if(rows)break;
      }
    }else{
      const text=await file.text();
      rows=modFromTables(parseS2K(text));
      if(!rows){
        const lines=text.split(/\r?\n/).filter(Boolean),sep=lines[0]?.includes('\t')?'\t':',';
        rows=modFromMatrix(lines.map(l=>l.split(sep).map(x=>x.replace(/^"|"$/g,'').trim())));
      }
    }
    if(!rows)throw new Error('找不到 Period 與 UX／UY 欄位');
    modResult={fileName:file.name,rows};modNote='';
  }catch(err){modResult=null;modNote='匯入失敗：'+String(err?.message||err)}
  renderModSummary();
}
function renderModSummary(){
  const sum=$('mod-summary'),bdg=$('bdg-mod'),tb=$('mod-table');
  if(!sum)return;
  if(!modResult){
    const auto=modFromTables(V305.analysisTables);
    if(auto)modResult={fileName:'（自 analysis results 讀取）',rows:auto};
  }
  const r=modResult;
  if(!r){
    sum.innerHTML='<b>尚未載入 Modal 資料</b><br>analysis results 若未含 Modal 表，'+
      '可匯入 SAP 的 Modal Participating Mass Ratios（.xlsx／.s2k）。'+(modNote?'<br>'+v300Esc(modNote):'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const rows=r.rows;
  /* 基本震動週期：各方向有效質量參與率最大的模態 */
  const pick=(k)=>rows.reduce((a,b)=>(b[k]??0)>(a?.[k]??-1)?b:a,null);
  const bx=pick('UX'),by=pick('UY');
  const last=rows[rows.length-1];
  sum.innerHTML='共 <b>'+rows.length+'</b> 個模態・第一模態 T₁ = <b>'+rows[0].T.toFixed(4)+'</b> s<br>'+
    (bx?'X 向主控模態 '+v300Esc(bx.mode)+'：T = <b>'+bx.T.toFixed(4)+'</b> s（UX '+(bx.UX*100).toFixed(1)+'%）<br>':'')+
    (by?'Y 向主控模態 '+v300Esc(by.mode)+'：T = <b>'+by.T.toFixed(4)+'</b> s（UY '+(by.UY*100).toFixed(1)+'%）<br>':'')+
    '累積有效質量：ΣUX '+((last.SumUX??0)*100).toFixed(1)+'%・ΣUY '+((last.SumUY??0)*100).toFixed(1)+'%'+
    '<span class="pm-origin">來源：'+v300Esc(r.fileName)+
    '。規範一般要求累積有效質量參與率達 90%。</span>';
  if(bdg){
    const ok=(last.SumUX??0)>=0.9&&(last.SumUY??0)>=0.9;
    bdg.textContent=ok?'完成・≥90%':'累積質量不足';
    bdg.className='badge '+(ok?'b-ok':'b-ng');
  }
  if(tb){
    tb.style.display='';
    tb.innerHTML='模態   T(s)     UX      UY      UZ     ΣUX     ΣUY\n'+
      rows.slice(0,20).map(x=>{const f=(v,w,p)=>(v==null||!Number.isFinite(v)?'—':v.toFixed(p)).padStart(w);
        return String(x.mode).padEnd(6)+f(x.T,7,4)+f(x.UX,8,4)+f(x.UY,8,4)+f(x.UZ,8,4)+
               f(x.SumUX,8,4)+f(x.SumUY,8,4)}).join('\n')+
      (rows.length>20?'\n…（共 '+rows.length+' 個模態）':'');
  }
}
$('btn-mod-import').addEventListener('click',()=>$('mod-file').click());
$('mod-file').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)modImport(f);e.target.value=''});

/* ==== V4.15.0 構材細長比（計算書 7.3.2）====
   KL/r 與規範限值比較；受壓 200、受拉 300（可調）。分類沿用幾何判定。 */
let slResult=null,slNote='';
function slRun(){
  if(!model?.frames?.length){slNote='尚未載入模型。';renderSlSummary();return}
  const props=memSectProps();
  const K=v300Num($('sl-K')?.value,1),limC=v300Num($('sl-lc')?.value,200),limT=v300Num($('sl-lt')?.value,300);
  const braceOnly=$('sl-brace')?.checked===true;
  const out=[];let skipped=0;
  for(const f of model.frames){
    const p=props.get(f.sect);
    const a=model.joints[String(f.i)],b=model.joints[String(f.j)];
    if(!p||!a||!b||!(p.A>0)){skipped++;continue}
    const L=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)*100;
    if(!(L>0)){skipped++;continue}
    const dz=Math.abs(b.z-a.z),dr=Math.hypot(b.x-a.x,b.y-a.y);
    const kind=dz>1e-6&&dr<=dz*.2?'柱':dz<=1e-6?'梁':'斜撐';
    if(braceOnly&&kind!=='斜撐')continue;
    const rmin=Math.min(Math.sqrt(Math.max(p.I33,1e-9)/p.A),Math.sqrt(Math.max(p.I22,1e-9)/p.A));
    const kl=K*L/rmin;
    const lim=kind==='斜撐'?limT:limC;
    out.push({id:String(f.id),sect:f.sect,kind,L:L/100,rmin,kl,lim,ratio:kl/lim,ok:kl<=lim});
  }
  if(!out.length){slNote='沒有可檢核的構材。';renderSlSummary();return}
  out.sort((a,b)=>b.ratio-a.ratio);
  slNote='';
  slResult={K,limC,limT,braceOnly,total:out.length,skipped,ng:out.filter(x=>!x.ok).length,rows:out};
  renderSlSummary();
}
function renderSlSummary(){
  const sum=$('sl-summary'),bdg=$('bdg-sl'),opt=$('sl-opt'),tb=$('sl-table');
  if(!sum)return;
  if(!model){
    sum.innerHTML='<b>尚未載入模型</b>';
    if(opt)opt.style.display='none';if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  if(opt)opt.style.display='';
  const r=slResult;
  if(!r){
    sum.innerHTML='已就緒：'+(model.frames||[]).length+' 支構材<br>設定 K 與限值後按「執行細長比檢核」。'+
      (slNote?'<br>'+v300Esc(slNote):'');
    if(tb)tb.style.display='none';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const w=r.rows[0];
  sum.innerHTML='檢核 <b>'+r.total+'</b> 支（略過 '+r.skipped+'）・超限 <b>'+r.ng+'</b> 支<br>'+
    '最大 KL/r = <b>'+w.kl.toFixed(1)+'</b>（Frame '+v300Esc(w.id)+'　'+v300Esc(w.sect)+'　'+w.kind+
    '　限值 '+w.lim+'）'+
    '<span class="pm-origin">rmin = √(Imin/A)；K='+r.K+'。柱／梁用受壓限值 '+r.limC+
    '，斜撐用 '+r.limT+'。實際應依構材受力狀態（壓或拉）選限值，本模組以構材型式近似。</span>';
  if(bdg){bdg.textContent=r.ng?'超限 '+r.ng:'完成・全 OK';bdg.className='badge '+(r.ng?'b-ng':'b-ok')}
  if(tb){
    tb.style.display='';
    tb.innerHTML='Frame 斷面              型式  L(m)   rmin   KL/r   限值  判定\n'+
      r.rows.slice(0,20).map(x=>String(x.id).padEnd(6)+String(x.sect||'—').padEnd(18)+
        x.kind.padEnd(5)+x.L.toFixed(2).padStart(6)+x.rmin.toFixed(2).padStart(7)+
        x.kl.toFixed(1).padStart(7)+String(x.lim).padStart(6)+(x.ok?'  ok':'  NG')).join('\n')+
      (r.rows.length>20?'\n…（僅列 KL/r 最大的 20 支，共 '+r.rows.length+' 支）':'');
  }
}
$('btn-sl-run').addEventListener('click',()=>slRun());
const slBaseStart=startApp;
startApp=function(...a){slResult=null;slNote='';modResult=null;modNote='';
  const o=slBaseStart.apply(this,a);
  try{renderSlSummary();renderModSummary()}catch(e){console.error(e)}
  return o};
const slBaseV305=v305RenderStatus;
v305RenderStatus=function(...a){const o=slBaseV305.apply(this,a);
  try{renderModSummary()}catch(e){console.error(e)}return o};

$('btn-mem-run').addEventListener('click',()=>memRun());
const memBaseStartApp=startApp;
startApp=function(...a){memResult=null;memNote='';memComboInfo=null;return memBaseStartApp.apply(this,a)};
const memBaseV305Import=v305ImportAnalysisFile;
v305ImportAnalysisFile=async function(...a){memResult=null;memNote='';memComboInfo=null;return memBaseV305Import.apply(this,a)};
const memBaseV305Render=v305RenderStatus;
v305RenderStatus=function(...a){const out=memBaseV305Render.apply(this,a);try{renderMemSummary()}catch(e){console.error(e)}return out};

$('btn-spl-run').addEventListener('click',()=>splRun(false));
$('btn-spl-auto').addEventListener('click',()=>splRun(true));
$('spl-frame').addEventListener('change',()=>renderSplStations());
$('spl-type').addEventListener('change',()=>{splResult=null;renderSplSummary()});
/* V4.15.0：新增的載重組合範圍選單原本沒掛 change，改了不會重算，
   摘要會停在舊的組合數（例如切到「全部組合」仍顯示「已排除 148 組」）。
   比照 spl-type 的既有作法：清掉結果並重繪，由使用者按「執行續接檢核」。 */
$('spl-combo-scope').addEventListener('change',()=>{splResult=null;renderSplSummary()});
const splBaseStartApp=startApp;
startApp=function(...a){splResult=null;splNote='';return splBaseStartApp.apply(this,a)};
const splBaseV305Import=v305ImportAnalysisFile;
v305ImportAnalysisFile=async function(...a){splResult=null;splNote='';return splBaseV305Import.apply(this,a)};
const splBaseV305Render=v305RenderStatus;
v305RenderStatus=function(...a){const out=splBaseV305Render.apply(this,a);try{renderSplSummary()}catch(e){console.error(e)}return out};

$('pm-combo-scope').addEventListener('change',()=>{pmComboInfo=null;try{renderPmSummary()}catch(e){console.error(e)}});
$('btn-bp-run').addEventListener('click',()=>bpRun());
/* V4.15.0：比照 V4.15.0 的教訓，新增的計算輸入必須接上重算路徑 */
$('bp-combo-scope').addEventListener('change',()=>{bpResult=null;bpComboInfo=null;renderBpSummary()});
$('bp-force').addEventListener('change',()=>{bpResult=null;bpComboInfo=null;renderBpSummary()});
const bpBaseStartApp=startApp;
startApp=function(...a){bpResult=null;bpNote='';bpComboInfo=null;bpCbf=null;return bpBaseStartApp.apply(this,a)};
const bpBaseV305Import=v305ImportAnalysisFile;
v305ImportAnalysisFile=async function(...a){bpResult=null;bpNote='';bpComboInfo=null;bpCbf=null;return bpBaseV305Import.apply(this,a)};
const bpBaseV305Render=v305RenderStatus;
v305RenderStatus=function(...a){const out=bpBaseV305Render.apply(this,a);try{renderBpSummary()}catch(e){console.error(e)}return out};
const bpBaseFoundationSummary=renderFoundationSummary;
renderFoundationSummary=function(...a){const out=bpBaseFoundationSummary.apply(this,a);
  try{renderBpSummary()}catch(e){console.error(e)}return out};

$('btn-drift-run').addEventListener('click',()=>driftRun());
const driftBaseStartApp=startApp;
startApp=function(...a){driftResult=null;driftNote='';return driftBaseStartApp.apply(this,a)};
/* 換模型或換分析結果時清掉舊結果——否則會沿用上一個模型的數字（V4.15.0 實測到） */
const driftBaseV305Apply=v305ImportAnalysisFile;
v305ImportAnalysisFile=async function(...a){driftResult=null;driftNote='';return driftBaseV305Apply.apply(this,a)};
const driftBaseV305Render=v305RenderStatus;
v305RenderStatus=function(...a){const out=driftBaseV305Render.apply(this,a);try{renderDriftSummary()}catch(e){console.error(e)}return out};
const driftBaseFoundationSummary=renderFoundationSummary;
renderFoundationSummary=function(...a){const out=driftBaseFoundationSummary.apply(this,a);
  try{renderDriftSummary()}catch(e){console.error(e)}return out};

$('btn-seis-workspace').addEventListener('click',()=>openSeisWorkspace());
$('btn-seis-gen').addEventListener('click',()=>seisGenerate());
$('btn-seis-back').addEventListener('click',closeSeisWorkspace);

/* ════════ V4.15.0 風力模組（耐風規範計算書）════════ */
const WIND_CHILD_SOURCE='s2k-f2k-wind-v400';
let windFrameLoaded=false,windBridgeReady=false,windPending=[],windState=null,windNote='';
function windPost(message){
  const frame=$('wind-frame-el');
  if(!windBridgeReady||!frame||!frame.contentWindow){windPending.push(message);return}
  frame.contentWindow.postMessage({source:FOUNDATION_PARENT_SOURCE,...message},'*');
}
function ensureWindFrame(){
  const frame=$('wind-frame-el');
  if(windFrameLoaded)return frame;
  const raw=$('module-source-wind-v100').textContent.trim();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  frame.srcdoc=new TextDecoder('utf-8').decode(bytes);
  windFrameLoaded=true;
  return frame;
}
function openWindWorkspace(){
  const ws=$('wind-workspace');
  ws.classList.add('on');ws.setAttribute('aria-hidden','false');
  wind4RenderWorkspaceGeometry();
  ensureWindFrame();
  if(windBridgeReady)windPost({type:'request-state'});
}
function closeWindWorkspace(){
  const ws=$('wind-workspace');
  ws.classList.remove('on');ws.setAttribute('aria-hidden','true');
}
function wind4RenderBlockSelect(){
  const wrap=$('wind-block-wrap'),sel=$('wind-block-select'),p=WIND4.project;
  if(!wrap||!sel)return;wrap.classList.toggle('on',!!p?.blocks?.length);if(!p?.blocks?.length)return;
  sel.innerHTML=p.blocks.map(b=>'<option value="'+v300Esc(b.id)+'"'+(b.id===p.active?' selected':'')+'>'+v300Esc(b.id)+'・'+v300Esc((W4_CLS[b.cls]||{}).t||b.cls)+'</option>').join('');
  wind4RenderWorkspaceGeometry();
}
/* 工作區屬於單量體計算器；母頁在 iframe 上方固定保留「全量體＋各量體」圖，避免切換後失去幾何脈絡。 */
function wind4RenderWorkspaceGeometry(){
  const host=$('wind-workspace-geometry'),p=WIND4.project;if(!host)return;
  if(!p?.blocks?.length){host.innerHTML='<div style="color:#94a3b8;font-size:.72rem;padding:12px">尚未建立風力分析專案；請先回側欄完成量體辨識。</div>';return}
  const bs=p.blocks,pal=['#38bdf8','#a78bfa','#34d399','#fb7185','#fbbf24','#22d3ee','#f97316','#c084fc'],
        color=b=>pal[Math.max(0,bs.indexOf(b))%pal.length],esc=v=>v300Esc(String(v??'')),
        x0=Math.min(...bs.map(b=>b.xmin)),x1=Math.max(...bs.map(b=>b.xmax)),y0=Math.min(...bs.map(b=>b.ymin)),y1=Math.max(...bs.map(b=>b.ymax)),
        totalSc=Math.min(184/Math.max(x1-x0,.001),86/Math.max(y1-y0,.001)),
        totalOx=18+(184-(x1-x0)*totalSc)/2,totalOy=102+(y1-y0)*totalSc,
        sx=v=>totalOx+(v-x0)*totalSc,sy=v=>totalOy-(v-y0)*totalSc,
        maxDx=Math.max(...bs.map(b=>b.xmax-b.xmin),.001),maxDy=Math.max(...bs.map(b=>b.ymax-b.ymin),.001),
        cardSc=Math.min(142/maxDx,76/maxDy),status=(f,b)=>f.use!==false?(+f.zMin>.05?'partial':'load'):(+f.zMin>=+b.h-.05?'blocked':'off'),
        statusStyle=s=>s==='load'?['#22c55e','']:s==='partial'?['#f59e0b','']:s==='blocked'?['#ef4444',' stroke-dasharray="4 3"']:['#64748b',' stroke-dasharray="4 3"'];
  let all='<svg viewBox="0 0 220 125" role="img" aria-label="全量體實際比例平面總覽"><rect width="220" height="125" rx="7" fill="#0c1627"/>';
  bs.slice().sort((a,b)=>b.plan-a.plan).forEach(b=>{
    const x=sx(b.xmin),y=sy(b.ymax),w=Math.max(3,sx(b.xmax)-x),h=Math.max(3,sy(b.ymin)-y),c=color(b);
    all+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" fill-opacity=".26" stroke="${c}" stroke-width="${b.id===p.active?3:1.6}"/><text x="${x+w/2}" y="${y+h/2+4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="800">${esc(b.id)}</text>`;
    (p.faces||[]).filter(f=>f.blockId===b.id).forEach(f=>{const [col,dash]=statusStyle(status(f,b));let xA,yA,xB,yB;
      if(f.axis==='x'){xA=xB=sx(f.side==='min'?b.xmin:b.xmax);yA=sy(b.ymin);yB=sy(b.ymax)}else{yA=yB=sy(f.side==='min'?b.ymin:b.ymax);xA=sx(b.xmin);xB=sx(b.xmax)}
      all+=`<line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}" stroke="${col}" stroke-width="3"${dash}/>`});
  });
  all+='<text x="8" y="121" fill="#94a3b8" font-size="6.4">綠＝全高　橘＝遮蔽以上　紅虛＝全遮蔽　灰虛＝手動取消</text></svg>';
  let html='<div class="wind-geom-strip"><article class="wind-geom-card total"><header>全量體總覽<span>'+bs.length+' 量體</span></header>'+all+'<footer>下方計算器每次處理一個量體；此圖保留全局位置。</footer></article>';
  bs.forEach((b,i)=>{
    const c=color(b),gx=+b.slopeX||0,gy=+b.slopeY||0,L=Math.hypot(gx,gy),ux=L?gx/L:0,uy=L?gy/L:0,
          rw=Math.max(3,(b.xmax-b.xmin)*cardSc),rh=Math.max(3,(b.ymax-b.ymin)*cardSc),rx=90-rw/2,ry=53-rh/2,
          al=Math.min(30,Math.max(10,Math.min(rw,rh)*.32)),hiX=90+ux*al,hiY=53-uy*al,loX=90-ux*al,loY=53+uy*al,
          faces=(p.faces||[]).filter(f=>f.blockId===b.id),on=faces.filter(f=>f.use!==false).length,
          arrow=L>.0001?`<line x1="${hiX}" y1="${hiY}" x2="${loX}" y2="${loY}" stroke="#fbbf24" stroke-width="3" marker-end="url(#wg${i})"/><text x="${hiX}" y="${hiY-5}" fill="#f8fafc" font-size="8" text-anchor="middle">高</text><text x="${loX}" y="${loY+10}" fill="#f8fafc" font-size="8" text-anchor="middle">低</text>`:'<text x="90" y="56" text-anchor="middle" fill="#cbd5e1" font-size="9">平屋頂</text>';
    let edge='';faces.forEach(f=>{const [col,dash]=statusStyle(status(f,b));let xa,ya,xb,yb;if(f.axis==='x'){xa=xb=f.side==='min'?rx:rx+rw;ya=ry;yb=ry+rh}else{ya=yb=f.side==='min'?ry+rh:ry;xa=rx;xb=rx+rw}edge+=`<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${col}" stroke-width="3"${dash}/>`});
    const svg=`<svg viewBox="0 0 180 118" role="img" aria-label="${esc(b.id)} 量體實際比例示意"><defs><marker id="wg${i}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#fbbf24"/></marker></defs><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="3" fill="${c}" fill-opacity=".23" stroke="${c}" stroke-width="1.5"/>${edge}${arrow}<text x="90" y="107" text-anchor="middle" fill="#94a3b8" font-size="8">X ${(b.xmax-b.xmin).toFixed(1)} × Y ${(b.ymax-b.ymin).toFixed(1)} m（同比例）</text></svg>`;
    html+='<article class="wind-geom-card '+(b.id===p.active?'active':'')+'" data-w4ws-block="'+esc(b.id)+'"><header>'+esc(b.id)+'<span>h '+(+b.h).toFixed(2)+' m・θ '+(+b.tilt).toFixed(1)+'°</span></header>'+svg+'<footer>'
      +(b.cls==='lattice'?'格子構架・不使用四面實心外牆載重':esc((W4_CLS[b.cls]||{}).t||b.cls)+'・載重面 '+on+'/'+faces.length)+'</footer></article>';
  });
  host.innerHTML=html+'</div>';
  host.querySelectorAll('[data-w4ws-block]').forEach(el=>el.addEventListener('click',()=>wind4ActivateBlock(el.dataset.w4wsBlock)));
}
/* 把母頁已載入的 S2K 直接餵給耐風工具，免使用者再選一次檔 */
function windSync(open){
  if(!currentS2KText){windNote='請先載入 Model Definition S2K。';renderWindSummary();return}
  windNote='';ensureWindFrame();
  if(open!==false)openWindWorkspace();
  windPost({type:'wind-apply',payload:{s2kText:currentS2KText,fileName:currentS2KFileName||'model.s2k'}});
  $('wind-workspace-status').textContent='已送出模型幾何，解析中…';
  renderWindSummary();
}
function renderWindSummary(){
  const sum=$('wind-summary'),bdg=$('bdg-wind');if(!sum)return;
  wind4RenderBlockSelect();
  const pbtn=$('btn-wind-project');if(pbtn)pbtn.textContent=WIND4.project?'編輯風力分析專案（各量體四面）':'建立風力分析專案（各量體四面）';
  if(!currentS2KText){
    sum.innerHTML='<b>尚未載入模型</b><br>載入 Model Definition S2K 後可自動帶入建物尺寸與四面外牆柱距。';
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const w=windState,P=WIND4.project;
  if(P){
    /* 有專案時，側欄只講專案狀態——不再叫使用者去按「帶入模型幾何」 */
    const b=P.blocks.find(x=>x.id===P.active)||P.blocks[0],
          hT=w&&w.input&&Number.isFinite(w.input.h)?w.input.h:null,
          ok=hT!==null&&b&&Math.abs(hT-b.h)<=0.05,
          clsActual=w?.blockId===b?.id?w.enclosureComputed:null,clsMismatch=clsActual&&b?.enclosure&&clsActual!==b.enclosure,
          hasProf=!!(w&&w.loads&&(w.loads.profile||[]).length);
    sum.innerHTML='專案 <b>'+v300Esc(P.name)+'</b><br>'
      +'量體 '+P.blocks.map(x=>(x.id===P.active?'<b>'+x.id+'</b>':x.id)).join('、')
      +(P.blocks.length>1?'　<span class="pm-origin">目前計算 '+P.active+'</span>':'')+'<br>'
      +(b?('h=<b>'+b.h.toFixed(2)+'</b> m・θ='+b.tilt.toFixed(2)+'°・'+(b.levels||[]).length+' 層・'+({closed:'封閉',partial:'部分封閉',open:'開放'}[b.enclosure]||b.enclosure)
           +(hT!==null?('　工作區 h='+hT+(ok?' ✓':' <span style="color:var(--warn)">⚠ 不一致</span>')):'')):'')
      +(clsMismatch?'<br><span style="color:var(--warn)">⚠ 工作區依開口面積判為 '+({closed:'封閉',partial:'部分封閉',open:'開放'}[clsActual]||clsActual)+'，與精靈宣告不一致；請回步驟 2 修正開口面積或封閉性。</span>':'')
      +'<br>迎風面 '+P.faces.filter(f=>f.use!==false).map(f=>v300Esc((f.blockId?f.blockId+' ':'')+f.wind)).join('、')
      +'<span class="pm-origin">'+(hasProf?'風壓剖線已就緒，可按下方產生載重':'請先在工作區設定風速與地況')+'</span>';
    if(bdg){bdg.textContent=hasProf?'可產生載重':'專案已建立';bdg.className=hasProf?'badge b-ok':'badge b-warn'}
    return;
  }
  if(!w||!w.loaded){
    sum.innerHTML='模型已就緒，尚未建立風力專案。<br>按「建立風力分析專案」自動辨識量體與四面柱距。'+(windNote?'<br>'+v300Esc(windNote):'');
    if(bdg){bdg.textContent='未執行';bdg.className='badge b-idle'}
    return;
  }
  const faces=(w.faces||[]).map(f=>v300Esc(f.wind)+'：'+f.nCols+' 柱・總長 '+f.total+' m').join('<br>');
  const hT=w.input&&Number.isFinite(w.input.h)?w.input.h:null;
  const hBad=hT!==null&&Number.isFinite(w.ztop)&&Math.abs(hT-w.ztop)>0.05;
  const ackRow=$('wind-h-ack-row');if(ackRow)ackRow.style.display=hBad?'':'none';
  sum.innerHTML='建物 <b>'+w.dx+'</b> × <b>'+w.dy+'</b> m・柱頂 <b>'+w.ztop+'</b> m'+
    (hT!==null?'　工作區 h=<b>'+hT+'</b> m'+(hBad?' <span style="color:var(--warn)">⚠ 與模型不符</span>':' ✓'):'')+'<br>'+
    '柱 '+w.nCols+' 支・節點 '+w.nJoint+'<br>'+faces+
    '<span class="pm-origin">風速、地況與封閉條件於工作區設定；5.6 節產生逐柱線載重</span>'+(windNote?'<br>'+v300Esc(windNote):'');
  if(bdg){bdg.textContent='幾何已帶入';bdg.className='badge b-ok'}
}
window.addEventListener('message',ev=>{
  const d=ev.data||{};if(d.source!==WIND_CHILD_SOURCE)return;
  if(d.type==='ready'){
    windBridgeReady=true;
    $('wind-workspace-status').textContent='耐風模組已就緒';
    const queued=windPending.splice(0);
    for(const m of queued)windPost(m);
  }else if(d.type==='wind-state'){
    windState=d.payload||null;
    if(WIND4.waiter){try{WIND4.waiter(windState)}catch(e){console.error(e)}}
    if(windState?.loaded){
      const e={closed:'封閉',partial:'部分封閉',open:'開放'}[windState.enclosure]||windState.enclosure||'',
            ec={closed:'封閉',partial:'部分封閉',open:'開放'}[windState.enclosureComputed]||windState.enclosureComputed||'',
            warn=windState.enclosure&&windState.enclosureComputed&&windState.enclosure!==windState.enclosureComputed;
      $('wind-workspace-status').textContent=(windState.blockId?'目前 '+windState.blockId+'：':'幾何已帶入：')+
        windState.dx+' × '+windState.dy+' m・h '+(windState.input?.h??windState.ztop)+' m・柱 '+windState.nCols+' 支'+(e?'・'+e:'')+
        (warn?'（⚠ 工作區判為 '+ec+'）':'');
    }
    renderWindSummary();
  }else if(d.type==='error'){
    windNote='耐風模組錯誤：'+String(d.message||'');renderWindSummary();
  }
});

/* ════════ V4.15.2 風力分析專案：母頁側的模型幾何解析 ════════
   分工比照基礎模組——幾何在母頁解析（精靈要畫、要選），風壓計算留在子頁。*/
function wind4BaseZ(){
  const zg=(model?.grids||[]).filter(g=>g.dir==='Z');
  const named=zg.find(g=>/^(gl|0f|ground|fl0)$/i.test(String(g.id||'').trim()));
  if(named)return {z:+named.c,src:'Z 格線「'+named.id+'」'};
  const zero=zg.find(g=>Math.abs(+g.c)<1e-9);
  if(zero)return {z:0,src:'Z 格線「'+zero.id+'」（z=0）'};
  const cols=windColumns();
  const zb=cols.length?Math.min(...cols.map(c=>c.zBot)):0;
  return {z:zb,src:'柱底最低標高（模型無地面格線）'};
}
function wind4Heights(){
  const base=wind4BaseZ().z,cnt={};
  windColumns().forEach(c=>{const k=+(c.zTop-base).toFixed(3);if(k>0)cnt[k]=(cnt[k]||0)+1});
  return Object.keys(cnt).map(Number).sort((a,b)=>b-a).map(h=>({h,n:cnt[h]}));
}
/* V4.15.5：NONE／NULL／DUMMY 面常只是剛性面或幾何輔助，不可當成實體屋面。 */
function wind4IsPhysicalArea(a){
  const sec=String(a?.sect||'').trim(),p=model?.areaSections?.[sec]||{},mat=String(p.mat||'').trim();
  if(!sec)return true; /* 未指定斷面的 Area 在部分既有模型就是風牆／屋面幾何 */
  if(Object.keys(p).length&&/^(none|null|dummy|na|n\/a)$/i.test(mat))return false;
  return !/^(dummy|null)$/i.test(sec);
}
/* 面元素 → 傾角（Newell 法，凹多邊形也正確） */
function wind4Faces(){
  const out=[];
  for(const a of model?.areas||[]){
    const P=(a.joints||[]).map(j=>model.joints[String(j)]).filter(Boolean);
    if(P.length<3)continue;
    let nx=0,ny=0,nz=0;
    for(let i=0;i<P.length;i++){
      const p=P[i],q=P[(i+1)%P.length];
      nx+=(p.y-q.y)*(p.z+q.z);ny+=(p.z-q.z)*(p.x+q.x);nz+=(p.x-q.x)*(p.y+q.y);
    }
    const L=Math.hypot(Math.hypot(nx,ny),nz);if(L<1e-9)continue;
    const zs=P.map(p=>p.z),xs=P.map(p=>p.x),ys=P.map(p=>p.y);
    /* 傾斜朝向：法線水平分量的方位角。單斜屋頂靠這個才分得開——
       WTB 高棟朝 180°、低棟朝 0°，只用傾角會被併成同一群。 */
    out.push({id:String(a.id),sect:String(a.sect||''),physical:wind4IsPhysicalArea(a),size:L/2,tilt:Math.acos(Math.min(1,Math.abs(nz/L)))*180/Math.PI,
      az:(Math.atan2(ny,nx)*180/Math.PI+360)%360,
      /* 屋面平面 z=ax+by+c 的兩個梯度；比法向量方位更適合直接畫高低端。 */
      slopeX:Math.abs(nz)>1e-9?-nx/nz:0,slopeY:Math.abs(nz)>1e-9?-ny/nz:0,
      zmin:Math.min(...zs),zmax:Math.max(...zs),zc:zs.reduce((s,v)=>s+v,0)/zs.length,
      xmin:Math.min(...xs),xmax:Math.max(...xs),ymin:Math.min(...ys),ymax:Math.max(...ys)});
  }
  return out;
}
/* 屋面群：傾角<60° 且正上方沒有水平投影重疊的面（有就是樓版） */
function wind4Roofs(){
  const F=wind4Faces();
  if(!F.length)return {groups:[],slabs:0,walls:0,faces:0};
  const flat=F.filter(f=>f.physical&&f.tilt<60),walls=F.filter(f=>f.physical&&f.tilt>=60);
  const covered=f=>flat.some(g=>g!==f&&g.zmin>f.zmax+.3&&
    g.xmin<f.xmax-.1&&g.xmax>f.xmin+.1&&g.ymin<f.ymax-.1&&g.ymax>f.ymin+.1);
  const roofs=flat.filter(f=>!covered(f)),slabs=flat.length-roofs.length,gs=[];
  roofs.sort((a,b)=>a.zc-b.zc).forEach(f=>{
    const g=gs.find(g=>Math.abs(g.tilt-f.tilt)<=.5&&f.zc<=g.zcMax+2&&f.zc>=g.zcMin-2);
    if(g){g.list.push(f);g.zcMin=Math.min(g.zcMin,f.zc);g.zcMax=Math.max(g.zcMax,f.zc);
          g.tilt=(g.tilt*(g.list.length-1)+f.tilt)/g.list.length}
    else gs.push({tilt:f.tilt,zcMin:f.zc,zcMax:f.zc,list:[f]});
  });
  const base=wind4BaseZ().z;
  const groups=gs.map((g,i)=>{const L=g.list;return {
    id:'R'+(i+1),tilt:g.tilt,n:L.length,size:L.reduce((s,f)=>s+f.size,0),
    zmin:Math.min(...L.map(f=>f.zmin))-base,zmax:Math.max(...L.map(f=>f.zmax))-base,
    xmin:Math.min(...L.map(f=>f.xmin)),xmax:Math.max(...L.map(f=>f.xmax)),
    ymin:Math.min(...L.map(f=>f.ymin)),ymax:Math.max(...L.map(f=>f.ymax))};
  }).sort((a,b)=>b.zmax-a.zmax);
  const wallArea=walls.reduce((s,f)=>s+f.size,0);
  const cols=windColumns(),xs=cols.map(c=>c.x),ys=cols.map(c=>c.y);
  const bx=xs.length?Math.max(...xs)-Math.min(...xs):0,by=ys.length?Math.max(...ys)-Math.min(...ys):0;
  const h=Math.max(...cols.map(c=>c.zTop),0)-base,env=2*(bx+by)*Math.max(h,.001);
  return {groups,slabs,walls:walls.length,faces:F.length,wallArea,env,
          ratio:env>0?wallArea/env:0,likelyOpen:walls.length===0||(env>0&&wallArea/env<.2)};
}


/* ════════ V4.15.3 量體辨識 ════════
   一個模型常同時有主樓、低棟、屋突。先切量體、各自判分類，才不用一直手動切換計算對象。 */
const W4_ROOF_MIN_RATIO=0.02;      /* 小於總屋面積 2% 的面視為雜項（樓梯頂蓋之類） */
function wind4Blocks(){
  const base=wind4BaseZ().z,F=wind4Faces();
  const dummy=F.filter(f=>!f.physical),flat=F.filter(f=>f.physical&&f.tilt<60),walls=F.filter(f=>f.physical&&f.tilt>=60);
  const covered=f=>flat.some(g=>g!==f&&g.zmin>f.zmax+.3&&
    g.xmin<f.xmax-.1&&g.xmax>f.xmin+.1&&g.ymin<f.ymax-.1&&g.ymax>f.ymin+.1);
  const roofs=flat.filter(f=>!covered(f)),slabs=flat.length-roofs.length;
  const total=roofs.reduce((s,f)=>s+f.size,0);
  /* ⚠ 不能用「單片面積 vs 總面積」過濾雜項——屋面本來就會被網格切成很多小片
     （WTB 一個屋頂 28 片、每片約 13 m²，2% 門檻 20.6 m² 會把整片屋頂逐片剔光）。
     要先分群，再用「群的總面積」判雜項。 */
  const rough=[];
  roofs.slice().sort((a,b)=>a.zc-b.zc).forEach(f=>{
    const azBin=f.tilt<1?0:Math.round(f.az/45)*45%360;
    const g=rough.find(g=>Math.abs(g.tilt-f.tilt)<=.5&&g.azBin===azBin&&f.zc<=g.zcMax+2&&f.zc>=g.zcMin-2);
    if(g){g.list.push(f);g.zcMin=Math.min(g.zcMin,f.zc);g.zcMax=Math.max(g.zcMax,f.zc);
          g.tilt=(g.tilt*(g.list.length-1)+f.tilt)/g.list.length}
    else rough.push({tilt:f.tilt,azBin,zcMin:f.zc,zcMax:f.zc,list:[f]});
  });
  /* V4.15.5：同高程、同傾角但平面互不相連者仍是不同量體。 */
  const touches=(a,b)=>!(a.xmax<b.xmin-.25||b.xmax<a.xmin-.25||a.ymax<b.ymin-.25||b.ymax<a.ymin-.25);
  const gs=[];
  rough.forEach(r=>{
    const left=new Set(r.list);
    while(left.size){
      const seed=left.values().next().value,part=[seed];left.delete(seed);
      for(let i=0;i<part.length;i++)for(const f of [...left])if(touches(part[i],f)){part.push(f);left.delete(f)}
      gs.push({tilt:part.reduce((s,f)=>s+f.tilt,0)/part.length,azBin:r.azBin,
               zcMin:Math.min(...part.map(f=>f.zc)),zcMax:Math.max(...part.map(f=>f.zc)),list:part});
    }
  });
  const cols=windColumns();
  const gsAll=gs,
        gsMain=gs.filter(g=>g.list.reduce((s,f)=>s+f.size,0)>=total*W4_ROOF_MIN_RATIO),
        minor=gsAll.length-gsMain.length;
  let blocks=gsMain.map((g,i)=>{
    const L=g.list,
      xmin=Math.min(...L.map(f=>f.xmin)),xmax=Math.max(...L.map(f=>f.xmax)),
      ymin=Math.min(...L.map(f=>f.ymin)),ymax=Math.max(...L.map(f=>f.ymax)),
      zmin=Math.min(...L.map(f=>f.zmin)),zmax=Math.max(...L.map(f=>f.zmax)),
      eave=+(zmin-base).toFixed(3),ridge=+(zmax-base).toFixed(3),
      /* 規範符號表：斜角 <10° 以簷高代替，≥10° 用平均屋頂高 */
      useEave=g.tilt<10,
      h=useEave?eave:+(((zmin+zmax)/2)-base).toFixed(3),
      /* 柱歸屬：柱位落在該量體平面範圍內（容差 0.6 m），且柱頂不低於簷高 */
      own=cols.filter(c=>c.x>=xmin-.6&&c.x<=xmax+.6&&c.y>=ymin-.6&&c.y<=ymax+.6&&
                         (c.zTop-base)>=eave-1.5),
      /* 牆面歸屬用「中心點落在量體平面內」，不用「整片包在內」——
         後者會讓貫穿多個量體的大牆被小量體整片認領，算出 >100% 的牆面比。 */
      wallIn=walls.filter(w=>{const cx=(w.xmin+w.xmax)/2,cy=(w.ymin+w.ymax)/2;
        return cx>=xmin-.6&&cx<=xmax+.6&&cy>=ymin-.6&&cy<=ymax+.6}),
      plan=(xmax-xmin)*(ymax-ymin),
      wallArea=wallIn.reduce((s,f)=>s+f.size,0),
      env=2*((xmax-xmin)+(ymax-ymin))*Math.max(h,.001);
    const areaSum=Math.max(L.reduce((s,f)=>s+f.size,0),1e-9),
          slopeX=L.reduce((s,f)=>s+f.slopeX*f.size,0)/areaSum,
          slopeY=L.reduce((s,f)=>s+f.slopeY*f.size,0)/areaSum;
    return {id:'B'+(i+1),tilt:+g.tilt.toFixed(3),azBin:g.azBin,slopeX,slopeY,n:L.length,faceIds:L.map(f=>f.id),
      size:+L.reduce((s,f)=>s+f.size,0).toFixed(1),
      xmin,xmax,ymin,ymax,zmin:+(zmin-base).toFixed(3),zmax:+(zmax-base).toFixed(3),
      eave,ridge,useEave,h,plan:+plan.toFixed(1),nCols:own.length,
      wallArea:+wallArea.toFixed(1),env:+env.toFixed(1),
      wallRatio:env>0?Math.min(wallArea/env,1):0,use:true,enclosure:'closed',openings:[0,0,0,0,0],
      roofType:g.tilt>=1?'mono':'flat',parapet:0,parentId:''};
  }).sort((a,b)=>b.plan-a.plan||b.zmax-a.zmax);
  /* 小群不直接丟掉：保留成「排除候選」讓使用者重新納入。
     WTB 左上 7.8 m² 戶外樓梯平台就屬這一類，不應因 2% 門檻而從人工複核流程消失。 */
  const minorBlocks=gsAll.filter(g=>!gsMain.includes(g)).map((g,i)=>{
    const L=g.list,xmin=Math.min(...L.map(f=>f.xmin)),xmax=Math.max(...L.map(f=>f.xmax)),
      ymin=Math.min(...L.map(f=>f.ymin)),ymax=Math.max(...L.map(f=>f.ymax)),zmin=Math.min(...L.map(f=>f.zmin)),zmax=Math.max(...L.map(f=>f.zmax)),
      eave=+(zmin-base).toFixed(3),ridge=+(zmax-base).toFixed(3),useEave=g.tilt<10,h=useEave?eave:+(((zmin+zmax)/2)-base).toFixed(3),
      own=cols.filter(c=>c.x>=xmin-.6&&c.x<=xmax+.6&&c.y>=ymin-.6&&c.y<=ymax+.6&&(c.zTop-base)>=eave-1.5),
      areaSum=Math.max(L.reduce((s,f)=>s+f.size,0),1e-9),slopeX=L.reduce((s,f)=>s+f.slopeX*f.size,0)/areaSum,slopeY=L.reduce((s,f)=>s+f.slopeY*f.size,0)/areaSum,
      wallIn=walls.filter(w=>{const cx=(w.xmin+w.xmax)/2,cy=(w.ymin+w.ymax)/2;return cx>=xmin-.6&&cx<=xmax+.6&&cy>=ymin-.6&&cy<=ymax+.6}),
      plan=(xmax-xmin)*(ymax-ymin),wallArea=wallIn.reduce((s,f)=>s+f.size,0),env=2*((xmax-xmin)+(ymax-ymin))*Math.max(h,.001);
    return {id:'M'+(i+1),candidate:true,tilt:+g.tilt.toFixed(3),azBin:g.azBin,slopeX,slopeY,n:L.length,faceIds:L.map(f=>f.id),
      size:+areaSum.toFixed(1),xmin,xmax,ymin,ymax,zmin:+(zmin-base).toFixed(3),zmax:+(zmax-base).toFixed(3),eave,ridge,useEave,h,
      plan:+plan.toFixed(1),nCols:own.length,wallArea:+wallArea.toFixed(1),env:+env.toFixed(1),wallRatio:env>0?Math.min(wallArea/env,1):0,
      use:true,cls:'lattice',enclosure:'open',openings:[0,0,0,0,0],roofType:g.tilt>=1?'mono':'flat',parapet:0,parentId:'',isPent:false};
  }).sort((a,b)=>b.plan-a.plan);
  /* 沒有實體屋面但有柱、梁與斜撐：走格子構架，不把 NONE 虛擬面誤當開放式屋頂。 */
  if(!blocks.length&&cols.length){
    const xs=cols.map(c=>c.x),ys=cols.map(c=>c.y),zTop=Math.max(...cols.map(c=>c.zTop)),
          xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),h=+(zTop-base).toFixed(3);
    blocks=[{id:'B1',tilt:0,azBin:0,slopeX:0,slopeY:0,n:0,faceIds:[],size:0,xmin,xmax,ymin,ymax,zmin:h,zmax:h,
      eave:h,ridge:h,useEave:true,h,plan:+((xmax-xmin)*(ymax-ymin)).toFixed(1),nCols:cols.length,
      wallArea:0,env:+(2*((xmax-xmin)+(ymax-ymin))*Math.max(h,.001)).toFixed(1),wallRatio:0,
      use:true,enclosure:'open',openings:[0,0,0,0,0],roofType:'flat',parapet:0,parentId:'',isPent:false,cls:'lattice'}];
  }
  /* 屋突必須位於較大母量體屋頂範圍內；只靠面積與高程會把側邊雨遮誤判成屋突。 */
  if(blocks.length){
    blocks.forEach(b=>{
      const parents=blocks.filter(p=>p!==b&&p.plan>b.plan/0.3&&b.eave>=p.zmax-1&&
        b.xmin>=p.xmin-.3&&b.xmax<=p.xmax+.3&&b.ymin>=p.ymin-.3&&b.ymax<=p.ymax+.3)
        .sort((a,c)=>a.plan-c.plan);
      b.parentId=parents[0]?.id||'';b.isPent=!!b.parentId;
      if(!b.cls)b.cls=b.isPent?'pent':(b.wallRatio>=.2?'closed':(b.n?'openRoof':'lattice'));
      b.enclosure=b.cls==='closed'?'closed':'open';
    });
  }
  return {blocks,minorBlocks,slabs,minor,minorArea:+(gsAll.filter(g=>!gsMain.includes(g))
            .reduce((s,g)=>s+g.list.reduce((a,f)=>a+f.size,0),0)).toFixed(1),
          walls:walls.length,faces:F.length,dummy:dummy.length,base};
}
const W4_CLS={closed:{t:'一般建築物（封閉／部分封閉）',d:'實際封閉性在步驟 2 確認；迎風牆逐柱線載重＋其餘面均布'},
              openRoof:{t:'開放式建築物',d:'屋頂走表2.9 C_pn'},
              lattice:{t:'格子構架／桁架',d:'逐構件 F=q·G·C_f·A_f（V4.16.0）'},
              pent:{t:'屋頂突出物（屋突）',d:'表2.12；規範符號表明訂 h 不含屋突'}};
/* 該量體要帶進工作區的參數（樓層只取不超過該量體屋頂者） */
function wind4BlockPatch(b){
  const base=wind4BaseZ().z,
        zg=(model?.grids||[]).filter(g=>g.dir==='Z')
            .map(g=>[String(g.id),+(+g.c-base).toFixed(3)])
            .filter(g=>g[1]>=-1e-9&&g[1]<=b.h+.05).sort((x,y)=>x[1]-y[1]);
  const levels=Array.isArray(b.levels)?b.levels:(zg.length?zg:null),
        own=windColumns().filter(c=>c.x>=b.xmin-.6&&c.x<=b.xmax+.6&&c.y>=b.ymin-.6&&c.y<=b.ymax+.6),
        bx=Math.max(.001,b.xmax-b.xmin),by=Math.max(.001,b.ymax-b.ymin),
        calcObject=b.cls==='openRoof'?'openRoof':b.cls==='lattice'?'standalone':'building';
  return {calcObject,enclosure:b.enclosure||'closed',openings:Array.isArray(b.openings)?b.openings.map(v=>Math.max(0,+v||0)):[0,0,0,0,0],
    inputs:{height:String(b.h),dimX:String(+bx.toFixed(3)),dimY:String(+by.toFixed(3)),roofType:b.roofType||(b.tilt>=1?'mono':'flat'),
      roofAngle:String(+b.tilt.toFixed(3)),eaveHeight:String(+b.eave.toFixed(3)),parapetHeight:String(+b.parapet||0)},levels,
    geometry:{id:b.id,classification:b.cls,enclosure:b.enclosure,parapet:+b.parapet||0,parentId:b.parentId||'',
      roofType:b.roofType||(b.tilt>=1?'mono':'flat'),bounds:{xmin:b.xmin,xmax:b.xmax,ymin:b.ymin,ymax:b.ymax},
      h:b.h,theta:b.tilt,slopeX:+b.slopeX||0,slopeY:+b.slopeY||0,nCols:Number.isFinite(+b.nCols)?+b.nCols:own.length,faceIds:b.faceIds||[]}};
}
/* ════════ V4.15.2 建立風力分析專案（精靈式，照 v300 基礎專案的模式） ════════
   使用者回饋：四個迎風面本來要在子頁 02~04 逐一切換、每次都回設定精靈按帶入，
   而且帶完四面也只看得到一面。改為：四面在同一步驟一次列出、一次產生。 */
const WIND4={step:1,draft:null,profiles:null,waiter:null,busy:false,result:null,split:null,
  preview:{view:'plan',focus:'',columns:false,faces:false}};

/* V4.15.5：每個量體各自尋找四側柱線；相鄰高低棟的共用面只保留高棟露出段。 */
function wind4FaceForBlock(b,axis,side,allBlocks=[]){
  const base=wind4BaseZ().z,other=axis==='x'?'y':'x',tol=.65;
  const cols=windColumns().filter(c=>c.x>=b.xmin-tol&&c.x<=b.xmax+tol&&c.y>=b.ymin-tol&&c.y<=b.ymax+tol&&c.zTop-base>0);
  if(!cols.length)return null;
  const vals=[...new Set(cols.map(c=>c[axis]))].sort((a,c)=>a-c),edge=side==='min'?vals[0]:vals[vals.length-1];
  const row=cols.filter(c=>Math.abs(c[axis]-edge)<.02&&c[other]>=(axis==='x'?b.ymin:b.xmin)-tol&&c[other]<=(axis==='x'?b.ymax:b.xmax)+tol);
  const byCoord=new Map();
  row.forEach(c=>{const k=c[other].toFixed(4);if(!byCoord.has(k))byCoord.set(k,{coord:c[other],stack:[]});byCoord.get(k).stack.push(c)});
  const list=[...byCoord.values()].sort((a,c)=>a.coord-c.coord);list.forEach(g=>g.stack.sort((a,c)=>a.zBot-c.zBot));
  if(!list.length)return null;
  const spans=list.slice(1).map((g,i)=>+(g.coord-list[i].coord).toFixed(4));
  const lo=axis==='x'?b.ymin:b.xmin,hi=axis==='x'?b.ymax:b.xmax,width=Math.max(hi-lo,.001);
  let zMin=0;
  allBlocks.filter(n=>n!==b&&n.use!==false).forEach(n=>{
    const touches=side==='min'?Math.abs((axis==='x'?n.xmax:n.ymax)-(axis==='x'?b.xmin:b.ymin))<.7:
                              Math.abs((axis==='x'?n.xmin:n.ymin)-(axis==='x'?b.xmax:b.ymax))<.7;
    const nlo=axis==='x'?n.ymin:n.xmin,nhi=axis==='x'?n.ymax:n.xmax,over=Math.max(0,Math.min(hi,nhi)-Math.max(lo,nlo));
    if(touches&&over/width>=.8)zMin=Math.max(zMin,+n.h||0);
  });
  return {axis,side,edge,cols:list,spans,total:+spans.reduce((a,c)=>a+c,0).toFixed(4),zMin:+zMin.toFixed(3),exposed:zMin<b.h-.05};
}
function wind4BuildFaces(blocks){
  const out=[];
  blocks.filter(b=>b.cls!=='lattice').forEach(b=>WIND_FACES.forEach(f=>{
    const fc=wind4FaceForBlock(b,f.axis,f.side,blocks);if(!fc)return;
    out.push({...f,key:b.id+'|'+f.wind,blockId:b.id,face:fc,use:fc.exposed,
      /* FRAME LOADS 的受風寬以實際外牆柱列端點為準；屋簷／陽台外挑不應平白加到端柱分攤。 */
      B:fc.total});
  }));
  return out;
}

function wind4Draft(){
  const base=wind4BaseZ(),hs=wind4Heights(),R=wind4Roofs(),cols=windColumns(),
        xs=cols.map(c=>c.x),ys=cols.map(c=>c.y);
  const B=wind4Blocks();
  const faces=wind4BuildFaces(B.blocks);
  return {baseZ:base.z,baseSrc:base.src,active:'',
    bx:+(Math.max(...xs)-Math.min(...xs)).toFixed(3),by:+(Math.max(...ys)-Math.min(...ys)).toFixed(3),
    heights:hs,h:hs.length?hs[0].h:0,hAck:false,roofs:R,roofPick:R.groups.length?R.groups[0].id:'',
    blocks:B.blocks,minorCandidates:B.minorBlocks||[],blockInfo:B,faces};
}
function wind4Open(){
  if(!model||!model.frames?.length){alert('請先載入主 S2K 模型');return}
  if(!windColumns().length){alert('模型中找不到符合條件的柱（兩端高差>0.5 m 且水平位移<0.05 m）');return}
  if(WIND4.project&&WIND4.project.source?.fileName===currentS2KFileName&&(!WIND4.project.source?.text||WIND4.project.source.text===currentS2KText)){
    const p=WIND4.project,base=wind4Draft(),saved=new Map((p.faces||[]).map(f=>[f.key||f.blockId+'|'+f.wind,f])),blocks=JSON.parse(JSON.stringify(p.blocks||[]));
    blocks.forEach(b=>{const fresh=base.blocks.find(x=>x.id===b.id);
      if(!Array.isArray(b.openings))b.openings=[0,0,0,0,0];if(!b.roofType)b.roofType=b.tilt>=1?'mono':'flat';if(!b.enclosure)b.enclosure=b.cls==='closed'?'closed':'open';
      if(!Number.isFinite(+b.slopeX))b.slopeX=+fresh?.slopeX||0;if(!Number.isFinite(+b.slopeY))b.slopeY=+fresh?.slopeY||0});
    base.minorCandidates=(base.minorCandidates||[]).filter(c=>!blocks.some(b=>(c.faceIds||[]).some(id=>(b.faceIds||[]).includes(id))));
    const faces=wind4BuildFaces(blocks);faces.forEach(f=>{const s=saved.get(f.key);if(s){f.use=s.use!==false;f.spansOverride=(s.spans||[]).join(',')}});
    WIND4.draft={...base,name:p.name,baseZ:p.baseZ,active:p.active||'',blocks,faces};
  }else WIND4.draft=wind4Draft();
  WIND4.step=1;WIND4.profiles=null;WIND4.result=null;WIND4.split=null;
  WIND4.preview={view:'plan',focus:'',columns:false,faces:false};
  const d=$('wind4-dialog');d.showModal();wind4Render();
}
/* 左側預覽：先看彩色量體；點一個量體後才顯示它的四面，避免多棟箭頭互相遮蓋。 */
function wind4Preview(){
  const d=WIND4.draft,bs=d.blocks||[],cols=windColumns(),pv=WIND4.preview||(WIND4.preview={view:'plan',focus:'',columns:false,faces:false});
  if(!bs.length)return '<div class="v300-preview-bar"><b>量體預覽</b></div>';
  if(pv.focus&&!bs.some(b=>b.id===pv.focus))pv.focus='';
  const pal=['#38bdf8','#a78bfa','#34d399','#fb7185','#fbbf24','#22d3ee','#f97316','#c084fc'],
        colorOf=b=>pal[Math.max(0,bs.indexOf(b))%pal.length],focus=bs.find(b=>b.id===pv.focus),
        W=760,H=560,padL=70,padR=34,padT=42,padB=58,
        allX=bs.flatMap(b=>[b.xmin,b.xmax]).concat(cols.map(c=>c.x)),allY=bs.flatMap(b=>[b.ymin,b.ymax]).concat(cols.map(c=>c.y)),
        x0=Math.min(...allX),x1=Math.max(...allX),y0=Math.min(...allY),y1=Math.max(...allY),
        cls=b=>({closed:'一般建築物・'+({closed:'封閉',partial:'部分封閉',open:'開放'}[b.enclosure]||b.enclosure),openRoof:'開放式建築物',lattice:'格子構架／桁架',pent:'屋頂突出物'}[b.cls]||b.cls),
        esc=v=>v300Esc(String(v??'')),dim=(v,n=1)=>Number.isFinite(+v)?(+v).toFixed(n):'—';
  const btn=(key,label)=>'<button type="button" class="v300-btn" data-w4view="'+key+'" style="font-size:.65rem;padding:3px 8px;'+(pv.view===key?'border-color:#60a5fa;color:#bfdbfe;background:#17365f':'')+'">'+label+'</button>';
  let g=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="量體幾何預覽"><rect width="${W}" height="${H}" fill="#0c1627"/>`;
  if(pv.view==='plan'){
    const sc=Math.min((W-padL-padR)/Math.max(x1-x0,.001),(H-padT-padB)/Math.max(y1-y0,.001)),
          ox=padL+((W-padL-padR)-(x1-x0)*sc)/2,oy=padT+((H-padT-padB)-(y1-y0)*sc)/2,
          sx=v=>ox+(v-x0)*sc,sy=v=>oy+(y1-v)*sc;
    [...new Set(cols.map(c=>c.x))].sort((a,b)=>a-b).forEach(v=>g+=`<line x1="${sx(v)}" y1="${sy(y0)}" x2="${sx(v)}" y2="${sy(y1)}" stroke="#1e3048" stroke-width="1"/>`);
    [...new Set(cols.map(c=>c.y))].sort((a,b)=>a-b).forEach(v=>g+=`<line x1="${sx(x0)}" y1="${sy(v)}" x2="${sx(x1)}" y2="${sy(v)}" stroke="#1e3048" stroke-width="1"/>`);
    bs.slice().sort((a,b)=>b.plan-a.plan).forEach(b=>{
      const c=colorOf(b),on=!focus||focus===b,selected=focus===b,x=sx(b.xmin),y=sy(b.ymax),w=Math.max(2,(b.xmax-b.xmin)*sc),h=Math.max(2,(b.ymax-b.ymin)*sc),cx=x+w/2,cy=y+h/2,
            gx=+b.slopeX||0,gy=+b.slopeY||0,gl=Math.hypot(gx,gy),ux=gl?gx/gl:0,uy=gl?gy/gl:0,
            alongX=Math.abs(gx)>=Math.abs(gy),al=Math.min(Math.max(12,(alongX?w:h)*.22),36),
            acx=alongX?cx:x+w-Math.min(18,w*.18),acy=alongX?y+Math.min(18,h*.18):cy,
            hx=acx+ux*al,hy=acy-uy*al,lx=acx-ux*al,ly=acy+uy*al,
            roofArrow=b.tilt>=.5&&gl>1e-5?`<line x1="${hx}" y1="${hy}" x2="${lx}" y2="${ly}" stroke="#fbbf24" stroke-width="3" marker-end="url(#w4roof)"/><text x="${hx}" y="${hy-5}" text-anchor="middle" fill="#fff" font-size="9">H</text><text x="${lx}" y="${ly+11}" text-anchor="middle" fill="#fff" font-size="9">L</text>`:'';
      g+=`<g data-w4pv-block="${esc(b.id)}" style="cursor:pointer"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}" fill-opacity="${selected?.42:on?.25:.06}" stroke="${selected?'#fff':c}" stroke-opacity="${on?1:.28}" stroke-width="${selected?4:2}"/>`
        +`<text x="${cx}" y="${cy-12}" text-anchor="middle" fill="${on?'#f8fafc':'#64748b'}" font-size="${selected?17:15}" font-weight="900" paint-order="stroke" stroke="#0c1627" stroke-width="4"><tspan>${esc(b.id)}</tspan>`
        +`<tspan x="${cx}" dy="18" font-size="11" font-weight="700">h=${dim(b.h,2)}m · θ=${dim(b.tilt,1)}°</tspan><tspan x="${cx}" dy="15" font-size="10">${esc(cls(b))}</tspan></text>${roofArrow}</g>`;
    });
    if(WIND4.step===1)(d.minorCandidates||[]).forEach(c=>{const x=sx(c.xmin),y=sy(c.ymax),w=Math.max(3,(c.xmax-c.xmin)*sc),h=Math.max(3,(c.ymax-c.ymin)*sc);
      g+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#f59e0b" fill-opacity=".12" stroke="#f59e0b" stroke-width="3" stroke-dasharray="7 5"/><text x="${x+w/2}" y="${y+h/2-2}" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="900" paint-order="stroke" stroke="#0c1627" stroke-width="3">${esc(c.id)} 排除候選<tspan x="${x+w/2}" dy="14" font-size="9">${dim(c.size,1)} m²・可重新加入</tspan></text>`;
    });
    /* 平面無法顯示高度分段，故用橘色單獨表示「下段遮蔽、zMin 以上仍載重」。聚焦後只畫該量體，不讓共用邊的兩棟顏色重疊。 */
    if(WIND4.step===3)(focus?d.faces.filter(f=>f.blockId===focus.id):d.faces).forEach(f=>{const b=bs.find(x=>x.id===f.blockId);if(!b)return;
      const blocked=!f.face.exposed,partial=f.use!==false&&f.face.zMin>.05,
            col=blocked?'#ef4444':f.use===false?'#64748b':partial?'#f59e0b':'#22c55e',dash=blocked||f.use===false?' stroke-dasharray="7 5"':'';let xa,ya,xb,yb;
      if(f.axis==='x'){xa=xb=sx(f.side==='min'?b.xmin:b.xmax);ya=sy(b.ymin);yb=sy(b.ymax)}
      else{ya=yb=sy(f.side==='min'?b.ymin:b.ymax);xa=sx(b.xmin);xb=sx(b.xmax)}
      g+=`<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${col}" stroke-width="7" stroke-opacity=".95"${dash}/>`;
    });
    if(pv.columns){
      const shown=focus?cols.filter(c=>c.x>=focus.xmin-.65&&c.x<=focus.xmax+.65&&c.y>=focus.ymin-.65&&c.y<=focus.ymax+.65):cols;
      shown.forEach(c=>g+=`<circle cx="${sx(c.x)}" cy="${sy(c.y)}" r="3.2" fill="#e2e8f0" fill-opacity=".8" stroke="#0c1627" stroke-width="1"/>`);
    }
    /* 圖上分割：只給模型已有的 X/Y 柱線，點虛線即切，不再要求使用者猜座標。 */
    if(WIND4.split){const b=bs.find(x=>x.id===WIND4.split.id);if(b){
      const inside=cols.filter(c=>c.x>=b.xmin-.65&&c.x<=b.xmax+.65&&c.y>=b.ymin-.65&&c.y<=b.ymax+.65),
            xs=[...new Set(inside.map(c=>+c.x.toFixed(6)))].filter(v=>v>b.xmin+.05&&v<b.xmax-.05).sort((a,b)=>a-b),
            ys=[...new Set(inside.map(c=>+c.y.toFixed(6)))].filter(v=>v>b.ymin+.05&&v<b.ymax-.05).sort((a,b)=>a-b);
      xs.forEach(v=>g+=`<g data-w4cut="${esc(b.id)}" data-axis="X" data-value="${v}" style="cursor:pointer"><line x1="${sx(v)}" y1="${sy(b.ymin)}" x2="${sx(v)}" y2="${sy(b.ymax)}" stroke="#22d3ee" stroke-width="4" stroke-dasharray="8 5"/><rect x="${sx(v)-23}" y="${sy(b.ymax)-20}" width="46" height="16" rx="4" fill="#083344"/><text x="${sx(v)}" y="${sy(b.ymax)-8}" fill="#67e8f9" font-size="9" font-weight="900" text-anchor="middle">X=${dim(v,2)}</text></g>`);
      ys.forEach(v=>g+=`<g data-w4cut="${esc(b.id)}" data-axis="Y" data-value="${v}" style="cursor:pointer"><line x1="${sx(b.xmin)}" y1="${sy(v)}" x2="${sx(b.xmax)}" y2="${sy(v)}" stroke="#f59e0b" stroke-width="4" stroke-dasharray="8 5"/><rect x="${sx(b.xmin)+3}" y="${sy(v)-14}" width="46" height="16" rx="4" fill="#451a03"/><text x="${sx(b.xmin)+26}" y="${sy(v)-2}" fill="#fbbf24" font-size="9" font-weight="900" text-anchor="middle">Y=${dim(v,2)}</text></g>`);
      if(!xs.length&&!ys.length)g+=`<text x="${W/2}" y="${H-36}" text-anchor="middle" fill="#fbbf24" font-size="12">量體內沒有可用的 X/Y 柱線</text>`;
    }}
    if(focus&&pv.faces)d.faces.filter(f=>f.blockId===focus.id).forEach(f=>{
      const on=f.use!==false,col=on?'#f59e0b':'#64748b',cl=f.face.cols;if(!cl?.length)return;
      const mid=(cl[0].coord+cl[cl.length-1].coord)/2,off=38;let ax,ay,bx2,by2,tx,ty;
      if(f.axis==='x'){const e=sx(f.face.edge),m=sy(mid),s2=f.side==='min'?-1:1;ax=e+s2*off;ay=m;bx2=e+s2*8;by2=m;tx=ax;ty=ay-9}
      else{const e=sy(f.face.edge),m=sx(mid),s2=f.side==='min'?1:-1;ax=m;ay=e+s2*off;bx2=m;by2=e+s2*8;tx=ax+4;ty=ay-7}
      g+=`<line x1="${ax}" y1="${ay}" x2="${bx2}" y2="${by2}" stroke="${col}" stroke-width="3" marker-end="url(#w4a)"/><text x="${tx}" y="${ty}" fill="${col}" font-size="11" font-weight="900" text-anchor="middle" paint-order="stroke" stroke="#0c1627" stroke-width="3">${esc(f.wind)}</text>`;
    });
    g+=`<text x="${sx(x0)}" y="${H-22}" fill="#94a3b8" font-size="11">X ${dim(x0)} → ${dim(x1)} m</text><text x="18" y="${sy(y0)}" fill="#94a3b8" font-size="11" transform="rotate(-90 18 ${sy(y0)})">Y ${dim(y0)} → ${dim(y1)} m</text>`;
  }else{
    const axis=pv.view==='x'?'x':'y',lo=axis==='x'?x0:y0,hi=axis==='x'?x1:y1,z1=Math.max(...bs.map(b=>Math.max(+b.ridge||0,+b.h||0)),1)*1.08,
          sx=v=>padL+(v-lo)*(W-padL-padR)/Math.max(hi-lo,.001),sz=v=>H-padB-v*(H-padT-padB)/z1,step=Math.max(1,Math.ceil(z1/6));
    for(let z=0;z<=z1;z+=step)g+=`<line x1="${padL}" y1="${sz(z)}" x2="${W-padR}" y2="${sz(z)}" stroke="#1e3048"/><text x="${padL-8}" y="${sz(z)+4}" text-anchor="end" fill="#64748b" font-size="10">${z}m</text>`;
    bs.slice().sort((a,b)=>b.plan-a.plan).forEach(b=>{
      const c=colorOf(b),on=!focus||focus===b,selected=focus===b,a=axis==='x'?b.xmin:b.ymin,z=axis==='x'?b.xmax:b.ymax,
            x=sx(a),w=Math.max(3,sx(z)-x),bot=sz(0),grad=axis==='x'?(+b.slopeX||0):(+b.slopeY||0),visible=b.tilt>=.5&&Math.abs(grad)>1e-5,
            zL=b.roofType==='gable'?b.eave:visible?(grad>0?b.eave:b.ridge):b.eave,
            zR=b.roofType==='gable'?b.eave:visible?(grad>0?b.ridge:b.eave):b.eave,
            roof=b.roofType==='gable'?`L ${x+w/2} ${sz(b.ridge)} L ${x+w} ${sz(zR)}`:`L ${x+w} ${sz(zR)}`,
            path=`M ${x} ${bot} L ${x} ${sz(zL)} ${roof} L ${x+w} ${bot} Z`,roofY=Math.min(sz(zL),sz(zR),b.roofType==='gable'?sz(b.ridge):999),
            hiX=grad>=0?x+w:x,loX=grad>=0?x:x+w;
      g+=`<g data-w4pv-block="${esc(b.id)}" style="cursor:pointer"><path d="${path}" fill="${c}" fill-opacity="${selected?.38:on?.22:.05}" stroke="${selected?'#fff':c}" stroke-opacity="${on?1:.25}" stroke-width="${selected?4:2}"/>`
        +`<line x1="${x}" y1="${sz(b.h)}" x2="${x+w}" y2="${sz(b.h)}" stroke="${c}" stroke-dasharray="5 4" stroke-opacity="${on?.75:.15}"/>`
        +(visible&&b.roofType!=='gable'?`<line x1="${hiX}" y1="${sz(b.ridge)-6}" x2="${loX}" y2="${sz(b.eave)-6}" stroke="#fbbf24" stroke-width="3" marker-end="url(#w4roof)"/><text x="${hiX}" y="${sz(b.ridge)-11}" text-anchor="middle" fill="#fff" font-size="10">高端 ${dim(b.ridge,2)}</text><text x="${loX}" y="${sz(b.eave)+17}" text-anchor="middle" fill="#fff" font-size="10">低端 ${dim(b.eave,2)}</text>`:'')
        +`<text x="${x+w/2}" y="${Math.max(roofY+25,25)}" text-anchor="middle" fill="${on?'#f8fafc':'#64748b'}" font-size="12" font-weight="900" paint-order="stroke" stroke="#0c1627" stroke-width="4">${esc(b.id)} · h=${dim(b.h,2)}m · θ=${dim(b.tilt,1)}°</text>`
        +(b.tilt>=.5&&!visible?`<text x="${x+w/2}" y="${Math.max(roofY+41,40)}" text-anchor="middle" fill="#fbbf24" font-size="9">此向看不到斜度，請切換 ${axis==='x'?'Y':'X'} 立面</text>`:'')+'</g>';
    });
    /* 立面把遮蔽高度真正畫出來：紅虛線僅到 zMin，zMin 以上依勾選狀態畫綠色或灰色。 */
    if(WIND4.step===3)(focus?d.faces.filter(f=>f.blockId===focus.id):d.faces).filter(f=>f.axis===axis).forEach(f=>{
      const b=bs.find(x=>x.id===f.blockId);if(!b)return;const xx=sx(f.face.edge),zCut=Math.max(0,Math.min(+f.face.zMin||0,+b.h||0)),zTop=+b.h||0,
            blocked=!f.face.exposed,topCol=f.use!==false?'#22c55e':'#64748b',topDash=f.use!==false?'':' stroke-dasharray="7 5"';
      if(zCut>.01)g+=`<line x1="${xx}" y1="${sz(0)}" x2="${xx}" y2="${sz(zCut)}" stroke="#ef4444" stroke-width="8" stroke-dasharray="7 5"/>`;
      if(!blocked&&zTop>zCut+.01)g+=`<line x1="${xx}" y1="${sz(zCut)}" x2="${xx}" y2="${sz(zTop)}" stroke="${topCol}" stroke-width="8"${topDash}/>`;
      if(blocked&&zCut<=.01)g+=`<line x1="${xx}" y1="${sz(0)}" x2="${xx}" y2="${sz(zTop)}" stroke="#ef4444" stroke-width="8" stroke-dasharray="7 5"/>`;
      const tx=xx+(f.side==='min'?-9:9),ty=sz(Math.min(zTop,Math.max(zCut,zTop*.55)))-4;
      g+=`<text x="${tx}" y="${ty}" text-anchor="${f.side==='min'?'end':'start'}" fill="${blocked?'#fca5a5':topCol}" font-size="9" font-weight="900" paint-order="stroke" stroke="#0c1627" stroke-width="3">${esc(f.wind)}${zCut>.01?' z≥'+dim(zCut,1):''}</text>`;
    });
    g+=`<line x1="${padL}" y1="${sz(0)}" x2="${W-padR}" y2="${sz(0)}" stroke="#94a3b8" stroke-width="2"/><text x="${padL}" y="${H-22}" fill="#94a3b8" font-size="11">${axis.toUpperCase()} ${dim(lo)} → ${dim(hi)} m</text><text x="18" y="${padT}" fill="#94a3b8" font-size="11" transform="rotate(-90 18 ${padT})">Z 高程（相對基準）</text>`;
  }
  g+='<defs><marker id="w4a" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#f59e0b"/></marker><marker id="w4roof" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#fbbf24"/></marker></defs></svg>';
  const legend=bs.map(b=>'<button type="button" data-w4pv-block="'+esc(b.id)+'" style="border:0;background:transparent;color:'+(pv.focus===b.id?'#fff':'#cbd5e1')+';font-size:.65rem;cursor:pointer;padding:2px 5px"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:'+colorOf(b)+';margin-right:4px"></i>'+esc(b.id)+'</button>').join(''),
        info=focus?'<b>'+esc(focus.id)+'</b>　'+esc(cls(focus))+'　X '+dim(focus.xmin)+'～'+dim(focus.xmax)+' m　Y '+dim(focus.ymin)+'～'+dim(focus.ymax)+' m　h '+dim(focus.h,2)+' m'+(focus.parentId?'　母量體 '+esc(focus.parentId):'')
          :'總覽：點圖中量體或右側表格列以聚焦；聚焦後可單獨檢查四個迎風面。';
  return '<div class="v300-preview-bar" style="gap:5px;flex-wrap:wrap"><b>量體幾何</b>'+btn('plan','平面')+btn('x','X 立面')+btn('y','Y 立面')
    +'<button type="button" class="v300-btn" data-w4pv-all style="font-size:.65rem;padding:3px 8px;'+(!focus?'border-color:#60a5fa;color:#bfdbfe':'')+'">全部量體</button>'
    +'<button type="button" class="v300-btn" data-w4toggle="columns" style="font-size:.65rem;padding:3px 8px;'+(pv.columns?'color:#bfdbfe':'opacity:.55')+'">柱點</button>'
    +'<button type="button" class="v300-btn" data-w4toggle="faces" '+(!focus||pv.view!=='plan'?'disabled title="請在平面圖先點選一個量體"':'')+' style="font-size:.65rem;padding:3px 8px;'+(pv.faces?'color:#fbbf24':'opacity:.55')+'">四面箭頭</button>'
    +(WIND4.split?'<button type="button" class="v300-btn" data-w4split-cancel style="font-size:.65rem;padding:3px 8px;color:#fca5a5">取消圖上分割</button>':'')+'</div>'
    +'<div class="v300-svg-wrap">'+g+'</div><div style="padding:7px 10px;background:#111c2d;border-top:1px solid #26364c;color:#cbd5e1;font-size:.68rem;line-height:1.55">'
    +'<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">'+legend+(WIND4.step===3?'<span style="margin-left:8px;color:#22c55e">● 全高載重</span><span style="color:#f59e0b">● 遮蔽以上載重</span><span style="color:#ef4444">┄ 全遮蔽</span><span style="color:#94a3b8">┄ 手動取消</span>':'')+'</div><div>'
    +(WIND4.split?'<b style="color:#67e8f9">圖上分割：點選青色 X 柱線或橘色 Y 柱線。</b>':info)+'</div></div>';
}
function wind4Guide(step){
  const d=WIND4.draft||{},bs=d.blocks||[],faces=d.faces||[],enc={closed:'封閉',partial:'部分封閉',open:'開放'},
        box=(title,items,color)=>'<div style="flex:1;min-width:230px;border-left:3px solid '+color+';background:rgba(15,30,48,.72);padding:8px 10px;border-radius:6px"><b>'+title+'</b><div style="margin-top:4px;line-height:1.55">'+items.map(x=>'・'+x).join('<br>')+'</div></div>';
  let a=[],b=[];
  if(step===1){
    a=['彩色平面是否與實際建築分棟一致；相連但不同高度者仍應分棟','切換 X／Y 立面，確認各量體位置、h、簷高／脊高及屋突歸屬','分類欄是「計算對象大類」；一般建築物的實際封閉性在步驟 2 確認'];
    b=['少切：勾選「編輯」後按合併；多切：按「圖上分割」，直接點青色 X 或橘色 Y 柱線','分類錯誤可下拉改；h、θ 可直接覆寫；立面圖會標出屋頂高端、低端與下坡箭頭','WTB 應有 4 個主量體，另有左上 7.8 m² 戶外樓梯平台出現在「排除候選」，可手動加入為格子構架'];
  }else if(step===2){
    a=['樓層 z 是相對基準面，應由 0 排到該量體 h，不能混入更高棟或屋突樓層','確認屋頂型式、封閉／部分封閉／開放、女兒牆高度','封閉式的五個開口面積通常為 0；部分封閉／開放須輸入實際開口面積供工作區依規範判定'];
    b=['樓層可直接改名稱與 z，或新增、刪除、重設為 Z 格線','屋型、封閉性、女兒牆及五面開口面積均可在每個量體標題下調整','若只知道分類、不知道開口面積，不要猜；先保留封閉並在取得建築開口資料後更新'];
  }else if(step===3){
    a=['每個量體最多四面；共用牆低棟應停用，高棟只計相鄰屋頂以上的露出段','柱距筆數應等於柱線數減 1，ΣB 必須等於該面受風寬','確認 LoadPat 與風向：WX+／WX-／WY+／WY- 沒有左右顛倒'];
    b=['不產生的外牆取消勾選；綠＝全高載重、橘＝遮蔽高度以上仍載重、紅虛＝整面遮蔽、灰虛＝手動取消','柱距可直接改逗號序列，直到筆數及 ΣB 顯示 ✓','平面用橘色表示部分遮蔽；切到 X／Y 立面後可直接看紅色下段與綠色上段的分界高度'];
  }else{
    const first=bs.find(x=>x.use!==false&&x.cls==='closed')||bs.find(x=>x.use!==false);
    a=['待補項目必須為 0，並核對量體、迎風面及樓層總數','逐量體複查 h、θ、封閉性與屋突母量體','建立後工作區上方必須顯示目前量體，而非整棟包絡'];
    b=['有缺漏可按「前往步驟」直接跳回修正','進入工作區後用上方量體選單逐棟切換；尺寸、h、分類須與本精靈一致','目前預設先送入 '+(first?first.id:'第一個量體')+'；若仍看到整棟柱數或整棟尺寸，表示幾何尚未成功套用，不應開始計算'];
  }
  const detected=step===2&&bs.length?'<div style="margin-top:6px;color:#94a3b8">目前封閉性：'+bs.filter(x=>x.use!==false).map(x=>x.id+'＝'+(enc[x.enclosure]||x.enclosure)).join('、')+'</div>':'';
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;font-size:.68rem">'+box('本頁要確認',a,'#38bdf8')+box('發現不對時怎麼調',b,'#f59e0b')+'</div>'+detected;
}
function wind4Step1(){
  const d=WIND4.draft,B=d.blockInfo,bs=d.blocks,minors=d.minorCandidates||[];
  let h='<h3>1. 量體辨識</h3>'+wind4Guide(1)
    +'<div class="v300-note">屋面依「<b>傾角＋傾斜朝向＋高程</b>」分群 → 每群一個量體。'
    +'加入屋面法向方位才分得開反向的單斜屋頂（WTB 高棟與低棟法向相反，只看傾角會被併成一群）；圖上黃色箭頭則直接由高端指向低端。<br>'
    +'排除：正上方有面覆蓋者判為樓版（'+B.slabs+' 片）、群總面積不到總屋面積 2% 者先放入「排除候選」（待複核 '+minors.length+' 群、'+B.minorArea+' m²），不再直接丟掉。</div>'
    +'<div class="v300-kpis"><div class="v300-kpi"><b>'+bs.length+'</b><span>量體</span></div>'
    +'<div class="v300-kpi"><b>'+windColumns().length+'</b><span>柱段</span></div>'
    +'<div class="v300-kpi"><b>'+B.walls+'</b><span>牆面元素</span></div>'
    +'<div class="v300-kpi"><b>'+d.baseZ.toFixed(2)+'</b><span>基準 z (m)</span></div></div>'
    +'<div class="v300-note '+(Math.abs(d.baseZ)>1e-9?'warn':'ok')+'">基準來源：'+v300Esc(d.baseSrc)
    +'；已排除 '+(B.dummy||0)+' 片明確標為 NONE／DUMMY 的虛擬面。</div>'
    +(minors.length?'<div class="v300-note warn"><b>排除候選（尚未納入計算）</b><br>'
      +'判斷原則：若是戶外樓梯平台、開放鉄梯或支撐構架，周邊無連續封閉外牆，應納入為<b>格子構架／開放構件</b>，不應當成實心建築物外牆。若實際為封閉樓梯間，才選一般建築物。'
      +'<div class="v300-table-wrap" style="margin-top:7px"><table class="v300-table"><thead><tr><th>候選</th><th>平面位置</th><th>高程</th><th>面積／柱</th><th>操作</th></tr></thead><tbody>'
      +minors.map(c=>'<tr><td><b>'+c.id+'</b></td><td>X '+c.xmin.toFixed(2)+'～'+c.xmax.toFixed(2)+'<br>Y '+c.ymin.toFixed(2)+'～'+c.ymax.toFixed(2)+'</td>'
        +'<td>相對 z '+c.eave.toFixed(2)+' m<br>模型 z '+(c.eave+d.baseZ).toFixed(2)+' m</td><td>'+c.size.toFixed(1)+' m²／'+c.nCols+' 柱</td>'
        +'<td><button class="v300-btn" data-w4minor-add="'+c.id+'" data-cls="lattice" style="font-size:.65rem;padding:3px 7px">加入為格子構架</button> '
        +'<button class="v300-btn" data-w4minor-add="'+c.id+'" data-cls="closed" style="font-size:.65rem;padding:3px 7px">加入為一般建築</button></td></tr>').join('')
      +'</tbody></table></div><span style="color:#fbbf24">格子構架會保存在專案中，但不會誤用四面實心外牆 FRAME LOADS；其風力應另依構件投影面積 A<sub>f</sub> 與 C<sub>f</sub> 處理。</span></div>':'');
  if(!bs.length)return h+'<div class="v300-note warn">模型沒有可辨識的屋面元素，無法自動切量體。'
    +'屋頂若只由桿件構成（如純管架），請等 V4.16.0 的格子構架路徑。</div>';
  h+='<div style="display:flex;gap:7px;margin:8px 0"><button class="v300-btn" id="wind4-merge">合併勾選量體</button>'
    +'<span style="font-size:.65rem;color:var(--dim);padding-top:5px">「編輯」勾選至少兩個；圖上分割會列出量體內現有的 X／Y 柱線，點線即完成。</span></div>'
    +'<div class="v300-table-wrap"><table class="v300-table"><thead><tr><th>計算</th><th>編輯</th><th>量體</th><th>分類／屋突歸屬</th>'
    +'<th>θ (°)</th><th>簷高</th><th>脊高</th><th>採用 h</th><th>平面 (m²)</th><th>柱</th><th>牆面比</th></tr></thead><tbody>'
    +bs.map(b=>{const C=W4_CLS[b.cls]||{t:b.cls,d:''},hot=WIND4.preview?.focus===b.id,
      gx=+b.slopeX||0,gy=+b.slopeY||0,major=Math.abs(gx)>=Math.abs(gy)?'X':'Y',gv=major==='X'?gx:gy,
      roofDir=major+(gv>=0?'+':'-')+' 高 → '+major+(gv>=0?'-':'+')+' 低';
      return '<tr data-w4row="'+b.id+'" title="點此列可在左圖聚焦 '+b.id+'" style="cursor:pointer;'+(hot?'background:rgba(96,165,250,.13);box-shadow:inset 3px 0 #60a5fa':'')+'"><td><input type="checkbox" data-w4b="'+b.id+'" '+(b.use?'checked':'')+'></td>'
      +'<td><input type="checkbox" data-w4sel="'+b.id+'" '+(b.editSelected?'checked':'')+'><br><button class="v300-btn" data-w4split="'+b.id+'" style="font-size:.62rem;padding:2px 6px">圖上分割</button></td>'
      +'<td><b>'+b.id+'</b><br><span style="font-size:.62rem;color:var(--dim)">'+b.n+' 片／'+b.size+' m²</span></td>'
      +'<td><select data-w4bf="cls" data-id="'+b.id+'" style="width:150px">'
      +Object.keys(W4_CLS).map(k=>'<option value="'+k+'"'+(k===b.cls?' selected':'')+'>'+W4_CLS[k].t+'</option>').join('')
      +'</select><br><select data-w4bf="parentId" data-id="'+b.id+'" style="width:150px;margin-top:3px"><option value="">無母量體</option>'
      +bs.filter(p=>p!==b&&p.plan>b.plan).map(p=>'<option value="'+p.id+'"'+(p.id===b.parentId?' selected':'')+'>歸屬 '+p.id+'</option>').join('')
      +'</select><br><span style="font-size:.62rem;color:var(--dim)">'+C.d+'</span></td>'
      +'<td><input type="number" step="0.01" style="width:64px" data-w4bf="tilt" data-id="'+b.id+'" value="'+b.tilt.toFixed(2)+'">'
      +(b.tilt>=1?'<br><span style="font-size:.62rem;color:#fbbf24">'+roofDir+'</span>':'')+'</td>'
      +'<td>'+b.eave.toFixed(2)+'</td><td>'+b.ridge.toFixed(2)+'</td>'
      +'<td><input type="number" step="0.01" style="width:74px" data-w4bf="h" data-id="'+b.id+'" value="'+b.h.toFixed(2)+'">'
      +'<br><span style="font-size:.62rem;color:var(--dim)">'+(b.hManual?'手動指定':(b.useEave?'θ&lt;10°→簷高':'平均屋頂高'))+'</span></td>'
      +'<td>'+b.plan.toFixed(0)+'</td><td>'+b.nCols+'</td>'
      +'<td>'+(b.wallRatio*100).toFixed(0)+'%</td></tr>'}).join('')
    +'</tbody></table></div>'
    +'<div class="v300-note">θ 與 h 可直接改（自動值算錯時覆蓋它）；分類也可下拉調整。'
    +'採用 h 依規範符號表：<b>斜角 &lt;10° 以簷高代替，≥10° 用平均屋頂高</b>。'
    +'（V4.15.2 以前一律取平均，對 θ&lt;10° 的廠房會高估 h。）<br>'
    +'標為<b>屋突</b>者：平面積不到最大量體 30%、且簷高已在其屋頂之上。規範符號表明訂「建築物高度<b>不含屋頂突出物</b>」，'
    +'所以主量體的 h 不會算到屋突，屋突另依表2.12 計算（V4.16.0）。</div>';
  return h;
}
function wind4Step2(){
  const d=WIND4.draft,picked=d.blocks.filter(b=>b.use);
  if(!picked.length)return '<h3>2. 各量體參數</h3><div class="v300-note warn">步驟 1 未勾選任何可計算的量體。</div>';
  let h='<h3>2. 各量體參數與樓層</h3>'+wind4Guide(2)
    +'<div class="v300-note">樓層決定風壓剖線 q(z) 在哪些高程取值，也決定台電下限的分層判定。'
    +'預設取模型 Z 格線中<b>不超過該量體 h</b> 者——高過屋頂的屋突層不會混進來。'
    +'數值可直接改、可刪除、可新增。</div>';
  picked.forEach(b=>{
    const lv=wind4Levels(b),op=Array.isArray(b.openings)?b.openings:[0,0,0,0,0],opNames=['X−面','X＋面','Y−面','Y＋面','屋頂'],
          suspect=lv.filter(x=>/^(tos|bos|el)?[+\-]?\d+(?:\.\d+)?$/i.test(String(x[0]).replace(/\s/g,''))||/^tos/i.test(String(x[0])));
    h+='<h3 style="margin-top:14px;font-size:.86rem">'+b.id+'　'+(W4_CLS[b.cls]||{}).t
      +'　<span style="font-weight:400;color:var(--dim)">h='+b.h.toFixed(2)+' m、θ='+b.tilt.toFixed(2)+'°</span>'
      +'　<label style="font-weight:400">屋頂型式 <select data-w4bf="roofType" data-id="'+b.id+'"><option value="flat"'+(b.roofType==='flat'?' selected':'')+'>平屋頂</option><option value="mono"'+(b.roofType==='mono'?' selected':'')+'>單斜</option><option value="gable"'+(b.roofType==='gable'?' selected':'')+'>雙斜</option></select></label>'
      +'　<label style="font-weight:400">封閉性 <select data-w4bf="enclosure" data-id="'+b.id+'" '+(b.cls==='closed'?'':'disabled')+'><option value="closed"'+(b.enclosure==='closed'?' selected':'')+'>封閉</option><option value="partial"'+(b.enclosure==='partial'?' selected':'')+'>部分封閉</option>'+(b.cls==='closed'?'':'<option value="open" selected>開放（由分類決定）</option>')+'</select></label>'
      +'　<label style="font-weight:400">女兒牆 <input type="number" min="0" step="0.05" data-w4bf="parapet" data-id="'+b.id+'" value="'+(+b.parapet||0).toFixed(2)+'" style="width:66px"> m</label>'
      +'　<button class="v300-btn" data-w4lv-add="'+b.id+'" style="font-size:.66rem;padding:3px 8px">新增樓層</button>'
      +'　<button class="v300-btn" data-w4lv-reset="'+b.id+'" style="font-size:.66rem;padding:3px 8px">重設為 Z 格線</button></h3>'
      +'<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:4px 0 7px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:rgba(15,30,48,.45);font-size:.65rem"><b>外殼開口面積 A₀ (m²)</b>'
      +opNames.map((n,i)=>'<label>'+n+' <input type="number" min="0" step="0.1" data-w4op="'+i+'" data-id="'+b.id+'" value="'+(+op[i]||0).toFixed(2)+'" style="width:68px"></label>').join('')
      +'<span style="color:var(--dim)">封閉式通常全為 0；部分封閉請填實際開口，工作區會依 §1.3／表2.17 重判。</span></div>'
      +(suspect.length?'<div class="v300-note warn"><b>樓層名稱需人工確認：</b>'+suspect.map(x=>v300Esc(x[0])+'（z='+x[1]+' m）').join('、')+' 看起來可能是 TOS／構架／屋面標高。若不是樓層或風力分段作用點，請刪除；若是操作平台則可保留。</div>':'')
      +(lv.length?'<div class="v300-table-wrap" style="max-height:24vh"><table class="v300-table"><thead><tr><th>樓層</th><th>z (m)</th><th></th></tr></thead><tbody>'
        +lv.map((x,i)=>'<tr><td><input style="width:88px" data-w4lv="name" data-id="'+b.id+'" data-i="'+i+'" value="'+v300Esc(x[0])+'"></td>'
          +'<td><input type="number" step="0.01" style="width:88px" data-w4lv="z" data-id="'+b.id+'" data-i="'+i+'" value="'+(+x[1]).toFixed(3)+'"></td>'
          +'<td><button class="v300-btn" data-w4lv-del="'+b.id+'" data-i="'+i+'" style="font-size:.66rem;padding:2px 7px">刪</button></td></tr>').join('')
        +'</tbody></table></div>'
       :'<div class="v300-note warn">此量體沒有樓層；風壓剖線將只有 0 與 h 兩點。可按「新增樓層」補。</div>');
  });
  return h;
}
function wind4Step3(){
  const d=WIND4.draft;
  return '<h3>3. 四個迎風面與柱距</h3>'+wind4Guide(3)+'<div class="v300-note">四面<b>一次全列</b>——兩側外牆柱距常不相同，各風向的迎風面本來就不是同一排。'
    +'勾選的面會在側欄一次產生。各量體使用自己的外緣柱線；共用牆低棟略過，高棟只從相鄰屋頂以上受風。</div>'
    +'<div class="v300-table-wrap"><table class="v300-table"><thead><tr><th>產生</th><th>量體</th><th>迎風面</th><th>LoadPat</th><th>位置／露出起點</th><th>柱線／柱段</th><th>柱距 (m)</th><th>ΣB</th><th>受風寬</th></tr></thead><tbody>'
    +d.faces.map(f=>{const sp=wind4Spans(f),t=sp.reduce((s,v)=>s+v,0),nOk=sp.length===Math.max(0,f.face.cols.length-1),ok=nOk&&Math.abs(t-f.B)<.05;
      const partial=f.face.exposed&&f.face.zMin>.05,rowBg=!f.face.exposed?'rgba(239,68,68,.08)':!f.use?'rgba(100,116,139,.08)':partial?'rgba(245,158,11,.09)':'rgba(34,197,94,.08)',
            state=!f.face.exposed?'<span style="color:#fca5a5">全高遮蔽</span>':!f.use?'<span style="color:#94a3b8">手動取消</span>':partial?'<span style="color:#fbbf24">z 以上載重</span>':'<span style="color:#86efac">全高載重</span>';
      return '<tr style="background:'+rowBg+'"><td><input type="checkbox" data-w4f="'+f.key+'" '+(f.use?'checked':'')+(f.face.exposed?'':' disabled')+'></td>'
      +'<td><b>'+f.blockId+'</b></td><td><b>'+f.wind+'</b></td><td>'+f.pat+'</td><td>'+f.axis+' = '+f.face.edge.toFixed(2)+'<br>z ≥ '+f.face.zMin.toFixed(2)+'　'+state+'</td>'
      +'<td>'+f.face.cols.length+'<span class="v300-derived" style="font-size:.62rem">／'
      +f.face.cols.reduce((a,c)=>a+c.stack.length,0)+' 段</span></td>'
      +'<td><input style="width:100%;min-width:230px;font-size:.66rem" data-w4sp="'+f.key+'" value="'
      +(f.spansOverride||f.face.spans.map(v=>v.toFixed(3)).join(',')).replace(/"/g,'')+'"></td>'
      +'<td class="'+(ok?'v300-derived':'')+'">'+t.toFixed(2)+(ok?' ✓':' <span style="color:#ff6b6b">⚠ '+(nOk?'總長':'筆數')+'</span>')+'</td>'
      +'<td>'+f.B.toFixed(2)+'</td></tr>'}).join('')
    +'</tbody></table></div>';
}
function wind4Step4(){
  const d=WIND4.draft,blocks=d.blocks.filter(b=>b.use),ids=new Set(blocks.map(b=>b.id)),
        faces=d.faces.filter(f=>f.use&&ids.has(f.blockId)),
        unsupported=blocks.filter(b=>b.cls!=='closed');
  const issues=[];
  if(!blocks.length)issues.push({step:1,t:'未勾選任何量體'});
  if(blocks.some(b=>b.cls==='closed')&&!faces.length)issues.push({step:3,t:'封閉式量體未勾選任何迎風面'});
  blocks.forEach(b=>{if(!(b.h>0))issues.push({step:1,t:b.id+' 的建築高度 h 必須大於 0'})});
  blocks.filter(b=>b.cls==='closed'&&b.enclosure==='partial'&&!(b.openings||[]).some(v=>+v>0)).forEach(b=>
    issues.push({step:2,t:b.id+' 選為部分封閉，但五面開口面積仍全為 0'}));
  blocks.filter(b=>b.cls==='pent').forEach(b=>{if(!b.parentId||!blocks.some(p=>p.id===b.parentId))issues.push({step:1,t:b.id+' 是屋突，但尚未指定有效母量體'})});
  faces.forEach(f=>{const sp=wind4Spans(f);
    if(sp.length!==Math.max(0,f.face.cols.length-1))issues.push({step:3,t:f.blockId+' '+f.wind+' 的柱距筆數應為 '+Math.max(0,f.face.cols.length-1)+'，目前為 '+sp.length});
    else if(Math.abs(sp.reduce((s,v)=>s+v,0)-f.B)>.05)issues.push({step:3,t:f.blockId+' '+f.wind+' 的柱距總和與受風寬不符'})});
  return '<h3>4. 確認並建立專案</h3>'+wind4Guide(4)
    +'<div class="v300-form"><div class="v300-field"><label>專案名稱</label>'
    +'<input id="wind4-name" value="'+v300Esc(d.name||('風力-'+(currentS2KFileName||'model').replace(/\.s2k$/i,'')))+'"></div>'
    +'<div class="v300-field"><label>進入工作區先顯示</label><select id="wind4-active">'+blocks.map(b=>'<option value="'+b.id+'"'+((d.active||blocks[0]?.id)===b.id?' selected':'')+'>'+b.id+'・'+(W4_CLS[b.cls]||{}).t+'</option>').join('')+'</select></div>'
    +'<div class="v300-field"><label>狀態</label><div style="padding-top:7px">'
    +'<span class="v300-pill '+(issues.length?'warn':'ok')+'">'+(issues.length?'尚有 '+issues.length+' 項待補':'可建立')+'</span></div></div></div>'
    +'<div class="v300-kpis"><div class="v300-kpi"><b>'+blocks.length+'</b><span>量體</span></div>'
    +'<div class="v300-kpi"><b>'+faces.length+'</b><span>迎風面</span></div>'
    +'<div class="v300-kpi"><b>'+blocks.reduce((s,b)=>s+wind4Levels(b).length,0)+'</b><span>樓層合計</span></div>'
    +'<div class="v300-kpi"><b>'+d.baseZ.toFixed(2)+'</b><span>基準 z (m)</span></div></div>'
    +(issues.length?'<div class="v300-note warn"><b>建立前需補齊：</b><br>'
      +issues.map(x=>'・'+v300Esc(x.t)+'　<button class="v300-btn" data-w4go="'+x.step+'" style="font-size:.66rem;padding:2px 7px">前往步驟 '+x.step+'</button>').join('<br>')+'</div>':'')
    +'<div class="v300-note"><b>將建立的專案內容</b><br>主模型：'+v300Esc(currentS2KFileName||'（未載入）')+'<br>'
    +'量體：'+blocks.map(b=>b.id+'（'+(W4_CLS[b.cls]||{}).t+'，'+({closed:'封閉',partial:'部分封閉',open:'開放'}[b.enclosure]||b.enclosure)
      +'，'+({flat:'平屋頂',mono:'單斜',gable:'雙斜'}[b.roofType]||b.roofType)+'，h='+b.h.toFixed(2)+' m、θ='+b.tilt.toFixed(2)+'°、'+wind4Levels(b).length+' 層）').join('；')+'<br>'
    +'迎風面：'+faces.map(f=>f.blockId+' '+f.wind+'（'+f.pat+'）').join('、')
    +(unsupported.length?'<br><span style="color:#f0a500">'+unsupported.map(b=>b.id+' '+(W4_CLS[b.cls]||{}).t).join('、')
      +' 會保存於專案，但 FRAME LOADS 只允許封閉式量體；其他類型須使用各自規範路徑，避免套錯公式。</span>':'')+'</div>'
    +'<div class="v300-note">按下「建立專案並進入風力分析」後：專案幾何會<b>整包送進耐風工作區</b>'
    +'（建築高度、屋面角度、樓層一次設好），然後開啟工作區。'
    +'你在工作區只需要設定<b>風速、地況、K<sub>zt</sub></b>，並依實際開口資料複核封閉性；'
    +'算完回到側欄按「<b>產生 S2K 載重定義</b>」輸出 FRAME LOADS。</div>'
    +'<div id="wind4-out"></div>';
}

/* 量體的樓層（可被使用者覆寫；未覆寫時用 Z 格線） */
function wind4Levels(b){
  if(Array.isArray(b.levels))return b.levels;
  const base=wind4BaseZ().z;
  return (model?.grids||[]).filter(g=>g.dir==='Z')
    .map(g=>[String(g.id),+(+g.c-base).toFixed(3)])
    .filter(g=>g[1]>=-1e-9&&g[1]<=b.h+.05).sort((x,y)=>x[1]-y[1]);
}
/* 該面採用的柱距（可被使用者覆寫） */
function wind4Spans(f){
  const raw=f.spansOverride;
  if(raw!==undefined&&raw!==null&&String(raw).trim()){
    return String(raw).split(/[,，\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>0);
  }
  return f.face.spans.slice();
}
function wind4NextBlockId(){
  const used=new Set(WIND4.draft.blocks.map(b=>b.id));let i=1;while(used.has('B'+i))i++;return 'B'+i;
}
function wind4AddMinor(id,cls='lattice'){
  const d=WIND4.draft,c=(d.minorCandidates||[]).find(x=>x.id===id);if(!c)return;
  const b=JSON.parse(JSON.stringify(c));b.id=wind4NextBlockId();b.candidate=false;b.cls=cls;b.enclosure=cls==='closed'?'closed':'open';b.use=true;b.editSelected=false;
  d.blocks.push(wind4RefreshBlock(b));d.minorCandidates=d.minorCandidates.filter(x=>x!==c);d.faces=wind4BuildFaces(d.blocks);
  WIND4.preview.focus=b.id;WIND4.preview.view='plan';wind4Render();
}
function wind4RefreshBlock(b){
  b.plan=+((b.xmax-b.xmin)*(b.ymax-b.ymin)).toFixed(1);
  b.nCols=windColumns().filter(c=>c.x>=b.xmin-.6&&c.x<=b.xmax+.6&&c.y>=b.ymin-.6&&c.y<=b.ymax+.6&&
    c.zTop-wind4BaseZ().z>=b.eave-1.5).length;
  return b;
}
function wind4MergeSelected(){
  const d=WIND4.draft,L=d.blocks.filter(b=>b.editSelected);
  if(L.length<2){alert('請在「編輯」欄至少勾選兩個量體。');return}
  const id=wind4NextBlockId(),w=L.reduce((s,b)=>s+Math.max(b.size,1),0);
  const b=wind4RefreshBlock({id,use:L.some(x=>x.use),editSelected:false,
    cls:L.every(x=>x.cls===L[0].cls)?L[0].cls:'closed',enclosure:L[0].enclosure||'closed',parapet:Math.max(...L.map(x=>+x.parapet||0)),
    parentId:'',tilt:+(L.reduce((s,x)=>s+x.tilt*Math.max(x.size,1),0)/w).toFixed(3),azBin:L[0].azBin,
    slopeX:L.reduce((s,x)=>s+(+x.slopeX||0)*Math.max(x.size,1),0)/w,
    slopeY:L.reduce((s,x)=>s+(+x.slopeY||0)*Math.max(x.size,1),0)/w,
    n:L.reduce((s,x)=>s+x.n,0),faceIds:[...new Set(L.flatMap(x=>x.faceIds||[]))],size:+L.reduce((s,x)=>s+x.size,0).toFixed(1),
    xmin:Math.min(...L.map(x=>x.xmin)),xmax:Math.max(...L.map(x=>x.xmax)),ymin:Math.min(...L.map(x=>x.ymin)),ymax:Math.max(...L.map(x=>x.ymax)),
    zmin:Math.min(...L.map(x=>x.zmin)),zmax:Math.max(...L.map(x=>x.zmax)),eave:Math.min(...L.map(x=>x.eave)),ridge:Math.max(...L.map(x=>x.ridge)),
    useEave:L.every(x=>x.useEave),h:Math.max(...L.map(x=>x.h)),wallArea:L.reduce((s,x)=>s+(+x.wallArea||0),0),env:0,wallRatio:Math.max(...L.map(x=>+x.wallRatio||0))});
  d.blocks=d.blocks.filter(x=>!L.includes(x));d.blocks.push(b);d.faces=wind4BuildFaces(d.blocks);wind4Render();
}
function wind4SplitBlock(id,axis,cut){
  const d=WIND4.draft,b=d.blocks.find(x=>x.id===id);if(!b)return;
  if(axis===undefined){WIND4.split={id};WIND4.preview.focus=id;WIND4.preview.view='plan';WIND4.preview.columns=true;wind4Render();return}
  axis=String(axis).toUpperCase();cut=Number(cut);if(!/^[XY]$/.test(axis))return;
  const lo=axis==='X'?b.xmin:b.ymin,hi=axis==='X'?b.xmax:b.ymax;
  if(!Number.isFinite(cut)||cut<=lo+.05||cut>=hi-.05){alert('這條柱線不在量體內，無法分割。');return}
  const mk=(a,c)=>{const x=JSON.parse(JSON.stringify(b));x.id=wind4NextBlockId();
    if(axis==='X'){x.xmin=a;x.xmax=c}else{x.ymin=a;x.ymax=c}
    const faces=wind4Faces().filter(f=>(b.faceIds||[]).includes(f.id)&&((axis==='X'?(f.xmin+f.xmax)/2:(f.ymin+f.ymax)/2)>=a-.01)&&((axis==='X'?(f.xmin+f.xmax)/2:(f.ymin+f.ymax)/2)<=c+.01));
    x.faceIds=faces.map(f=>f.id);x.n=faces.length;x.size=faces.length?+faces.reduce((s,f)=>s+f.size,0).toFixed(1):+(b.size*(c-a)/(hi-lo)).toFixed(1);
    x.parentId='';x.editSelected=false;return wind4RefreshBlock(x)};
  d.blocks=d.blocks.filter(x=>x!==b);const a=mk(lo,cut);d.blocks.push(a);const c=mk(cut,hi);d.blocks.push(c);
  d.faces=wind4BuildFaces(d.blocks);WIND4.split=null;WIND4.preview.focus=a.id;wind4Render();
}
async function wind4CreateProject(){
  const d=WIND4.draft,
        blocks=d.blocks.filter(b=>b.use),ids=new Set(blocks.map(b=>b.id)),
        allFaces=d.faces.filter(f=>ids.has(f.blockId)),faces=allFaces.filter(f=>f.use);
  if(!blocks.length){alert('至少勾選一個量體。');WIND4.step=1;wind4Render();return}
  if(blocks.some(b=>b.cls==='closed')&&!faces.length){alert('封閉式量體至少勾選一個迎風面。');WIND4.step=3;wind4Render();return}
  const bad=blocks.find(b=>!(b.h>0));
  if(bad){alert(bad.id+' 的建築高度 h 必須大於 0。');WIND4.step=1;wind4Render();return}
  const badPent=blocks.find(b=>b.cls==='pent'&&(!b.parentId||!blocks.some(p=>p.id===b.parentId)));
  if(badPent){alert(badPent.id+' 是屋突，請指定母量體。');WIND4.step=1;wind4Render();return}
  const badFace=faces.find(f=>{const sp=wind4Spans(f);return sp.length!==Math.max(0,f.face.cols.length-1)||Math.abs(sp.reduce((s,v)=>s+v,0)-f.B)>.05});
  if(badFace){alert(badFace.blockId+' '+badFace.wind+' 的柱距筆數或總和不正確。');WIND4.step=3;wind4Render();return}
  const nameEl=$('wind4-name');
  const old=WIND4.project&&WIND4.project.source?.fileName===currentS2KFileName&&(!WIND4.project.source?.text||WIND4.project.source.text===currentS2KText)?WIND4.project:null,now=new Date().toISOString();
  const p={schemaVersion:1,kind:'wind',appVersion:'4.15.5',id:old?.id||'W-'+Date.now().toString(36),createdAt:old?.createdAt||now,updatedAt:now,
    name:(nameEl&&nameEl.value.trim())||('風力-'+(currentS2KFileName||'model')),
    source:{fileName:currentS2KFileName||'',text:currentS2KText},baseZ:d.baseZ,
    blocks:blocks.map(b=>({...b,levels:wind4Levels(b)})),
    faces:allFaces.map(f=>({key:f.key,blockId:f.blockId,wind:f.wind,pat:f.pat,dir:f.dir,axis:f.axis,side:f.side,sign:f.sign,use:!!f.use,
                         spans:wind4Spans(f),edge:f.face.edge,zMin:f.face.zMin,B:f.B})),
    active:(d.active&&ids.has(d.active)?d.active:(blocks.find(b=>b.cls==='closed')||blocks[0]).id)};
  await wind4DbPut(p);
  WIND4.project=p;
  $('wind4-dialog').close();
  try{renderWindSummary()}catch(e){}
  await wind4ApplyToChild(p,true);
}
/* 把專案幾何整包送進子頁，再開工作區——進工作區時幾何就是對的 */
async function wind4ApplyToChild(p,open){
  ensureWindFrame();
  const b=p.blocks.find(x=>x.id===p.active)||p.blocks[0];
  if(!b)return;
  windNote='正在把量體 '+b.id+' 的幾何送進耐風工作區…';
  try{renderWindSummary()}catch(e){}
  await new Promise(r=>setTimeout(r,700));
  /* 子頁仍需原始 S2K 建立柱與節點索引；先等整棟解析完成，再以專案量體覆寫尺寸與分類。 */
  const srcName=p.source?.fileName||currentS2KFileName||'model.s2k';
  if(!windState?.loaded||windState.fileName!==srcName){
    windPost({type:'wind-apply',payload:{s2kText:p.source?.text||currentS2KText,fileName:srcName}});
    for(let i=0;i<50&&(!windState?.loaded||windState.fileName!==srcName);i++)await new Promise(r=>setTimeout(r,100));
  }
  const patch=wind4BlockPatch(b),firstFace=(p.faces||[]).find(f=>f.blockId===b.id&&f.use!==false);
  patch.inputs.projectName=p.name+'／'+b.id;
  if(firstFace?.spans?.length)patch.inputs.colSpans=firstFace.spans.join(',');
  const payload={...patch,project:{
    id:p.id,name:p.name,baseZ:p.baseZ,active:p.active,
    blocks:p.blocks.map(x=>({id:x.id,classification:x.cls,enclosure:x.enclosure,parapet:+x.parapet||0,parentId:x.parentId||'',
      h:x.h,theta:x.tilt,roofType:x.roofType,openings:x.openings,levels:x.levels,nCols:x.nCols,
      slopeX:+x.slopeX||0,slopeY:+x.slopeY||0,bounds:{xmin:x.xmin,xmax:x.xmax,ymin:x.ymin,ymax:x.ymax},faceIds:x.faceIds||[]})),
    faces:p.faces.map(x=>({...x}))}};
  windPost({type:'wind-apply-project',payload}); /* V4.15.5 完整幾何契約 */
  windPost({type:'apply-project',payload});      /* 舊子頁相容：實際套用 h／θ／樓層 */
  await new Promise(r=>setTimeout(r,1200));
  windNote='專案「'+p.name+'」已載入：量體 '+b.id+'（h='+b.h.toFixed(2)+' m、θ='+b.tilt.toFixed(2)+'°、'+(b.levels||[]).length+' 層）。'
    +'請在工作區設定風速與地況。';
  try{renderWindSummary()}catch(e){}
  wind4RenderWorkspaceGeometry();
  if(open)openWindWorkspace();
}
function wind4Render(){
  const d=$('wind4-dialog');if(!d||!WIND4.draft)return;
  d.querySelector('#wind4-preview').innerHTML=wind4Preview();
  d.querySelector('#wind4-panel').innerHTML=[wind4Step1,wind4Step2,wind4Step3,wind4Step4][WIND4.step-1]();
  d.querySelectorAll('.v300-step').forEach((b,i)=>{b.classList.toggle('active',i+1===WIND4.step);b.classList.toggle('done',i+1<WIND4.step)});
  d.querySelector('#wind4-prev').disabled=WIND4.step===1;
  d.querySelector('#wind4-next').classList.toggle('v300-hidden',WIND4.step===4);
  d.querySelector('#wind4-gen').classList.toggle('v300-hidden',WIND4.step!==4);
  d.querySelectorAll('[data-w4h]').forEach(x=>x.addEventListener('change',()=>{WIND4.draft.h=+x.dataset.w4h;wind4Render()}));
  d.querySelectorAll('[data-w4r]').forEach(x=>x.addEventListener('change',()=>{WIND4.draft.roofPick=x.dataset.w4r;wind4Render()}));
  d.querySelectorAll('[data-w4b]').forEach(x=>x.addEventListener('change',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.w4b);if(b)b.use=x.checked;wind4Render()}));
  d.querySelectorAll('[data-w4f]').forEach(x=>x.addEventListener('change',()=>{
    const f=WIND4.draft.faces.find(f=>f.key===x.dataset.w4f);if(f)f.use=x.checked;wind4Render()}));
  d.querySelectorAll('[data-w4sel]').forEach(x=>x.addEventListener('change',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.w4sel);if(b)b.editSelected=x.checked}));
  d.querySelectorAll('[data-w4split]').forEach(x=>x.addEventListener('click',()=>wind4SplitBlock(x.dataset.w4split)));
  d.querySelectorAll('[data-w4minor-add]').forEach(x=>x.addEventListener('click',()=>wind4AddMinor(x.dataset.w4minorAdd,x.dataset.cls)));
  d.querySelectorAll('[data-w4cut]').forEach(x=>x.addEventListener('click',e=>{e.stopPropagation();wind4SplitBlock(x.dataset.w4cut,x.dataset.axis,x.dataset.value)}));
  d.querySelector('[data-w4split-cancel]')?.addEventListener('click',()=>{WIND4.split=null;wind4Render()});
  d.querySelector('#wind4-merge')?.addEventListener('click',wind4MergeSelected);
  /* 預覽互動：量體聚焦、平／立面切換，以及減少視覺雜訊的顯示開關。 */
  d.querySelectorAll('[data-w4pv-block]').forEach(x=>x.addEventListener('click',()=>{WIND4.preview.focus=x.dataset.w4pvBlock;wind4Render()}));
  d.querySelectorAll('[data-w4row]').forEach(x=>x.addEventListener('click',e=>{
    if(e.target.closest('input,select,button'))return;WIND4.preview.focus=x.dataset.w4row;wind4Render()}));
  d.querySelectorAll('[data-w4view]').forEach(x=>x.addEventListener('click',()=>{WIND4.preview.view=x.dataset.w4view;wind4Render()}));
  d.querySelector('[data-w4pv-all]')?.addEventListener('click',()=>{WIND4.preview.focus='';WIND4.preview.faces=false;wind4Render()});
  d.querySelectorAll('[data-w4toggle]').forEach(x=>x.addEventListener('click',()=>{
    const k=x.dataset.w4toggle;WIND4.preview[k]=!WIND4.preview[k];wind4Render()}));
  /* 量體欄位：θ／h／分類 */
  d.querySelectorAll('[data-w4bf]').forEach(x=>x.addEventListener('change',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.id);if(!b)return;
    const k=x.dataset.w4bf;
    if(k==='cls'||k==='parentId'||k==='enclosure'||k==='roofType')b[k]=x.value;
    else{const v=+x.value;if(Number.isFinite(v)){b[k]=v;if(k==='h')b.hManual=true}}
    if(k==='cls')b.enclosure=b.cls==='closed'?(b.enclosure==='partial'?'partial':'closed'):'open';
    if(k==='h'||k==='cls'){WIND4.draft.faces=wind4BuildFaces(WIND4.draft.blocks)}
    wind4Render()}));
  d.querySelectorAll('[data-w4op]').forEach(x=>x.addEventListener('change',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.id);if(!b)return;
    if(!Array.isArray(b.openings))b.openings=[0,0,0,0,0];const v=+x.value;
    if(Number.isFinite(v)&&v>=0)b.openings[+x.dataset.w4op]=v;wind4Render()}));
  /* 樓層：改值／刪除／新增／重設 */
  d.querySelectorAll('[data-w4lv]').forEach(x=>x.addEventListener('change',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.id);if(!b)return;
    b.levels=wind4Levels(b).map(r=>r.slice());
    const i=+x.dataset.i;if(!b.levels[i])return;
    if(x.dataset.w4lv==='name')b.levels[i][0]=x.value;
    else{const v=+x.value;if(Number.isFinite(v))b.levels[i][1]=v}
    b.levels.sort((a,c)=>a[1]-c[1]);wind4Render()}));
  d.querySelectorAll('[data-w4lv-del]').forEach(x=>x.addEventListener('click',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.w4lvDel);if(!b)return;
    b.levels=wind4Levels(b).map(r=>r.slice());b.levels.splice(+x.dataset.i,1);wind4Render()}));
  d.querySelectorAll('[data-w4lv-add]').forEach(x=>x.addEventListener('click',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.w4lvAdd);if(!b)return;
    b.levels=wind4Levels(b).map(r=>r.slice());
    b.levels.push(['NEW',+(b.h||0).toFixed(3)]);b.levels.sort((a,c)=>a[1]-c[1]);wind4Render()}));
  d.querySelectorAll('[data-w4lv-reset]').forEach(x=>x.addEventListener('click',()=>{
    const b=WIND4.draft.blocks.find(b=>b.id===x.dataset.w4lvReset);if(!b)return;
    delete b.levels;wind4Render()}));
  /* 柱距覆寫 */
  d.querySelectorAll('[data-w4sp]').forEach(x=>x.addEventListener('change',()=>{
    const f=WIND4.draft.faces.find(f=>f.key===x.dataset.w4sp);if(f)f.spansOverride=x.value;wind4Render()}));
  /* 待補項目的「前往步驟」 */
  d.querySelectorAll('[data-w4go]').forEach(x=>x.addEventListener('click',()=>{
    WIND4.step=+x.dataset.w4go;wind4Render()}));
  const nm=d.querySelector('#wind4-name');
  if(nm)nm.addEventListener('change',()=>{WIND4.draft.name=nm.value.trim()});
  const ac=d.querySelector('#wind4-active');
  if(ac)ac.addEventListener('change',()=>{WIND4.draft.active=ac.value});
}
/* 向工作區要某一向的風壓剖線（計算權留在子頁） */
function wind4AskProfile(dir){
  return new Promise(res=>{
    let done=false;
    WIND4.waiter=st=>{if(done)return;if(String(st?.dir||'')===dir){done=true;WIND4.waiter=null;res(st?.loads?.profile||[])}};
    windPost({type:'set-direction',payload:{dir}});
    setTimeout(()=>{if(!done){done=true;WIND4.waiter=null;res(null)}},6000);
  });
}
async function wind4Generate(){
  if(WIND4.busy)return;
  const out=$('wind4-out'),d=WIND4.draft,
        faces=d.faces.filter(f=>f.use),
        blocks=d.blocks.filter(b=>b.use&&b.cls!=='lattice');
  if(!faces.length){out.innerHTML='<div class="v300-note warn">請至少勾選一個迎風面。</div>';return}
  if(!blocks.length){out.innerHTML='<div class="v300-note warn">請至少勾選一個可計算的量體。</div>';return}
  WIND4.busy=true;
  const all=[],log=[];
  try{
    ensureWindFrame();
    await new Promise(r=>setTimeout(r,700));
    for(let bi=0;bi<blocks.length;bi++){
      const b=blocks[bi];
      out.innerHTML='<div class="v300-note">量體 '+b.id+'（'+(bi+1)+'/'+blocks.length+'）：套用 h='+b.h.toFixed(2)+' m、θ='+b.tilt.toFixed(2)+'°、樓層…</div>';
      windPost({type:'apply-project',payload:wind4BlockPatch(b)});
      await new Promise(r=>setTimeout(r,1400));
      const prof={};let bad='';
      for(const dir of ['X','Y']){
        out.innerHTML='<div class="v300-note">量體 '+b.id+'：取 '+dir+' 向風壓剖線…</div>';
        const p=await wind4AskProfile(dir);
        if(!p||!p.length){bad='取不到 '+dir+' 向風壓剖線';break}
        prof[dir]=p;
      }
      if(bad){log.push({block:b.id,err:bad});continue}
      for(const f of faces){
        const r=wind4FaceRows(f,prof[f.axis==='x'?'X':'Y'],b);
        if(r.err){log.push({block:b.id,wind:f.wind,err:r.err});continue}
        r.block=b.id;r.h=b.h;all.push(r);
        log.push({block:b.id,wind:f.wind,pat:f.pat,rows:r.rows.length,cols:r.nCols,frames:r.nFrames});
      }
    }
    if(!all.length){out.innerHTML='<div class="v300-note warn">沒有產生任何載重列。<br>'
      +log.map(x=>(x.block||'')+(x.wind?' '+x.wind:'')+'：'+x.err).join('<br>')+'</div>';WIND4.busy=false;return}
    WIND4.result={blocks:all,log};
    out.innerHTML='<div class="v300-note ok"><b>已產生 '+all.length+' 組（'+blocks.length+' 量體 × '+faces.length+' 面）、共 '
      +all.reduce((s,b)=>s+b.rows.length,0)+' 列 FRAME LOADS</b></div>'
      +'<div class="v300-table-wrap" style="max-height:26vh"><table class="v300-table"><thead><tr><th>量體</th><th>面</th><th>LoadPat</th><th>柱線</th><th>柱段</th><th>列數</th></tr></thead><tbody>'
      +log.map(x=>x.err?('<tr><td>'+v300Esc(x.block||'')+'</td><td colspan="5" style="color:#ff6b6b">'+v300Esc((x.wind?x.wind+'：':'')+x.err)+'</td></tr>')
        :('<tr><td>'+x.block+'</td><td>'+x.wind+'</td><td>'+x.pat+'</td><td>'+x.cols+'</td><td>'+x.frames+'</td><td><b>'+x.rows+'</b></td></tr>')).join('')
      +'</tbody></table></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
      +'<button class="v300-btn" id="wind4-dl">下載併入全部載重的新 .s2k</button>'
      +'<button class="v300-btn" id="wind4-txt">只看載重文字</button></div><div id="wind4-pre"></div>';
    $('wind4-dl').onclick=()=>wind4Download();
    $('wind4-txt').onclick=()=>{$('wind4-pre').innerHTML='<div class="v300-table-wrap" style="max-height:34vh"><pre style="margin:0;font-size:10.5px;line-height:1.5">'
      +v300Esc(wind4LoadText())+'</pre></div>'};
  }catch(e){out.innerHTML='<div class="v300-note warn">產生失敗：'+v300Esc(String(e.message||e))+'</div>';console.error(e)}
  WIND4.busy=false;
}
/* 單一面 → FRAME LOADS 列（沿用 V4.6.3 的堆疊柱處理與段端內插） */
function wind4FaceRows(f,profile,blk){
  const base=(WIND4.draft?.baseZ??WIND4.project?.baseZ??wind4BaseZ().z),zs=profile.map(p=>+p.z),use=profile.map(p=>+p.use),
        zFloor=Math.max(0,+f.face?.zMin||0);
  if(zs.length<2)return {err:'風壓剖線資料不足'};
  const at=z=>{
    if(z<=zs[0])return use[0];
    if(z>=zs[zs.length-1])return use[use.length-1];
    for(let i=1;i<zs.length;i++)if(z<=zs[i])return use[i-1]+(use[i]-use[i-1])*(z-zs[i-1])/((zs[i]-zs[i-1])||1);
    return use[use.length-1];
  };
  /* 只取落在該量體平面範圍內的柱線；不同棟別各自成面，不會互相混入 */
  const inBlk=c=>!blk||(c.coord>=(f.axis==='x'?blk.ymin:blk.xmin)-.6&&
                        c.coord<=(f.axis==='x'?blk.ymax:blk.xmax)+.6);
  const list=f.face.cols.filter(inBlk);         /* 母頁 windFace 已含堆疊柱（V4.6.3） */
  /* 柱距優先用專案確認過的值；沒有才由柱座標推。端柱半跨、中柱兩側各半。 */
  const ov=String(f.spansOverride||'').split(/[,，\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>0),
        useOv=ov.length===list.length-1,
        tribs=list.map((c,i)=>{
          const l=useOv?(i>0?ov[i-1]:0):(i>0?c.coord-list[i-1].coord:0),
                r=useOv?(i<list.length-1?ov[i]:0):(i<list.length-1?list[i+1].coord-c.coord:0);
          return (l+r)/2});
  const rows=[],skipped=[];let nFrames=0;
  list.forEach((g,i)=>{
    if(!g.stack.length){skipped.push(g.coord.toFixed(2));return}
    nFrames+=g.stack.length;
    g.stack.forEach(c=>{
      const zb=c.zBot-base,zt=c.zTop-base,len=zt-zb;if(!(len>0))return;
      for(let k=0;k<zs.length-1;k++){
        const z1=Math.max(zs[k],zb,zFloor),z2=Math.min(zs[k+1],zt);
        if(z2-z1<=1e-6)continue;
        const w1=f.sign*at(z1)*tribs[i]/1000,w2=f.sign*at(z2)*tribs[i]/1000;
        rows.push('   Frame='+c.frameId+'   LoadPat='+f.pat+'   CoordSys=GLOBAL   Type=Force   Dir='+f.dir
          +'   DistType=RelDist   RelDistA='+((z1-zb)/len).toFixed(4)+'   RelDistB='+((z2-zb)/len).toFixed(4)
          +'   AbsDistA='+(z1-zb).toFixed(4)+'   AbsDistB='+(z2-zb).toFixed(4)
          +'   FOverLA='+w1.toFixed(4)+'   FOverLB='+w2.toFixed(4));
      }
    });
  });
  if(!list.length)return {err:'該量體平面範圍內沒有這一面的柱'};
  if(!rows.length)return {err:'柱高與風壓剖線無重疊區間'};
  return {wind:f.wind,pat:f.pat,rows,nCols:list.length,nFrames,skipped,tribs};
}
function wind4LoadText(){
  const R=WIND4.result;if(!R)return '';
  return 'TABLE:  "FRAME LOADS - DISTRIBUTED"\n'
    +R.blocks.map(b=>'   ; '+(b.block||'')+' '+b.wind+'（LoadPat='+b.pat+'）　'+b.rows.length+' 列　h='+(b.h||0).toFixed(3)+' m\n'+b.rows.join('\n')).join('\n');
}
function wind4Download(){
  const R=WIND4.result;if(!R||!currentS2KText){alert('沒有可寫入的模型文字');return}
  const head='TABLE:  "FRAME LOADS - DISTRIBUTED"',pats=R.blocks.map(b=>b.pat);
  let txt=currentS2KText,removed=0;
  pats.forEach(p=>{
    const re=new RegExp('^\\s+Frame=\\S+\\s+LoadPat='+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s[^\\n]*)?\\r?\\n','gm');
    const before=(txt.match(re)||[]).length;removed+=before;txt=txt.replace(re,'');
  });
  const body=R.blocks.map(b=>'   ; '+(b.block||'')+' '+b.wind+'（LoadPat='+b.pat+'）　'+b.rows.length+' 列　'
    +'由 S2K 整合平台 V4.15.5 產生　h='+(b.h||0).toFixed(3)+' m\n'+b.rows.join('\n')).join('\n');
  if(txt.includes(head)){
    const i=txt.indexOf(head),j=txt.indexOf('\nTABLE:',i+1),end=j<0?txt.length:j;
    txt=txt.slice(0,end)+'\n'+body+txt.slice(end);
  }else{
    const k=txt.lastIndexOf('\nEND TABLE DATA'),block='\n \n'+head+'\n'+body;
    txt=k<0?txt+block:txt.slice(0,k)+block+txt.slice(k);
  }
  const name=(currentS2KFileName||'model.s2k').replace(/\.s2k$/i,'')+'_wind4.s2k';
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain;charset=utf-8'}));
  a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800);
  $('wind4-pre').innerHTML='<div class="v300-note ok">已下載 <b>'+v300Esc(name)+'</b>：移除原有同名 LoadPat '+removed+' 列，寫入 '
    +R.blocks.reduce((s,b)=>s+b.rows.length,0)+' 列（'+pats.join('、')+'）。<br>'
    +'⚠ 本平台不會產生 <code>LOAD PATTERN DEFINITIONS</code>，這些載重樣式需先在 SAP 中建立（DesignType=Wind、AutoLoad=None）。</div>';
}
/* ── V4.15.0：迎風面柱線 → Frame id → FRAME LOADS - DISTRIBUTED ── */
/* 模型中的柱（近垂直桿件），取底端座標；與耐風工具的判定條件一致 */
function windColumns(){
  const out=[];
  for(const f of model?.frames||[]){
    const a=model.joints[String(f.i)],b=model.joints[String(f.j)];
    if(!a||!b)continue;
    const dz=Math.abs(b.z-a.z),dr=Math.hypot(b.x-a.x,b.y-a.y);
    if(dz<=0.5||dr>=0.05)continue;              /* 耐風工具：高差>0.5m 且水平位移<0.05m */
    const lo=a.z<=b.z?a:b,hi=a.z<=b.z?b:a;
    out.push({frameId:String(f.id),x:+lo.x.toFixed(4),y:+lo.y.toFixed(4),
              zBot:lo.z,zTop:hi.z,len:dz});
  }
  return out;
}
/* 某一外牆面：只在「橫向跨度 >= 0.8×最大跨度」的柱線中取最外側者（同耐風工具邏輯） */
function windFace(axis,side){
  const cols=windColumns();if(!cols.length)return null;
  const other=axis==='x'?'y':'x';
  const vals=[...new Set(cols.map(c=>c[axis]))].sort((a,b)=>a-b);
  const lines=vals.map(v=>{
    const row=cols.filter(c=>Math.abs(c[axis]-v)<0.01).sort((a,b)=>a[other]-b[other]);
    const uniq=[...new Set(row.map(c=>c[other]))];
    return {v,row,span:uniq.length>1?+(uniq[uniq.length-1]-uniq[0]).toFixed(3):0};
  });
  const maxSpan=Math.max(...lines.map(l=>l.span));
  const cand=lines.filter(l=>l.span>=0.8*maxSpan);
  const pick=cand.length?(side==='min'?cand[0]:cand[cand.length-1]):lines[side==='min'?0:lines.length-1];
  /* 同一格線上常有整疊柱（地下室段、各樓層段、屋突段）。
     風壓要施加在整疊柱上，各自在自己的高度範圍內——只取最低那支會漏掉主結構柱。
     （工務大樓實測：只取最低支會全部落在地下室柱 -4.1~0.9，主柱完全沒載重。） */
  const byCoord=new Map();
  for(const c of pick.row){
    const k=c[other].toFixed(4);
    if(!byCoord.has(k))byCoord.set(k,{coord:c[other],stack:[]});
    byCoord.get(k).stack.push(c);
  }
  const list=[...byCoord.values()].sort((a,b)=>a.coord-b.coord);
  for(const g of list)g.stack.sort((a,b)=>a.zBot-b.zBot);
  const spans=list.slice(1).map((g,i)=>+(g.coord-list[i].coord).toFixed(4));
  return {axis,side,edge:pick.v,cols:list,spans,total:+spans.reduce((a,b)=>a+b,0).toFixed(4)};
}
const WIND_FACES=[{wind:'WX+',axis:'x',side:'min',pat:'WPX',dir:'X',sign:1},
                  {wind:'WX-',axis:'x',side:'max',pat:'WNX',dir:'X',sign:-1},
                  {wind:'WY+',axis:'y',side:'min',pat:'WPY',dir:'Y',sign:1},
                  {wind:'WY-',axis:'y',side:'max',pat:'WNY',dir:'Y',sign:-1}];
/* 工作區目前帶入的柱距 → 對應到哪一面（比對跨距序列） */
function windActiveFace(){
  const raw=String(windState?.loads?.colSpans||'').trim();
  if(!raw)return null;
  const sp=raw.split(/[,，\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>0);
  if(!sp.length)return null;
  for(const f of WIND_FACES){
    const face=windFace(f.axis,f.side);
    if(!face||face.spans.length!==sp.length)continue;
    if(face.spans.every((v,i)=>Math.abs(v-sp[i])<0.01))return {...f,face};
  }
  return null;
}
/* w(z)=p_ext,採用(z)·B/1000（tf/m）；沿柱高以梯形分段輸出 */

/* V4.15.5：專案模式的產生——各量體四面一次，用專案裡已確認的幾何與柱距 */
async function windGenerateProject(){
  const P=WIND4.project,box=$('wind-s2k');
  if(WIND4.busy)return;
  const targets=P.blocks.filter(b=>b.use!==false&&b.cls==='closed'),unsupported=P.blocks.filter(b=>b.use!==false&&b.cls!=='closed');
  if(!targets.length){windNote='專案沒有可輸出迎風牆 FRAME LOADS 的封閉式量體。'+
    (unsupported.length?' 已辨識：'+unsupported.map(b=>b.id+' '+(W4_CLS[b.cls]||{}).t).join('、')+'；必須走各自規範路徑，已停止避免套錯公式。':'');
    box.style.display='none';renderWindSummary();return}
  WIND4.busy=true;
  try{
    ensureWindFrame();const blocks=[],log=[];
    for(let bi=0;bi<targets.length;bi++){
      const b=targets[bi];windNote='量體 '+b.id+'（'+(bi+1)+'/'+targets.length+'）：套用完整幾何並取得風壓剖線…';renderWindSummary();
      windPost({type:'apply-project',payload:{...wind4BlockPatch(b),project:{id:P.id,name:P.name,active:b.id,blocks:P.blocks,faces:P.faces}}});
      await new Promise(r=>setTimeout(r,1100));
      const prof={};let failed='';
      for(const dir of ['X','Y']){const pr=await wind4AskProfile(dir);if(!pr||!pr.length){failed='取不到 '+dir+' 向風壓剖線';break}prof[dir]=pr}
      if(failed){log.push({block:b.id,err:failed});continue}
      const hT=windState?.input?.h;
      if(Number.isFinite(hT)&&Math.abs(hT-b.h)>.05){log.push({block:b.id,err:'工作區 h='+hT+' m 與專案 h='+b.h.toFixed(2)+' m 不一致'});continue}
      const defs=P.faces.filter(f=>f.blockId===b.id&&f.use!==false);
      for(const f of defs){
        const face=wind4FaceForBlock(b,f.axis,f.side,P.blocks);
        if(!face||!face.exposed){log.push({block:b.id,wind:f.wind,err:'該面被相鄰量體遮蔽或找不到柱線'});continue}
        const r=wind4FaceRows({...f,face,spansOverride:(f.spans||[]).join(',')},prof[f.axis==='x'?'X':'Y'],b);
        if(r.err){log.push({block:b.id,wind:f.wind,err:r.err});continue}
        r.block=b.id;r.h=b.h;blocks.push(r);log.push({block:b.id,wind:f.wind,pat:f.pat,rows:r.rows.length,cols:r.nCols,frames:r.nFrames});
      }
    }
    if(!blocks.length){
      windNote='沒有產生任何載重列：'+log.map(x=>(x.block||'')+' '+(x.wind||'')+'（'+x.err+'）').join('、');
      box.style.display='none';renderWindSummary();WIND4.busy=false;return;
    }
    WIND4.result={blocks,log};
    windNote='已產生 '+blocks.length+' 面、共 '+blocks.reduce((s,x)=>s+x.rows.length,0)+' 列 FRAME LOADS（'+targets.map(b=>b.id).join('、')+'）'
      +(log.some(x=>x.err)?'；'+log.filter(x=>x.err).map(x=>x.wind+' 略過').join('、'):'');
    box.style.display='';
    box.innerHTML='<div style="font-size:.68rem;line-height:1.6">'
      +log.map(x=>x.err?('<span style="color:var(--warn)">'+v300Esc((x.block||'')+' '+(x.wind||''))+'：'+v300Esc(x.err)+'</span>')
        :(x.block+' '+x.wind+'（'+x.pat+'）'+x.cols+' 柱線／'+x.frames+' 柱段 → <b>'+x.rows+'</b> 列')).join('<br>')
      +'</div><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
      +'<button class="btn" id="wind-dl-s2k">下載新 .s2k</button>'
      +'<button class="btn" id="wind-show-txt">看載重文字</button></div><div id="wind-txt-box"></div>';
    $('wind-dl-s2k').onclick=()=>wind4Download();
    $('wind-show-txt').onclick=()=>{$('wind-txt-box').innerHTML=
      '<pre style="max-height:34vh;overflow:auto;font-size:10px;line-height:1.45;margin:8px 0 0">'+v300Esc(wind4LoadText())+'</pre>'};
  }catch(e){windNote='產生失敗：'+String(e.message||e);console.error(e)}
  WIND4.busy=false;renderWindSummary();
}
function windLoadText(){
  const st=windState;
  if(!st?.loaded)return {err:'尚未帶入模型幾何。'};
  const prof=(st.loads?.profile||[]).filter(r=>Number.isFinite(r.z)&&Number.isFinite(r.use));
  const tribs=(st.loads?.tribs||[]).filter(r=>Number.isFinite(r.B));
  if(!prof.length)return {err:'工作區尚未產生 5.6.2 迎風牆外風壓表：請先在耐風工作區設定風速與地況。'};
  if(!tribs.length)return {err:'工作區尚未輸入柱距：請在 s2k 柱線表按「帶入」，或手動填柱距欄位。'};
  const act=windActiveFace();
  if(!act)return {err:'目前柱距對不上任何一面外牆，無法反查 Frame id。請按 s2k 柱線表的「帶入」。'};
  /* 守門 1：h 與模型柱頂不同時要求明確確認。
     不硬擋——屋突、電梯機房、女兒牆柱高過主屋頂是常態，h 取哪一個由設計者判斷
     （耐風工具本身也明示「本頁不自動改」）。但跨專案殘留的 h 會算成別棟樓，故必須確認。 */
  const hTool=st.input?.h,hModel=st.ztop;
  const hBad=Number.isFinite(hTool)&&Number.isFinite(hModel)&&Math.abs(hTool-hModel)>0.05;
  if(hBad&&!$('wind-h-ack')?.checked)
    return {err:'建築高度需確認：耐風工作區 h='+hTool+' m，模型柱頂='+hModel+' m（差 '+
      Math.abs(hTool-hModel).toFixed(2)+' m）。若是屋突／女兒牆高過主屋頂，h 取 '+hTool+
      ' m 可能正確；若是換了模型忘了改 h，就會用到別棟樓的風壓剖線。'+
      '請勾選下方「已確認 h」再產生。'};
  const cols=act.face.cols;
  if(cols.length!==tribs.length)
    return {err:'柱數不符：模型該面 '+cols.length+' 支、工作區 '+tribs.length+' 支。'};
  const zs=prof.map(r=>r.z).sort((a,b)=>a-b);
  const useAt=z=>{const hit=prof.find(r=>Math.abs(r.z-z)<1e-6);return hit?hit.use:null};
  const f4=x=>Number(x.toFixed(4));
  const L=['/* 由 S2K 整合平台產生　'+act.wind+'（'+act.pat+'）　'+
           '耐風工作區 h='+(Number.isFinite(hTool)?hTool:'—')+' m'+
           (hBad?'（與模型柱頂 '+hModel+' m 不同，已由使用者確認）':'')+' */',
           'TABLE:  "FRAME LOADS - DISTRIBUTED"'];
  let n=0,usedFrames=0,skipped=[];
  for(let i=0;i<cols.length;i++){
    const B=tribs[i].B;
    for(const c of cols[i].stack){
      const len=c.zTop-c.zBot;
      if(!(len>0))continue;
      let emitted=0;
      for(let k=0;k<zs.length-1;k++){
        const z1=Math.max(zs[k],c.zBot),z2=Math.min(zs[k+1],c.zTop);
        if(z2-z1<=1e-6)continue;
        const u1=useAt(zs[k]),u2=useAt(zs[k+1]);
        if(u1===null||u2===null)continue;
        /* 段端點若被柱高截斷，風壓沿 z 線性內插 */
        const lerp=(z)=>u1+(u2-u1)*((z-zs[k])/((zs[k+1]-zs[k])||1));
        const w1=act.sign*lerp(z1)*B/1000, w2=act.sign*lerp(z2)*B/1000;
        L.push('   Frame='+c.frameId+'   LoadPat='+act.pat+'   CoordSys=GLOBAL   Type=Force   Dir='+act.dir+
               '   DistType=RelDist   RelDistA='+f4((z1-c.zBot)/len)+'   RelDistB='+f4((z2-c.zBot)/len)+
               '   AbsDistA='+f4(z1-c.zBot)+'   AbsDistB='+f4(z2-c.zBot)+
               '   FOverLA='+f4(w1)+'   FOverLB='+f4(w2));
        n++;emitted++;
      }
      if(emitted)usedFrames++;else skipped.push(c.frameId);
    }
  }
  if(!n)return {err:'沒有產生任何載重列（柱高與風壓剖線無重疊區間）。'};
  /* 守門 2：檢查各格線的柱疊是否連續覆蓋風壓剖線範圍；有缺口就是牆面沒柱可傳力 */
  const zLo=zs[0],zHi=zs[zs.length-1];
  const gaps=[];
  for(const g of cols){
    const segs=g.stack.map(c=>[Math.max(c.zBot,zLo),Math.min(c.zTop,zHi)]).filter(a=>a[1]>a[0])
                      .sort((a,b)=>a[0]-b[0]);
    let cursor=zLo;
    for(const [a,b] of segs){ if(a-cursor>0.05)gaps.push(g.coord.toFixed(2)+'（'+cursor.toFixed(1)+'~'+a.toFixed(1)+'m）'); cursor=Math.max(cursor,b); }
    if(zHi-cursor>0.05)gaps.push(g.coord.toFixed(2)+'（'+cursor.toFixed(1)+'~'+zHi.toFixed(1)+'m）');
  }
  let warn='';
  if(gaps.length)
    warn='下列格線位置在風壓範圍內有「無柱區段」，該段牆面風力沒有柱可傳遞，需另行指派'+
         '（水平構材或面載重）：'+gaps.slice(0,8).join('、')+(gaps.length>8?' 等 '+gaps.length+' 處':'')+'。請自行確認。';
  if(skipped.length)
    warn+=(warn?'　':'')+'另有 '+skipped.length+' 支柱完全落在風壓剖線範圍外（未施加）：Frame '+skipped.slice(0,8).join('、')+
          (skipped.length>8?' 等':'')+'。';
  return {text:L.join('\n'),count:n,face:act.wind,pat:act.pat,
          cols:cols.length,frames:usedFrames,warn:warn};
}
async function windGenerate(){
  if(WIND4.project)return windGenerateProject();
  const r=windLoadText(),box=$('wind-s2k');
  if(r.err){windNote=r.err;box.style.display='none';renderWindSummary();return}
  windNote='已產生 '+r.face+'（'+r.pat+'）'+r.cols+' 條柱線／'+r.frames+' 支柱、'+r.count+' 列 FRAME LOADS'+(r.warn?'　⚠ '+r.warn:'');
  box.style.display='';box.textContent=r.text;
  renderWindSummary();
}
$('btn-wind-gen').addEventListener('click',()=>windGenerate());
$('btn-wind-project').addEventListener('click',()=>wind4Open());
(()=>{const d=$('wind4-dialog');if(!d)return;
  d.querySelector('[data-w4-close]').addEventListener('click',()=>d.close());
  $('wind4-prev').addEventListener('click',()=>{if(WIND4.step>1){WIND4.step--;wind4Render()}});
  $('wind4-next').addEventListener('click',()=>{if(WIND4.step<4){WIND4.step++;wind4Render()}});
  $('wind4-gen').addEventListener('click',()=>wind4CreateProject().catch(e=>{console.error(e);alert(e.message)}));
  d.querySelectorAll('[data-w4-step]').forEach(b=>b.addEventListener('click',()=>{WIND4.step=+b.dataset.w4Step;wind4Render()}));
})();
$('btn-wind-workspace').addEventListener('click',()=>WIND4.project?wind4ApplyToChild(WIND4.project,true):openWindWorkspace());
$('btn-wind-sync').addEventListener('click',()=>windSync(true));
$('btn-wind-back').addEventListener('click',closeWindWorkspace);
async function wind4ActivateBlock(id){
  const p=WIND4.project;if(!p||!p.blocks.some(b=>b.id===id))return;
  p.active=id;p.updatedAt=new Date().toISOString();await wind4DbPut(p);
  await wind4ApplyToChild(p,false);wind4RenderBlockSelect();
}
$('wind-block-select').addEventListener('change',e=>wind4ActivateBlock(e.target.value));
$('btn-wind-geom-toggle').addEventListener('click',e=>{const ws=$('wind-workspace'),closed=ws.classList.toggle('geometry-collapsed');e.currentTarget.textContent=closed?'展開幾何':'收合幾何'});

$('btn-stud-workspace').addEventListener('click',()=>openStudWorkspace());
$('btn-stud-run').addEventListener('click',()=>studRun(true));
$('btn-stud-back').addEventListener('click',closeStudWorkspace);
$('stud-frame').addEventListener('change',()=>renderStudStations());
/* V4.15.0：同上。剪力釘的摘要與工作區是即時更新的，故直接重跑（不開工作區）。 */
$('stud-combo-scope').addEventListener('change',()=>{try{studRun(false)}catch(e){console.error(e)}});
const studBaseV305Render=v305RenderStatus;
v305RenderStatus=function(...a){const out=studBaseV305Render.apply(this,a);try{renderStudSummary()}catch(e){console.error(e)}return out};
/* V4.15.0：載入模型後同步刷新風力與地震力卡片（V4.4.x～V4.15.0 漏接，兩張卡會停在「尚未載入模型」）*/
const wsBaseRenderFoundationSummary=renderFoundationSummary;
renderFoundationSummary=function(...args){
  const out=wsBaseRenderFoundationSummary.apply(this,args);
  try{renderWindSummary()}catch(e){console.error(e)}
  try{renderSeisSummary()}catch(e){console.error(e)}
  return out;
};
const pmBaseRenderFoundationSummary=renderFoundationSummary;
renderFoundationSummary=function(...args){const out=pmBaseRenderFoundationSummary.apply(this,args);try{renderPmSummary()}catch(e){console.error(e)}return out};


/* ════════ V3.0.7 PROJECT-FIRST FOUNDATION WORKFLOW ════════ */
const V300={
  version:'3.0.6',draft:null,activeProject:null,pendingOpen:null,step:1,
  childProjectId:'',pendingChildProject:null,requestMap:new Map(),saveTimer:0
};
window.__V300_ACTIVE=true;
const v300Clone=x=>JSON.parse(JSON.stringify(x));
const v300Esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const v300Id=(p='P')=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const v300Now=()=>new Date().toISOString();
const v300Num=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;

function v300Db(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('S2K_F2K_V300',1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'})};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function v300DbDo(mode,fn){
  const db=await v300Db();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects',mode),st=tx.objectStore('projects'),req=fn(st);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();
  });
}
const v300All=()=>v300DbDo('readonly',s=>s.getAll());
const v300Get=id=>v300DbDo('readonly',s=>s.get(id));
const v300Put=p=>v300DbDo('readwrite',s=>s.put(p));
const v300Delete=id=>v300DbDo('readwrite',s=>s.delete(id));
const wind4DbPut=p=>v300Put(p);
async function wind4RestoreForSource(){
  if(!currentS2KFileName)return;
  const all=(await v300All()).filter(p=>p?.kind==='wind'&&p.source?.fileName===currentS2KFileName&&(!p.source?.text||p.source.text===currentS2KText))
    .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  if(!all.length)return;
  const p=all[0],fresh=wind4Draft();(p.blocks||[]).forEach(b=>{const f=fresh.blocks.find(x=>x.id===b.id);
    if(!Array.isArray(b.openings))b.openings=[0,0,0,0,0];if(!b.roofType)b.roofType=b.tilt>=1?'mono':'flat';if(!b.enclosure)b.enclosure=b.cls==='closed'?'closed':'open';
    if(!Number.isFinite(+b.slopeX))b.slopeX=+f?.slopeX||0;if(!Number.isFinite(+b.slopeY))b.slopeY=+f?.slopeY||0});
  fresh.minorCandidates=(fresh.minorCandidates||[]).filter(c=>!(p.blocks||[]).some(b=>(c.faceIds||[]).some(id=>(b.faceIds||[]).includes(id))));
  const runtime=wind4BuildFaces(p.blocks||[]),saved=new Map((p.faces||[]).map(f=>[f.key||f.blockId+'|'+f.wind,f]));
  runtime.forEach(f=>{const s=saved.get(f.key);if(s){f.use=s.use!==false;f.spansOverride=(s.spans||[]).join(',')}});
  p.faces=runtime.filter(f=>saved.has(f.key)).map(f=>{const s=saved.get(f.key);return {...s,edge:f.face.edge,zMin:f.face.zMin,B:f.B}});
  WIND4.project=p;WIND4.draft={...fresh,name:p.name,baseZ:p.baseZ,active:p.active||'',blocks:JSON.parse(JSON.stringify(p.blocks||[])),faces:runtime};
  windNote='已恢復風力專案「'+p.name+'」。';renderWindSummary();
}

function v300CaseDefinitions(){
  const rows=tables?.['LOAD CASE DEFINITIONS']||tables?.['ANALYSIS CASE DEFINITIONS']||[];
  return rows.map(r=>({name:String(r.Case||r.CaseName||r.Name||''),type:String(r.Type||r.CaseType||''),designType:String(r.DesignType||'')}))
    .filter(x=>x.name&&!/response\s*spectrum|respspec|time\s*history|timehist/i.test(x.type));
}
function v300LoadDefinitions(){
  const cases=v300CaseDefinitions(),caseNames=new Set(cases.map(x=>x.name));
  const allCaseRows=tables?.['LOAD CASE DEFINITIONS']||tables?.['ANALYSIS CASE DEFINITIONS']||[];
  const unsupportedCases=new Set(allCaseRows.filter(r=>/response\s*spectrum|respspec|time\s*history|timehist/i.test(String(r.Type||r.CaseType||'')))
    .map(r=>String(r.Case||r.CaseName||r.Name||'')).filter(Boolean));
  const rows=tables?.['COMBINATION DEFINITIONS']||[];
  const raw=new Map(),meta=new Map();
  for(const r of rows){
    const name=String(r.ComboName||r.Combo||'');if(!name)continue;
    if(!raw.has(name))raw.set(name,[]);
    const target=String(r.CaseName||r.LoadName||'');
    if(target)raw.get(name).push({target,factor:v300Num(r.ScaleFactor??r.SF,0)});
    if(r.ComboType)meta.set(name,String(r.ComboType));
  }
  const expand=(name,stack=new Set())=>{
    if(stack.has(name))return {};
    const out={},next=new Set(stack);next.add(name);
    for(const t of raw.get(name)||[]){
      if(raw.has(t.target)&&!caseNames.has(t.target)){
        const sub=expand(t.target,next);for(const [k,v] of Object.entries(sub))out[k]=(out[k]||0)+t.factor*v;
      }else out[t.target]=(out[t.target]||0)+t.factor;
    }
    return out;
  };
  const combinations=[];
  for(const name of raw.keys()){
    const type=(meta.get(name)||'Linear Add').toLowerCase();
    if(type&&!type.includes('linear'))continue;
    const factors=expand(name);if(Object.keys(factors).some(x=>unsupportedCases.has(x)))continue;
    if(Object.keys(factors).length)combinations.push({name,factors});
  }
  const loadNames=[...new Set([...cases.map(x=>x.name),...combinations.flatMap(x=>Object.keys(x.factors))])].filter(Boolean);
  return {cases,combinations,loadNames};
}

function v300CandidateLevels(){
  const byZ=new Map(),tol=.002;
  for(const f of model?.frames||[]){
    const a=model.joints[String(f.i)],b=model.joints[String(f.j)];if(!a||!b)continue;
    const low=a.z<=b.z?a:b,high=a.z<=b.z?b:a,dz=high.z-low.z,dr=Math.hypot(high.x-low.x,high.y-low.y);
    if(dz>.15&&dr/Math.max(dz,.001)<.15){
      const key=[...byZ.keys()].find(z=>Math.abs(z-low.z)<tol)??low.z;
      if(!byZ.has(key))byZ.set(key,new Set());byZ.get(key).add(String(low.id));
    }
  }
  if(!byZ.size){
    for(const [id,r] of Object.entries(model?.restraints||{}))if((r||[]).some(Boolean)){
      const j=model.joints[id],key=[...byZ.keys()].find(z=>Math.abs(z-j.z)<tol)??j.z;
      if(!byZ.has(key))byZ.set(key,new Set());byZ.get(key).add(String(id));
    }
  }
  return [...byZ.entries()].map(([z,ids])=>({z:+z,ids:[...ids].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))})).sort((a,b)=>a.z-b.z);
}
function v300RowsAt(z,prior=[]){
  const levels=v300CandidateLevels(),lv=levels.find(x=>Math.abs(x.z-z)<.003)||levels[0],old=new Map(prior.map(x=>[String(x.id),x]));
  return (lv?.ids||[]).map((id,i)=>{
    const j=model.joints[id],p=old.get(id)||{};
    return {id,selected:p.selected!==false,x:j.x,y:j.y,z:j.z,group:p.group||('F-'+id),
      a:v300Num(p.a,.7),b:v300Num(p.b,.7),Lx:v300Num(p.Lx,3),Ly:v300Num(p.Ly,3),
      slabThickness:v300Num(p.slabThickness,1.2),coverDepth:v300Num(p.coverDepth,.8),pedestalHeight:v300Num(p.pedestalHeight,.3)};
  });
}
function v300BeginDraft(){
  const levels=v300CandidateLevels(),z=levels[0]?.z??0;
  V300.activeProject=null;V300.step=1;V300.childProjectId='';foundationState=null;
  foundationSyncAttempted=true;
  V300.draft={id:null,name:String(currentS2KFileName||'新工程').replace(/\.(s2k|\$2k|txt)$/i,''),
    source:{fileName:currentS2KFileName,text:currentS2KText,program:'SAP2000',version:model?.version||'',units:model?.units||'',
      tableCount:Object.keys(tables||{}).length,loadedAt:v300Now()},
    baseZ:z,rows:v300RowsAt(z),reactionDataset:{fileName:'',importedAt:'',rows:[],warnings:[]},
    loadDefinitions:v300LoadDefinitions(),gradeBeams:[],rafts:[],piles:[]};
  v300Status();renderFoundationSummary();
}
function v300ApplyOpenedProject(p){
  V300.activeProject=p;V300.draft=v300Clone(p);
  V300.draft.rows=v300Clone(p.setupRows||[]).length?v300Clone(p.setupRows):v300RowsAt(p.baseZ??v300CandidateLevels()[0]?.z??0);
  V300.step=1;foundationSyncAttempted=true;
  v300Status();renderFoundationSummary();
}

function v300UnitFactors(unit){
  const s=String(unit||'Tonf, m').toLowerCase(),parts=s.split(',').map(x=>x.trim()),fu=parts[0]||'tonf',lu=parts[1]||'m';
  let f=1,l=1;
  if(/\bkn\b/.test(fu))f=1/9.80665;else if(/\bn\b/.test(fu))f=1/9806.65;else if(/kgf|kg/.test(fu))f=.001;
  else if(/kip/.test(fu))f=1/2.2046226218;else if(/lbf|lb/.test(fu))f=1/2204.6226218;
  if(/^mm/.test(lu))l=.001;else if(/^cm/.test(lu))l=.01;else if(/^in/.test(lu))l=.0254;else if(/^ft/.test(lu))l=.3048;
  return {f,m:f*l};
}
function v300ReactionRows(T){
  const key=Object.keys(T||{}).find(k=>/JOINT.*REACTION|REACTION.*JOINT/i.test(k));
  if(!key)return {rows:[],warnings:['找不到 Joint Reactions 表格。'],table:''};
  const pc=(T['PROGRAM CONTROL']||[])[0]||{},unit=String(pc.CurrUnits||model?.units||''),fac=v300UnitFactors(unit);
  const out=[],warnings=[],seen=new Map();
  for(const r of T[key]||[]){
    const joint=String(r.Joint??r.Point??r.JointLabel??'').trim(),name=String(r.OutputCase??r.Case??r.CaseName??r.LoadCase??'').trim();
    const type=String(r.CaseType||r.Type||''),step=String(r.StepType||r.Step||'');
    if(!joint||!name)continue;
    if(/modal|response\s*spectrum|time\s*history/i.test(type)||/max|min|envelope/i.test(step))continue;
    const row={joint,case:name,caseType:type||'LinStatic',
      F1:v300Num(r.F1??r.FX)*fac.f,F2:v300Num(r.F2??r.FY)*fac.f,F3:v300Num(r.F3??r.FZ)*fac.f,
      M1:v300Num(r.M1??r.MX)*fac.m,M2:v300Num(r.M2??r.MY)*fac.m,M3:v300Num(r.M3??r.MZ)*fac.m};
    const k=joint+'|'+name;if(seen.has(k))warnings.push('重複反力 '+k+'，已採最後一筆。');seen.set(k,row);
  }
  out.push(...seen.values());return {rows:out,warnings,table:key,units:unit};
}
function v300NormalizeHeader(x){return String(x||'').trim().toLowerCase().replace(/[\s_\/()\-]/g,'')}
function v300RowsFromMatrix(matrix){
  let hi=-1,map={};
  for(let i=0;i<Math.min(40,matrix.length);i++){
    const h=(matrix[i]||[]).map(v300NormalizeHeader);
    const find=(...a)=>h.findIndex(x=>a.includes(x));
    const x={joint:find('joint','point','jointlabel'),case:find('outputcase','case','casename','loadcase'),
      caseType:find('casetype','type'),step:find('steptype','step'),F1:find('f1','fx'),F2:find('f2','fy'),F3:find('f3','fz'),
      M1:find('m1','mx'),M2:find('m2','my'),M3:find('m3','mz')};
    if(x.joint>=0&&x.case>=0&&x.F1>=0&&x.F2>=0&&x.F3>=0){hi=i;map=x;break}
  }
  if(hi<0)return [];
  const seen=new Map();
  for(const a of matrix.slice(hi+1)){
    const joint=String(a[map.joint]??'').trim(),name=String(a[map.case]??'').trim();if(!joint||!name)continue;
    const type=map.caseType>=0?String(a[map.caseType]??''):'LinStatic',step=map.step>=0?String(a[map.step]??''):'';
    if(/modal|response\s*spectrum|time\s*history/i.test(type)||/max|min|envelope/i.test(step))continue;
    const r={joint,case:name,caseType:type||'LinStatic'};for(const k of ['F1','F2','F3','M1','M2','M3'])r[k]=v300Num(a[map[k]],0);
    seen.set(joint+'|'+name,r);
  }
  return [...seen.values()];
}
async function v300ImportReactionFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();let rows=[],warnings=[],units='Tonf, m',table='';
  if(['s2k','$2k','txt'].includes(ext)){
    const text=await file.text(),r=v300ReactionRows(parseS2K(text));rows=r.rows;warnings=r.warnings;units=r.units;table=r.table;
  }else if(['xlsx','xls'].includes(ext)){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    for(const sn of wb.SheetNames){const x=v300RowsFromMatrix(XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''}));if(x.length){rows=x;table=sn;break}}
    if(!rows.length)warnings.push('Excel 中找不到 Joint／OutputCase／F1～M3 欄位。');
  }else{
    const text=await file.text(),lines=text.split(/\r?\n/).filter(Boolean),sep=lines[0]?.includes('\t')?'\t':',';
    rows=v300RowsFromMatrix(lines.map(x=>x.split(sep).map(v=>v.replace(/^"|"$/g,'').trim())));
  }
  if(!rows.length)throw new Error(warnings[0]||'沒有可匯入的柱底反力。');
  V300.draft.reactionDataset={fileName:file.name,importedAt:v300Now(),rows,warnings,units,table};
  v300RenderWizard();
}
function v300Completeness(){
  const ids=new Set((V300.draft?.rows||[]).filter(x=>x.selected).map(x=>String(x.id)));
  const caseNames=new Set((V300.draft?.loadDefinitions?.cases||[]).map(x=>x.name));
  const rows=V300.draft?.reactionDataset?.rows||[],byJoint=new Map(),unknownJoints=new Set(),unknownCases=new Set();
  for(const r of rows){
    if(!ids.has(String(r.joint)))unknownJoints.add(String(r.joint));
    if(caseNames.size&&!caseNames.has(r.case))unknownCases.add(r.case);
    if(ids.has(String(r.joint))){if(!byJoint.has(String(r.joint)))byJoint.set(String(r.joint),new Set());byJoint.get(String(r.joint)).add(r.case)}
  }
  const missing=[...ids].filter(id=>!byJoint.has(id));
  return {selected:ids.size,reactions:rows.length,jointsWithReactions:byJoint.size,missing,unknownJoints:[...unknownJoints],unknownCases:[...unknownCases],byJoint};
}
function v300Foundations(){
  const selected=(V300.draft?.rows||[]).filter(r=>r.selected),groups=new Map();
  for(const r of selected){const k=String(r.group||('F-'+r.id)).trim()||('F-'+r.id);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
  const geometry=v300GroupGeometry();
  return [...groups.entries()].map(([name,rs],i)=>{
    const g=geometry.find(x=>x.name===name),minJx=Math.min(...rs.map(r=>r.x)),maxJx=Math.max(...rs.map(r=>r.x));
    const minJy=Math.min(...rs.map(r=>r.y)),maxJy=Math.max(...rs.map(r=>r.y));
    const minX=minJx-g.xMinus,maxX=maxJx+g.xPlus,minY=minJy-g.yMinus,maxY=maxJy+g.yPlus;
    return {id:'F'+(i+1),name,type:rs.length>1?'combined-footing':'isolated-footing',jointIds:rs.map(x=>String(x.id)),
      polygon:[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}],
      slabThickness:Math.max(...rs.map(x=>x.slabThickness)),coverDepth:Math.max(...rs.map(x=>x.coverDepth)),
      pedestalHeight:Math.max(...rs.map(x=>x.pedestalHeight))};
  });
}
function v300GroupGeometry(){
  if(!V300.draft)return [];
  const selected=(V300.draft.rows||[]).filter(r=>r.selected),groups=new Map();
  for(const r of selected){const name=String(r.group||('F-'+r.id)).trim()||('F-'+r.id);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r)}
  V300.draft.geometryByGroup=V300.draft.geometryByGroup||{};
  const existing=V300.draft.foundationElements||[];
  return [...groups.entries()].map(([name,rows])=>{
    let g=V300.draft.geometryByGroup[name];
    if(!g){
      const old=existing.find(f=>String(f.name)===name),xs=rows.map(r=>r.x),ys=rows.map(r=>r.y);
      if(old?.polygon?.length){
        const px=old.polygon.map(v=>v.x),py=old.polygon.map(v=>v.y);
        g={xMinus:Math.max(0,Math.min(...xs)-Math.min(...px)),xPlus:Math.max(0,Math.max(...px)-Math.max(...xs)),
          yMinus:Math.max(0,Math.min(...ys)-Math.min(...py)),yPlus:Math.max(0,Math.max(...py)-Math.max(...ys))};
      }else{
        const lx=Math.max(...rows.map(r=>v300Num(r.Lx,3))),ly=Math.max(...rows.map(r=>v300Num(r.Ly,3)));
        g={xMinus:lx/2,xPlus:lx/2,yMinus:ly/2,yPlus:ly/2};
      }
      V300.draft.geometryByGroup[name]=g;
    }
    const spanX=Math.max(...rows.map(r=>r.x))-Math.min(...rows.map(r=>r.x)),spanY=Math.max(...rows.map(r=>r.y))-Math.min(...rows.map(r=>r.y));
    return {name,rows,xMinus:v300Num(g.xMinus,1.5),xPlus:v300Num(g.xPlus,1.5),
      yMinus:v300Num(g.yMinus,1.5),yPlus:v300Num(g.yPlus,1.5),
      Lx:spanX+v300Num(g.xMinus,1.5)+v300Num(g.xPlus,1.5),Ly:spanY+v300Num(g.yMinus,1.5)+v300Num(g.yPlus,1.5)};
  });
}
function v300SupportJoints(){
  return (V300.draft?.rows||[]).filter(r=>r.selected).map(r=>({id:String(r.id),x:r.x,y:r.y,z:r.z,a:r.a,b:r.b,foundationName:r.group}));
}

function v300PlanSvg(){
  const rows=V300.draft?.rows||[],found=v300Foundations(),pts=[...rows.map(x=>({x:x.x,y:x.y})),...found.flatMap(f=>f.polygon)];
  if(!pts.length)return '<div class="v300-note">沒有可預覽的柱腳。</div>';
  let minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x)),minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y));
  const pad=Math.max(1,Math.max(maxX-minX,maxY-minY)*.08);minX-=pad;maxX+=pad;minY-=pad;maxY+=pad;
  const W=900,H=650,dx=Math.max(maxX-minX,.001),dy=Math.max(maxY-minY,.001),scale=Math.min((W-60)/dx,(H-60)/dy);
  const ox=(W-dx*scale)/2-minX*scale,oy=(H-dy*scale)/2+maxY*scale,sx=x=>ox+x*scale,sy=y=>oy-y*scale;
  let s='<svg viewBox="0 0 '+W+' '+H+'" aria-label="基礎平面預覽"><rect width="100%" height="100%" fill="#0c1627"/>';
  for(const g of model?.grids||[]){
    if(/^x$/i.test(g.dir)){const x=sx(g.c);s+='<line x1="'+x+'" y1="20" x2="'+x+'" y2="'+(H-20)+'" stroke="#334155" stroke-dasharray="5 5"/><text x="'+(x+4)+'" y="18" fill="#94a3b8" font-size="12">'+v300Esc(g.id)+'</text>'}
    if(/^y$/i.test(g.dir)){const y=sy(g.c);s+='<line x1="20" y1="'+y+'" x2="'+(W-20)+'" y2="'+y+'" stroke="#334155" stroke-dasharray="5 5"/><text x="4" y="'+(y-4)+'" fill="#94a3b8" font-size="12">'+v300Esc(g.id)+'</text>'}
  }
  for(const f of found){const p=f.polygon.map((v,i)=>(i?'L':'M')+sx(v.x)+','+sy(v.y)).join(' ')+' Z';s+='<path d="'+p+'" fill="rgba(45,212,191,.16)" stroke="#2dd4bf" stroke-width="2"/><text x="'+sx((f.polygon[0].x+f.polygon[2].x)/2)+'" y="'+sy((f.polygon[0].y+f.polygon[2].y)/2)+'" fill="#5eead4" font-size="13" font-weight="800" text-anchor="middle">'+v300Esc(f.name)+'</text>'}
  for(const r of rows){const c=r.selected?'#60a5fa':'#64748b';s+='<g data-v300-joint="'+v300Esc(r.id)+'" style="cursor:pointer"><circle cx="'+sx(r.x)+'" cy="'+sy(r.y)+'" r="8" fill="'+c+'" stroke="#e2e8f0" stroke-width="2"/><text x="'+(sx(r.x)+10)+'" y="'+(sy(r.y)-10)+'" fill="#e2e8f0" font-size="12">J'+v300Esc(r.id)+'</text></g>'}
  return s+'</svg>';
}
function v300Preview(){
  return '<div class="v300-preview-bar"><b>基礎平面預覽</b><span>藍色＝已指派柱腳</span><span>綠框＝基礎幾何</span><span>X／Y 同比例</span><span class="v300-sp"></span><span>Z='+v300Num(V300.draft?.baseZ).toFixed(3)+' m</span></div><div class="v300-svg-wrap">'+v300PlanSvg()+'</div>';
}
function v300Step1(){
  const levels=v300CandidateLevels(),rows=V300.draft.rows;
  return '<h3>1. 指派柱底 Joint</h3><div class="v300-note">系統先找出由目前高程向上延伸的近垂直桿件端點。切換高程不會把其他樓層 Joint 混入本次基礎專案。</div>'+
    '<div class="v300-form"><div class="v300-field"><label>基礎高程</label><select id="v300-base-z">'+levels.map(x=>'<option value="'+x.z+'" '+(Math.abs(x.z-V300.draft.baseZ)<.003?'selected':'')+'>Z = '+x.z.toFixed(3)+' m（'+x.ids.length+' 點）</option>').join('')+'</select></div>'+
    '<div class="v300-field"><label>快速選取</label><div><button class="v300-btn" id="v300-select-all">全選</button> <button class="v300-btn" id="v300-select-none">清除</button></div></div></div>'+
    '<div class="v300-table-wrap"><table class="v300-table"><thead><tr><th>納入<br><small>(－)</small></th><th>Joint<br><small>(－)</small></th><th>X<br><small>(m)</small></th><th>Y<br><small>(m)</small></th><th>Z<br><small>(m)</small></th><th>支承<br><small>(－)</small></th></tr></thead><tbody>'+
    rows.map(r=>'<tr><td><input type="checkbox" data-v300-select="'+v300Esc(r.id)+'" '+(r.selected?'checked':'')+'></td><td><b>'+v300Esc(r.id)+'</b></td><td>'+r.x.toFixed(3)+'</td><td>'+r.y.toFixed(3)+'</td><td>'+r.z.toFixed(3)+'</td><td>'+(model.restraints[r.id]?.some(Boolean)?'有':'—')+'</td></tr>').join('')+'</tbody></table></div>';
}
function v300Step2(){
  const rows=V300.draft.rows.filter(r=>r.selected),groups=v300GroupGeometry();
  return '<h3>2. 建立基礎幾何</h3><div class="v300-note">先用「基礎名稱」把 Joint 分組；相同名稱即屬同一塊聯合基礎。下方再以最外側 Joint 中心線為基準，輸入 −X、+X、−Y、+Y 四個方向的基礎外伸量，Lx、Ly 由程式自動算出。</div>'+
    '<div style="margin-bottom:10px"><button class="v300-btn" id="v300-individual">每柱獨立</button> <button class="v300-btn" id="v300-combine">全部合併</button></div>'+
    '<div class="v300-table-wrap" style="max-height:30vh"><table class="v300-table"><thead><tr><th>Joint<br><small>(－)</small></th><th>基礎名稱／分組<br><small>(－)</small></th><th>柱墩 a<br><small>(m)</small></th><th>柱墩 b<br><small>(m)</small></th><th>板厚<br><small>(m)</small></th><th>覆土深<br><small>(m)</small></th></tr></thead><tbody>'+
    rows.map(r=>'<tr><td><b>'+v300Esc(r.id)+'</b></td><td><input data-v300-field="group" data-id="'+v300Esc(r.id)+'" value="'+v300Esc(r.group)+'"></td>'+
      ['a','b','slabThickness','coverDepth'].map(k=>'<td><input type="number" step="0.05" min="0" data-v300-field="'+k+'" data-id="'+v300Esc(r.id)+'" value="'+r[k]+'"></td>').join('')+'</tr>').join('')+
    '</tbody></table></div><h3 style="margin-top:16px">基礎外框與外伸量</h3><div class="v300-table-wrap" style="max-height:28vh"><table class="v300-table"><thead><tr><th>基礎<br><small>(－)</small></th><th>包含 Joint<br><small>(－)</small></th><th>−X 外伸<br><small>(m)</small></th><th>+X 外伸<br><small>(m)</small></th><th>−Y 外伸<br><small>(m)</small></th><th>+Y 外伸<br><small>(m)</small></th><th>自動 Lx<br><small>(m)</small></th><th>自動 Ly<br><small>(m)</small></th></tr></thead><tbody>'+
    groups.map(g=>'<tr><td><b>'+v300Esc(g.name)+'</b></td><td>'+g.rows.map(r=>'J'+v300Esc(r.id)).join('、')+'</td>'+
      ['xMinus','xPlus','yMinus','yPlus'].map(k=>'<td><input type="number" step="0.05" min="0" data-v300-group-field="'+k+'" data-group="'+v300Esc(g.name)+'" value="'+g[k]+'"></td>').join('')+
      '<td class="v300-derived">'+g.Lx.toFixed(3)+'</td><td class="v300-derived">'+g.Ly.toFixed(3)+'</td></tr>').join('')+
    '</tbody></table></div><div class="v300-note warn">V3.0.7 本階段啟用獨立／聯合淺基礎。筏基、地梁、基樁資料欄位已保留，但承載力與基樁檢核尚未開放。</div>';
}
function v300Step3(){
  const c=v300Completeness(),d=V300.draft.reactionDataset;
  return '<h3>3. 匯入柱底 Load Case Joint Reaction</h3><div class="v300-note">主 S2K 提供 Joint 座標與 Load Case／Load Comb；反力檔只補入柱底 Joint Reaction。支援 SAP2000 選取柱底後匯出的 S2K，以及含 Joint、OutputCase、F1～M3 欄位的 XLSX／CSV。</div>'+
    '<input id="v300-reaction-file" type="file" accept=".s2k,.$2k,.xlsx,.xls,.csv,.txt" hidden><div class="v300-drop" id="v300-reaction-drop"><b>選擇或拖入柱底反力檔</b><br><span style="color:var(--dim);font-size:.7rem">'+(d.fileName?'目前：'+v300Esc(d.fileName):'尚未匯入')+'</span></div>'+
    '<div class="v300-kpis"><div class="v300-kpi"><b>'+c.selected+'</b><span>選定柱腳</span></div><div class="v300-kpi"><b>'+c.reactions+'</b><span>反力筆數</span></div><div class="v300-kpi"><b>'+c.jointsWithReactions+'</b><span>已有反力 Joint</span></div><div class="v300-kpi"><b>'+c.missing.length+'</b><span>缺反力 Joint</span></div></div>'+
    (c.reactions?'<div class="v300-note '+(c.missing.length?'warn':'ok')+'">'+(c.missing.length?'缺反力：J'+c.missing.join('、J'):'所有選定柱腳至少有一筆反力')+
      (c.unknownCases.length?'<br>反力檔中不在主 S2K Load Case 定義的名稱：'+v300Esc(c.unknownCases.slice(0,12).join('、')):'')+'</div>':'<div class="v300-note warn">可以先建立「缺反力」專案，但穩定性與穿孔剪力計算前必須補齊。</div>');
}
function v300Step4(){
  const c=v300Completeness(),f=v300Foundations(),ld=V300.draft.loadDefinitions;
  return '<h3>4. 確認並建立專案</h3><div class="v300-form"><div class="v300-field"><label>專案名稱</label><input id="v300-project-name" value="'+v300Esc(V300.draft.name)+'"></div>'+
    '<div class="v300-field"><label>狀態</label><div style="padding-top:7px"><span class="v300-pill '+(c.missing.length?'warn':'ok')+'">'+(c.missing.length?'缺反力':'可計算')+'</span></div></div></div>'+
    '<div class="v300-kpis"><div class="v300-kpi"><b>'+c.selected+'</b><span>Support Joint</span></div><div class="v300-kpi"><b>'+f.length+'</b><span>Foundation Element</span></div><div class="v300-kpi"><b>'+ld.cases.length+'</b><span>Load Case</span></div><div class="v300-kpi"><b>'+ld.combinations.length+'</b><span>Linear Load Comb</span></div></div>'+
    '<div class="v300-note"><b>將建立的專案內容</b><br>主模型：'+v300Esc(V300.draft.source.fileName)+'<br>柱底反力：'+v300Esc(V300.draft.reactionDataset.fileName||'尚未匯入')+
    '<br>基礎：'+f.map(x=>v300Esc(x.name)+'（'+x.jointIds.map(j=>'J'+v300Esc(j)).join('、')+'）').join('；')+'</div>'+
    '<div class="v300-note warn">建立專案只代表資料關聯完整。基礎承載力、筏基、地梁與基樁承載力仍屬後續功能，不會在本版標示為已檢核。</div>';
}
function v300RenderWizard(){
  const d=$('v300-setup-dialog');if(!d||!V300.draft)return;
  d.querySelector('#v300-preview').innerHTML=v300Preview();
  d.querySelector('#v300-panel').innerHTML=[v300Step1,v300Step2,v300Step3,v300Step4][V300.step-1]();
  d.querySelectorAll('.v300-step').forEach((b,i)=>{b.classList.toggle('active',i+1===V300.step);b.classList.toggle('done',i+1<V300.step)});
  d.querySelector('#v300-prev').disabled=V300.step===1;d.querySelector('#v300-next').classList.toggle('v300-hidden',V300.step===4);
  d.querySelector('#v300-create').classList.toggle('v300-hidden',V300.step!==4);
  const bind=(sel,ev,fn)=>d.querySelector(sel)?.addEventListener(ev,fn);
  bind('#v300-base-z','change',e=>{V300.draft.baseZ=+e.target.value;V300.draft.rows=v300RowsAt(V300.draft.baseZ,V300.draft.rows);v300RenderWizard()});
  bind('#v300-select-all','click',()=>{V300.draft.rows.forEach(x=>x.selected=true);v300RenderWizard()});
  bind('#v300-select-none','click',()=>{V300.draft.rows.forEach(x=>x.selected=false);v300RenderWizard()});
  d.querySelectorAll('[data-v300-select]').forEach(x=>x.addEventListener('change',()=>{const r=V300.draft.rows.find(r=>r.id===x.dataset.v300Select);if(r)r.selected=x.checked;v300RenderWizard()}));
  d.querySelectorAll('[data-v300-field]').forEach(x=>x.addEventListener('change',()=>{const r=V300.draft.rows.find(r=>r.id===x.dataset.id);if(r)r[x.dataset.v300Field]=x.dataset.v300Field==='group'?x.value:v300Num(x.value,r[x.dataset.v300Field]);v300RenderWizard()}));
  d.querySelectorAll('[data-v300-group-field]').forEach(x=>x.addEventListener('change',()=>{const g=V300.draft.geometryByGroup?.[x.dataset.group];if(g)g[x.dataset.v300GroupField]=Math.max(0,v300Num(x.value,g[x.dataset.v300GroupField]));v300RenderWizard()}));
  d.querySelectorAll('[data-v300-joint]').forEach(x=>x.addEventListener('click',()=>{const r=V300.draft.rows.find(r=>r.id===x.dataset.v300Joint);if(r)r.selected=!r.selected;v300RenderWizard()}));
  bind('#v300-individual','click',()=>{V300.draft.rows.filter(x=>x.selected).forEach(x=>x.group='F-'+x.id);v300RenderWizard()});
  bind('#v300-combine','click',()=>{V300.draft.rows.filter(x=>x.selected).forEach(x=>x.group='F-COMB');v300RenderWizard()});
  const input=d.querySelector('#v300-reaction-file'),drop=d.querySelector('#v300-reaction-drop');
  if(input&&drop){drop.onclick=()=>input.click();input.onchange=async()=>{try{if(input.files[0])await v300ImportReactionFile(input.files[0])}catch(e){alert(e.message)}};
    drop.ondragover=e=>{e.preventDefault()};drop.ondrop=async e=>{e.preventDefault();try{if(e.dataTransfer.files[0])await v300ImportReactionFile(e.dataTransfer.files[0])}catch(x){alert(x.message)}}}
  bind('#v300-project-name','change',e=>V300.draft.name=e.target.value.trim()||V300.draft.name);
}
function v300OpenWizard(){
  if(!currentS2KText){alert('請先讀取主 S2K。');return}
  if(!V300.draft)v300BeginDraft();
  const d=$('v300-setup-dialog');v300RenderWizard();d.showModal();
}

async function v300CreateProject(){
  const selected=V300.draft.rows.filter(x=>x.selected);if(!selected.length){alert('至少選擇一個柱底 Joint。');V300.step=1;v300RenderWizard();return}
  const foundations=v300Foundations();if(!foundations.length){alert('尚未建立基礎幾何。');return}
  const complete=v300Completeness();if(!complete.reactions||complete.missing.length){
    alert('柱底反力尚未完整：'+(complete.missing.length?'缺 J'+complete.missing.join('、J'):'尚未匯入反力檔')+'。請先補齊再建立專案。');
    V300.step=3;v300RenderWizard();return;
  }
  const p={schemaVersion:3,kind:'foundation',appVersion:'3.0.6',id:V300.draft.id||v300Id('PRJ'),name:V300.draft.name,
    createdAt:V300.draft.createdAt||v300Now(),updatedAt:v300Now(),source:v300Clone(V300.draft.source),
    baseZ:V300.draft.baseZ,supportJoints:v300SupportJoints(),foundationElements:foundations,geometryByGroup:v300Clone(V300.draft.geometryByGroup||{}),
    setupRows:v300Clone(V300.draft.rows),
    reactionDataset:v300Clone(V300.draft.reactionDataset),loadDefinitions:v300Clone(V300.draft.loadDefinitions),
    gradeBeams:v300Clone(V300.draft.gradeBeams||[]),rafts:v300Clone(V300.draft.rafts||[]),piles:v300Clone(V300.draft.piles||[]),
    childState:V300.draft.childState||null};
  await v300Put(p);V300.activeProject=p;V300.draft=v300Clone(p);V300.draft.rows=selected.map(x=>v300Clone(x));
  $('v300-setup-dialog').close();v300Status();v300ApplyToChild(p,true);
}
function v300ProjectPayload(p){return v300Clone(p)}
function v300ApplyToChild(p,open){
  foundationSyncAttempted=true;V300.pendingChildProject={project:p,open};ensureFoundationFrame();
  if(foundationBridgeReady){foundationPost({type:'v300-apply-project',project:v300ProjectPayload(p)});$('foundation-workspace-status').textContent='正在載入 V3 專案…'}
}
function v300OpenFoundationEditor(){
  if(!V300.activeProject){v300OpenWizard();return}
  const c=v300Completeness();if(!c.reactions||c.missing.length){alert('目前專案柱底反力不完整，請先在「基礎設定」補齊。');v300OpenWizard();return}
  if(V300.childProjectId===V300.activeProject.id)openFoundationWorkspace();
  else v300ApplyToChild(V300.activeProject,true);
}
function v300RequestState(){
  if(!foundationBridgeReady||!V300.activeProject)return Promise.resolve(null);
  return new Promise(resolve=>{const id=v300Id('REQ'),timer=setTimeout(()=>{V300.requestMap.delete(id);resolve(null)},1800);
    V300.requestMap.set(id,x=>{clearTimeout(timer);resolve(x)});foundationPost({type:'v300-request-full-state',requestId:id})});
}
async function v300SaveActiveProject(silent=false){
  if(!V300.activeProject)return;
  const child=await v300RequestState();if(child)V300.activeProject.childState=child;
  V300.activeProject.updatedAt=v300Now();await v300Put(V300.activeProject);v300Status();
  if(!silent)$('foundation-workspace-status').textContent='專案已儲存';
}
function v300ScheduleSave(){clearTimeout(V300.saveTimer);V300.saveTimer=setTimeout(()=>v300SaveActiveProject(true),1200)}
function v300Status(){
  const b=$('v300-project-btn');if(!b)return;
  if(V300.activeProject){
    const c=v300Completeness();b.className='v300-project-btn '+(c.missing.length?'missing':'saved');
    b.innerHTML='<span class="v300-dot"></span><span>'+v300Esc(V300.activeProject.name)+'</span>';
  }else if(V300.draft){b.className='v300-project-btn';b.innerHTML='<span class="v300-dot"></span><span>未建立專案</span>'}
  else{b.className='v300-project-btn';b.innerHTML='<span class="v300-dot"></span><span>專案</span>'}
}
async function v300OpenProject(p){
  if(currentS2KText&&$('app')?.classList.contains('on')){
    try{localStorage.setItem('s2k-f2k-v300-pending-project',p.id)}catch(_){}
    location.reload();return;
  }
  V300.pendingOpen=p;
  const f=new File([p.source.text],p.source.fileName||'project.s2k',{type:'text/plain'});
  loadFile(f);$('v300-project-dialog').close();
}
function v300DownloadProject(p){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));
  a.download=(p.name||'S2K_F2K_Project').replace(/[\\/:*?"<>|]/g,'_')+'.s2kf2k.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function v300RenderProjects(){
  const list=(await v300All()).filter(p=>!p.kind||p.kind==='foundation'),box=$('v300-project-grid');
  box.innerHTML=list.length?list.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(p=>{
    const miss=(p.supportJoints||[]).filter(j=>!(p.reactionDataset?.rows||[]).some(r=>String(r.joint)===String(j.id))).length;
    return '<article class="v300-project-card"><h3>'+v300Esc(p.name)+'</h3><p>'+v300Esc(p.source?.fileName||'')+'</p><p>'+(p.supportJoints?.length||0)+' 柱腳・'+(p.foundationElements?.length||0)+' 基礎・'+(p.reactionDataset?.rows?.length||0)+' 反力</p><p><span class="v300-pill '+(miss?'warn':'ok')+'">'+(miss?'缺 '+miss+' 柱反力':'資料可計算')+'</span></p><div class="row"><button class="v300-btn primary" data-open="'+p.id+'">開啟</button><button class="v300-btn" data-export="'+p.id+'">匯出</button><button class="v300-btn danger" data-delete="'+p.id+'">刪除</button></div></article>';
  }).join(''):'<div class="v300-note">尚無 V3 專案。請先讀取主 S2K，再由「基礎分析／F2K」建立。</div>';
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>v300OpenProject(await v300Get(b.dataset.open)));
  box.querySelectorAll('[data-export]').forEach(b=>b.onclick=async()=>v300DownloadProject(await v300Get(b.dataset.export)));
  box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(confirm('刪除此專案？此動作無法復原。')){await v300Delete(b.dataset.delete);v300RenderProjects()}});
}
async function v300ProjectManager(){await v300RenderProjects();$('v300-project-dialog').showModal()}

/*
 * Width-thickness classification is intentionally property-only.  Element
 * Force / Joint Force tables are not required; axial-force-dependent checks
 * such as the combined web limit remain outside this legend classifier.
 */
const v303TwSectionClassTitleBase=twSectionClassTitle;
twSectionClassTitle=function(secName,w){
  if(!w||!w.applicable)return v303TwSectionClassTitleBase(secName,w);
  const sec=model?.sections?.[secName]||{},fy=Number(w.fy)||0;
  const fmt=x=>Number.isFinite(Number(x))?Number(x).toFixed(3):'—';
  const lines=[
    `${secName}｜${w.label}`,
    `Fy=${fmt(fy)} tf/cm²｜${w.basis}`,
    '資料需求：斷面尺寸＋材料 Fy（不匯入 Element Force／Joint Force）'
  ];
  const isI=String(w.shape||'').toUpperCase().includes('I/')||
    String(w.shape||'').toUpperCase().includes('WIDE FLANGE')||
    String(w.shape||'').toUpperCase()==='I';
  const isBox=String(w.shape||'').toUpperCase().includes('BOX')||
    String(w.shape||'').toUpperCase().includes('TUBE')||
    String(w.shape||'').includes('箱型');
  const d=Number(sec.t3)*100,b=Number(sec.t2)*100,tf=Number(sec.tf)*100,tw=Number(sec.tw)*100;
  const welded=String(w.basis||'').includes('銲接I型梁');
  const cjp=String(w.basis||'').includes('全滲透銲組合箱型柱');
  for(const it of w.items||[]){
    let actual=`λ=${fmt(it.lambda)}`,formula='';
    if(isI&&String(it.name).includes('翼板')){
      actual=`λ=b/(2t_f)=${fmt(b)}/(2×${fmt(tf)})=${fmt(it.lambda)}`;
      const fr=welded?1.16:.70,cr=welded?28:37;
      formula=`λpd=14/√Fy；λp=17/√Fy；λr=${cr}/√(Fy−Fr)，Fr=${fr.toFixed(2)} tf/cm²`;
    }else if(isI&&String(it.name).includes('腹板')){
      actual=`λ=h/t_w=(d−2t_f)/t_w=(${fmt(d)}−2×${fmt(tf)})/${fmt(tw)}=${fmt(it.lambda)}`;
      formula='λpd=138/√Fy；λp=170/√Fy；λr=260/√Fy';
    }else if(isBox&&String(it.name).includes('翼板')){
      actual=`λ=b/t_f=(B−2t_w)/t_f=(${fmt(b)}−2×${fmt(tw)})/${fmt(tf)}=${fmt(it.lambda)}`;
      formula=cjp?'λpd=45/√Fy；λp=50/√Fy；λr=63/√Fy':'λpd=30/√Fy；λp=50/√Fy；λr=63/√Fy';
    }else if(isBox&&String(it.name).includes('腹板')){
      actual=`λ=h/t_w=(D−2t_f)/t_w=(${fmt(d)}−2×${fmt(tf)})/${fmt(tw)}=${fmt(it.lambda)}`;
      formula=cjp?'λpd=45/√Fy；λp=50/√Fy；λr=63/√Fy':'λpd=30/√Fy；λp=50/√Fy；λr=63/√Fy';
    }
    lines.push(`${it.name}：${actual}`);
    if(formula)lines.push(`限制公式：${formula}`);
    lines.push(`限制值：λpd=${fmt(it.limits?.pd)}、λp=${fmt(it.limits?.p)}、λr=${fmt(it.limits?.r)} → ${it.label}`);
  }
  if(w.assumption)lines.push(`註：${w.assumption}`);
  lines.push(`無內力受力假設：${isI?'I／H 型斷面按強軸受撓板件分類':isBox?'BOX／HSS 按對應受壓板件分類':'依斷面型式對應表 4.5-1'}`);
  lines.push('整體分類取最不利受壓肢；含 Pu／φPy 的組合腹板限制不在本項檢核。');
  return lines.join('\n');
};

function v300Mount(){
  document.title='S2K＋F2K 整合平台 V4.15.5';
  const title=document.querySelector('#topbar .name');if(title)title.textContent='S2K＋F2K 整合平台 V4.15.5';
  const projectBtn=document.createElement('button');projectBtn.id='v300-project-btn';projectBtn.className='v300-project-btn';
  projectBtn.innerHTML='<span class="v300-dot"></span><span>專案</span>';projectBtn.onclick=v300ProjectManager;
  $('btn-foundation-workspace').before(projectBtn);
  const ds=$('drop-screen');if(ds){const b=document.createElement('button');b.className='btn';b.textContent='開啟既有 V3 專案';b.onclick=e=>{e.stopPropagation();v300ProjectManager()};($('drop-actions')||ds).appendChild(b)}
  document.body.insertAdjacentHTML('beforeend',
    '<dialog id="v300-setup-dialog" class="v300-dialog"><div class="v300-shell"><div class="v300-head"><div><h2>建立基礎分析專案</h2><div class="sub">主 S2K → 柱底 Joint → 基礎幾何 → 柱底反力 → 建立專案</div></div><span class="v300-sp"></span><button class="v300-x" data-close>×</button></div>'+
    '<div class="v300-steps">'+['柱底 Joint','基礎幾何','柱底反力','確認專案'].map((x,i)=>'<button class="v300-step" data-step="'+(i+1)+'">'+(i+1)+'. '+x+'</button>').join('')+'</div>'+
    '<div class="v300-body"><section class="v300-preview" id="v300-preview"></section><section class="v300-panel" id="v300-panel"></section></div>'+
    '<div class="v300-actions"><span id="v300-footnote" style="font-size:.68rem;color:var(--dim)">資料只會寫入目前 V3 專案，不會合併舊專案。</span><span class="v300-sp"></span><button class="v300-btn" id="v300-prev">上一步</button><button class="v300-btn primary" id="v300-next">下一步</button><button class="v300-btn primary v300-hidden" id="v300-create">建立專案並進入基礎分析</button></div></div></dialog>'+
    '<dialog id="v300-project-dialog" class="v300-dialog"><div class="v300-shell" style="width:min(1120px,calc(100vw - 32px));height:min(720px,calc(100vh - 32px))"><div class="v300-head"><div><h2>V3 專案管理</h2><div class="sub">每個專案保存完整主 S2K、柱底反力、基礎指派與計算狀態</div></div><span class="v300-sp"></span><button class="v300-btn" id="v300-import-project">匯入專案 JSON</button><input id="v300-import-project-file" type="file" accept=".json" hidden><button class="v300-x" data-close>×</button></div><div class="v300-project-grid" id="v300-project-grid"></div></div></dialog>');
  document.querySelectorAll('.v300-dialog [data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('#v300-setup-dialog [data-step]').forEach(b=>b.onclick=()=>{V300.step=+b.dataset.step;v300RenderWizard()});
  $('v300-prev').onclick=()=>{V300.step=Math.max(1,V300.step-1);v300RenderWizard()};
  $('v300-next').onclick=()=>{if(V300.step===1&&!V300.draft.rows.some(x=>x.selected)){alert('至少選擇一個柱底 Joint。');return}V300.step=Math.min(4,V300.step+1);v300RenderWizard()};
  $('v300-create').onclick=()=>v300CreateProject().catch(e=>alert(e.message));
  $('v300-import-project').onclick=()=>$('v300-import-project-file').click();
  $('v300-import-project-file').onchange=async e=>{try{const p=JSON.parse(await e.target.files[0].text());if(p.schemaVersion!==3||!p.source?.text)throw new Error('不是有效的 V3 專案檔。');p.id=p.id||v300Id('PRJ');p.updatedAt=v300Now();await v300Put(p);v300RenderProjects()}catch(x){alert(x.message)}};
  ['btn-foundation-workspace','btn-foundation-sidebar'].forEach(id=>$(id)?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();v300OpenFoundationEditor()},true));
  $('btn-foundation-sync')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();v300OpenWizard()},true);
  $('btn-foundation-sync').textContent='基礎設定';
  $('btn-foundation-f2k')?.remove();
  $('btn-foundation-back')?.addEventListener('click',()=>v300SaveActiveProject(true));
  const oldStart=startApp;
  startApp=function(...args){oldStart(...args);foundationSyncAttempted=true;if(V300.pendingOpen){const p=V300.pendingOpen;V300.pendingOpen=null;v300ApplyOpenedProject(p)}else v300BeginDraft()};
  window.addEventListener('message',ev=>{
    const d=ev.data||{};if(d.source!==FOUNDATION_CHILD_SOURCE)return;
    if(d.type==='ready'||d.type==='v300-child-ready'){foundationBridgeReady=true;if(V300.pendingChildProject){const x=V300.pendingChildProject;foundationPost({type:'v300-apply-project',project:v300ProjectPayload(x.project)})}}
    else if(d.type==='v300-project-ready'){V300.childProjectId=String(d.payload?.projectId||'');const x=V300.pendingChildProject;V300.pendingChildProject=null;
      $('foundation-workspace-status').textContent='V3 專案已就緒：'+(d.payload?.foundations||0)+' 基礎・'+(d.payload?.reactions||0)+' 反力';if(x?.open)openFoundationWorkspace()}
    else if(d.type==='v300-full-state'){const cb=V300.requestMap.get(String(d.requestId||''));if(cb){V300.requestMap.delete(String(d.requestId||''));cb(d.payload)}}
    else if(d.type==='state'&&V300.activeProject)v300ScheduleSave();
  });
  v300Status();
  setTimeout(async()=>{
    let id='';try{id=localStorage.getItem('s2k-f2k-v300-pending-project')||'';localStorage.removeItem('s2k-f2k-v300-pending-project')}catch(_){}
    if(id){const p=await v300Get(id);if(p)v300OpenProject(p)}
  },0);
}
v300Mount();


/* ════════ V3.0.7 LOAD-CASE RESULT COMBINATION ENGINE ════════ */
const V304={imported:null,scope:'lrfd',result:null};

function v304NormId(value){
  const s=String(value??'').trim();
  if(/^-?\d+\.0+$/.test(s))return String(Number(s));
  return s;
}
function v304NormType(value){
  return String(value??'').trim().toLowerCase().replace(/[\s_-]+/g,'');
}
function v304Header(value){
  return String(value??'').trim().toLowerCase().replace(/[\s_\/()\-]+/g,'');
}
function v304Finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function v304ForceTable(T){
  return Object.keys(T||{}).find(k=>{
    const n=v304NormType(k);
    return n.includes('elementforces')&&n.includes('frame')&&!n.includes('joint');
  })||'';
}
function v304FrameMaps(T){
  const direct=new Map();
  for(const f of model?.frames||[])direct.set(v304NormId(f.id),String(f.id));
  const elementToObject=new Map(),elements=[];
  const key=Object.keys(T||{}).find(k=>{
    const n=v304NormType(k);
    return n.includes('objectsandelements')&&n.includes('frame');
  });
  for(const r of (key?T[key]:[])||[]){
    const object=v304NormId(r.Object??r.Frame??r.FrameObject??r.ObjectLabel??'');
    const element=v304NormId(r.Element??r.FrameElem??r.FrameElement??r.ElementLabel??r.Elm??'');
    const jointI=v304NormId(r.ElemJtI??r.JointI??r.PointI??''),jointJ=v304NormId(r.ElemJtJ??r.JointJ??r.PointJ??'');
    if(object&&element){
      elementToObject.set(element,object);
      if(jointI&&jointJ)elements.push({id:element,object,jointI,jointJ});
    }
  }
  const resolve=value=>{
    const raw=v304NormId(value);
    if(direct.has(raw))return direct.get(raw);
    const object=elementToObject.get(raw);
    return object&&direct.has(object)?direct.get(object):'';
  };
  return {resolve,mappingTable:key||'',mappingCount:elementToObject.size,elements};
}
function v304ReadForceRows(T){
  if(!model)throw new Error('請先讀取主模型 S2K。');
  const table=v304ForceTable(T);
  if(!table)throw new Error('找不到「Element Forces - Frames」表格。');
  const pc=(T['PROGRAM CONTROL']||[])[0]||{};
  const units=String(pc.CurrUnits||model?.units||'Tonf, m');
  const fac=v300UnitFactors(units),fm=v304FrameMaps(T),rows=[];
  let ignoredFrames=0,invalidRows=0;
  for(const r of T[table]||[]){
    const frame=fm.resolve(r.Frame??r.Object??r.FrameObj??r.FrameObject??r.Element??r.FrameElem);
    const outputCase=String(r.OutputCase??r.Case??r.CaseName??r.LoadCase??'').trim();
    const station=v304Finite(r.Station??r.StationLoc??r.OutputStation??r.ObjSta);
    const P=v304Finite(r.P??r.Axial??r.F1);
    if(!frame){ignoredFrames++;continue}
    if(!outputCase||station==null||P==null){invalidRows++;continue}
    rows.push({
      Frame:frame,Station:station,OutputCase:outputCase,
      CaseType:String(r.CaseType??r.Type??''),
      StepType:String(r.StepType??r.Step??''),
      StepNum:String(r.StepNum??r.StepNumber??''),
      FrameElem:v304NormId(r.FrameElem??r.Element??r.FrameElement??''),
      ElemStation:v304Finite(r.ElemStation??r.ElementStation),
      P:P*fac.f,
      V2:v304Finite(r.V2)==null?null:Number(r.V2)*fac.f,
      V3:v304Finite(r.V3)==null?null:Number(r.V3)*fac.f,
      T:v304Finite(r.T)==null?null:Number(r.T)*fac.m,
      M2:v304Finite(r.M2)==null?null:Number(r.M2)*fac.m,
      M3:v304Finite(r.M3)==null?null:Number(r.M3)*fac.m
    });
  }
  return {mode:'element',rows,table,units,mappingTable:fm.mappingTable,mappingCount:fm.mappingCount,
    elements:fm.elements,ignoredFrames,invalidRows};
}
function v304RowsFromAOA(aoa){
  for(let i=0;i<Math.min(40,aoa.length);i++){
    const raw=(aoa[i]||[]).map(x=>String(x??'').trim()),h=raw.map(v304Header);
    const idx=(...names)=>h.findIndex(x=>names.includes(x));
    const map={
      frame:idx('frame','object','frameobject','frameobj','element','frameelem'),
      station:idx('station','stationloc','outputstation','objsta'),
      outputCase:idx('outputcase','case','casename','loadcase'),
      caseType:idx('casetype','type'),stepType:idx('steptype','step'),stepNum:idx('stepnum','stepnumber'),
      P:idx('p','axial'),V2:idx('v2'),V3:idx('v3'),T:idx('t','torsion'),M2:idx('m2'),M3:idx('m3'),
      joint:idx('joint','point','jointlabel'),F3:idx('f3','fz')
    };
    const element=map.frame>=0&&map.station>=0&&map.outputCase>=0&&map.P>=0;
    const legacy=map.frame>=0&&map.joint>=0&&map.outputCase>=0&&map.F3>=0;
    if(!element&&!legacy)continue;
    const rows=[];
    for(const a of aoa.slice(i+1)){
      const frame=v304NormId(a?.[map.frame]),outputCase=String(a?.[map.outputCase]??'').trim();
      if(!frame||!outputCase||/^(text|frame)$/i.test(frame))continue;
      if(element){
        const station=v304Finite(a?.[map.station]),P=v304Finite(a?.[map.P]);
        if(station==null||P==null)continue;
        const component=key=>map[key]>=0?v304Finite(a?.[map[key]]):null;
        rows.push({Frame:frame,Station:station,OutputCase:outputCase,P,
          V2:component('V2'),V3:component('V3'),T:component('T'),M2:component('M2'),M3:component('M3'),
          CaseType:map.caseType>=0?String(a?.[map.caseType]??''):'',
          StepType:map.stepType>=0?String(a?.[map.stepType]??''):'',
          StepNum:map.stepNum>=0?String(a?.[map.stepNum]??''):''});
      }else{
        const F3=v304Finite(a?.[map.F3]);if(F3==null)continue;
        rows.push({Frame:frame,Joint:v304NormId(a?.[map.joint]),OutputCase:outputCase,F3});
      }
    }
    if(rows.length)return {mode:element?'element':'legacy',rows,table:'Spreadsheet'};
  }
  return null;
}
async function v304ReadFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(['s2k','$2k','txt'].includes(ext)){
    const text=await file.text();
    try{
      const T=parseS2K(text),table=v304ForceTable(T);
      if(table)return v304ReadForceRows(T);
    }catch(err){
      if(ext!=='txt')throw err;
    }
    if(ext!=='txt')throw new Error('S2K 中找不到 Element Forces - Frames。');
    const lines=text.split(/\r?\n/).map(l=>l.includes('\t')?l.split('\t'):l.split(','));
    const result=v304RowsFromAOA(lines);
    if(result)return {...result,units:'Tonf, m（文字表假設）'};
  }else if(['xlsx','xls'].includes(ext)){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    for(const sn of wb.SheetNames){
      const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''});
      const result=v304RowsFromAOA(aoa);
      if(result)return {...result,table:sn,units:'Tonf, m（Excel 表假設）'};
    }
  }else{
    const text=await file.text();
    const lines=text.split(/\r?\n/).map(l=>l.includes('\t')?l.split('\t'):l.split(','));
    const result=v304RowsFromAOA(lines);
    if(result)return {...result,units:'Tonf, m（文字表假設）'};
  }
  throw new Error('找不到 Frame／Station／OutputCase／P 欄位。');
}
function v304ComboDefinitions(T=tables){
  const map=new Map();
  for(const r of T?.['COMBINATION DEFINITIONS']||[]){
    const name=String(r.ComboName??r.Combo??'').trim();if(!name)continue;
    if(!map.has(name))map.set(name,{name,type:'Linear Add',terms:[],steelDesign:'',concreteDesign:'',autoDesign:''});
    const d=map.get(name);
    if(r.ComboType)d.type=String(r.ComboType);
    if(r.SteelDesign)d.steelDesign=String(r.SteelDesign);
    if(r.ConcDesign)d.concreteDesign=String(r.ConcDesign);
    if(r.AutoDesign)d.autoDesign=String(r.AutoDesign);
    const target=String(r.CaseName??r.LoadName??'').trim();
    if(target)d.terms.push({target,factor:v300Num(r.ScaleFactor??r.SF,0),caseType:String(r.CaseType??'')});
  }
  return map;
}
function v304FlattenLinear(name,defs,stack=new Set()){
  if(stack.has(name))return {ok:false,reason:'巢狀組合循環',factors:{}};
  const d=defs.get(name);
  if(!d)return {ok:true,factors:{[name]:1}};
  if(!v304NormType(d.type).includes('linearadd'))return {ok:false,reason:'組合類型 '+d.type,factors:{}};
  const next=new Set(stack);next.add(name);
  const factors={};
  for(const term of d.terms){
    const sub=defs.has(term.target)?v304FlattenLinear(term.target,defs,next):{ok:true,factors:{[term.target]:1}};
    if(!sub.ok)return sub;
    for(const [caseName,factor] of Object.entries(sub.factors))factors[caseName]=(factors[caseName]||0)+term.factor*factor;
  }
  for(const k of Object.keys(factors))if(Math.abs(factors[k])<1e-12)delete factors[k];
  return {ok:true,factors};
}
function v304SelectCombos(defs,scope){
  const values=[...defs.values()],amp=d=>/amp|amplified|放大/i.test(d.name);
  let selected;
  if(scope==='amp')selected=values.filter(amp);
  else if(scope==='all')selected=values;
  else{
    selected=values.filter(d=>!amp(d)&&(/strength/i.test(d.steelDesign)||/^lrfd/i.test(d.name)));
    if(!selected.length)selected=values.filter(d=>!amp(d));
  }
  return selected;
}
function v304BuildForceIndex(data){
  const defs=v304ComboDefinitions(),index=new Map(),skippedCases=new Set();
  if(data.mode!=='element')return {defs,index,skippedCases};
  const knownCombos=new Set(defs.keys());
  for(const r of data.rows){
    if(knownCombos.has(r.OutputCase)||/comb/i.test(r.CaseType)){skippedCases.add(r.OutputCase);continue}
    const step=String(r.StepType||'').trim();
    if(step&&/max|min|envelope|mode|time/i.test(step)){skippedCases.add(r.OutputCase);continue}
    const resultId=String(r.FrameElem||r.Frame),resultStation=r.ElemStation==null?r.Station:r.ElemStation;
    const key=resultId+'\u001f'+Number(resultStation).toPrecision(12);
    if(!index.has(key))index.set(key,new Map());
    const cases=index.get(key);
    if(cases.has(r.OutputCase)){skippedCases.add(r.OutputCase);continue}
    cases.set(r.OutputCase,r);
  }
  for(const cases of index.values())for(const c of skippedCases)cases.delete(c);
  return {defs,index,skippedCases};
}
function v304CombinedFrameForce(frameOrElement,station,comboName){
  const fi=V304.forceIndex;if(!fi)return null;
  const key=String(frameOrElement)+'\u001f'+Number(station).toPrecision(12),cases=fi.index.get(key);
  if(!cases)return null;
  const flat=v304FlattenLinear(String(comboName),fi.defs);
  if(!flat.ok)return null;
  const result={Frame:String(frameOrElement),Station:Number(station),OutputCase:String(comboName),source:'HTML Linear Add'};
  for(const component of ['P','V2','V3','T','M2','M3']){
    let sum=0,has=true;
    for(const [caseName,factor] of Object.entries(flat.factors)){
      const value=cases.get(caseName)?.[component];
      if(value==null||!Number.isFinite(Number(value))){has=false;break}
      sum+=factor*Number(value);
    }
    result[component]=has?sum:null;
  }
  return result;
}
function v304EndCaseRows(data){
  if(data.mode==='legacy'){
    return {rows:data.rows,foundCases:new Set(data.rows.map(r=>r.OutputCase)),columnFrames:new Set(data.rows.map(r=>r.Frame)),
      skippedCases:new Set(),warnings:['已採舊版 Element Joint Forces 組合結果；未執行 Load Case 重組。']};
  }
  const objectById=new Map((model?.frames||[]).map(f=>[String(f.id),f]));
  const virtualFrames=(data.elements||[]).map(e=>{
    const object=objectById.get(String(e.object));
    return object?{...object,id:String(e.id),i:String(e.jointI),j:String(e.jointJ),objectId:String(e.object)}:null;
  }).filter(Boolean);
  const classifyFrames=frames=>{
    const cols={},beams={};
    for(const f of frames){
      const a=model.joints[f.i],b=model.joints[f.j];if(!a||!b)continue;
      const dz=Math.abs(b.z-a.z),dh=Math.hypot(b.x-a.x,b.y-a.y),s=model.sections[f.sect];if(!s)continue;
      if(dz>dh&&dz>.5)cols[f.id]={f,lower:(a.z<b.z?f.i:f.j),sec:f.sect};
      else if(dh>=dz&&dh>.3)beams[f.id]={f,dir:(Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'X':'Y'),sec:f.sect};
    }
    return {cols,beams};
  };
  const classification=virtualFrames.length?classifyFrames(virtualFrames):scwbClassify();
  const columnFrames=new Set(Object.keys(classification.cols));
  const direct=new Map((model?.frames||[]).map(f=>[v304NormId(f.id),String(f.id)]));
  const comboNames=new Set(v304ComboDefinitions().keys());
  const caseTypes=new Map((tables?.['LOAD CASE DEFINITIONS']||[]).map(r=>[
    String(r.Case??r.CaseName??r.Name??''),String(r.Type??r.CaseType??'')
  ]));
  const groups=new Map(),foundCases=new Set(),skippedCases=new Set(),warnings=[];
  for(const r0 of data.rows){
    const frame=virtualFrames.length?v304NormId(r0.FrameElem):direct.get(v304NormId(r0.Frame));
    if(!frame||!columnFrames.has(frame))continue;
    const outputCase=String(r0.OutputCase||'').trim();if(!outputCase)continue;
    if(comboNames.has(outputCase)||/comb/i.test(r0.CaseType)){skippedCases.add(outputCase);continue}
    const analysisType=v304NormType(caseTypes.get(outputCase)||r0.CaseType);
    if(analysisType&&!analysisType.includes('linstatic')){skippedCases.add(outputCase);continue}
    const step=String(r0.StepType||'').trim();
    if(step&&/max|min|envelope|mode|time/i.test(step)){skippedCases.add(outputCase);continue}
    foundCases.add(outputCase);
    const key=frame+'\u001f'+outputCase;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r0);
  }
  const rows=[];
  for(const [key,group] of groups){
    const [frame,outputCase]=key.split('\u001f');
    const stationOf=r=>virtualFrames.length?(r.ElemStation??r.Station):r.Station;
    const stations=[...group].sort((a,b)=>stationOf(a)-stationOf(b));
    if(stations.length<2){warnings.push('Frame '+frame+'／'+outputCase+' 少於兩個端部測站，已略過。');continue}
    const f=classification.cols[frame]?.f;if(!f)continue;
    const a=model.joints[f.i],b=model.joints[f.j];if(!a||!b)continue;
    for(const [joint,r] of [[String(f.i),stations[0]],[String(f.j),stations[stations.length-1]]]){
      /* SAP frame P：拉力為正、壓力為負；分析元素模式直接轉成受壓為正的 Puc。 */
      if(virtualFrames.length)rows.push({Frame:frame,Joint:joint,OutputCase:outputCase,F3:-r.P});
      else{
        const lower=String(a.z<=b.z?f.i:f.j);
        rows.push({Frame:frame,Joint:joint,OutputCase:outputCase,F3:joint===lower?-r.P:r.P});
      }
    }
  }
  const objectToElements={};
  for(const f of virtualFrames)(objectToElements[f.objectId]||(objectToElements[f.objectId]=[])).push(f.id);
  return {rows,foundCases,columnFrames,skippedCases,warnings,classification,
    elementMode:virtualFrames.length>0,objectToElements};
}
function v304BuildCombinationRows(endData,scope=V304.scope){
  if(V304.imported?.mode==='legacy')return {
    rows:endData.rows,selectedCombos:[],supportedCombos:[],unsupportedCombos:[],missingCases:[],
    foundCases:[...endData.foundCases],legacy:true
  };
  const defs=v304ComboDefinitions(),selected=v304SelectCombos(defs,scope);
  const supported=[],unsupported=[];
  for(const d of selected){
    const flat=v304FlattenLinear(d.name,defs);
    if(flat.ok&&Object.keys(flat.factors).length)supported.push({...d,factors:flat.factors});
    else unsupported.push({name:d.name,reason:flat.reason||'無有效係數'});
  }
  const required=new Set(supported.flatMap(c=>Object.keys(c.factors)));
  const missingCases=[...required].filter(x=>!endData.foundCases.has(x)).sort();
  const base=new Map();
  for(const r of endData.rows){
    const key=r.Frame+'\u001f'+r.Joint;
    if(!base.has(key))base.set(key,new Map());
    base.get(key).set(r.OutputCase,r.F3);
  }
  const rows=[],completeComboNames=new Set(),incomplete=new Set();
  for(const [key,cases] of base){
    const [Frame,Joint]=key.split('\u001f');
    for(const combo of supported){
      let value=0,ok=true;
      for(const [caseName,factor] of Object.entries(combo.factors)){
        if(!cases.has(caseName)){ok=false;break}
        value+=factor*cases.get(caseName);
      }
      if(ok){rows.push({Frame,Joint,OutputCase:combo.name,F3:value});completeComboNames.add(combo.name)}
      else incomplete.add(combo.name);
    }
  }
  return {
    rows,selectedCombos:selected,supportedCombos:supported,
    unsupportedCombos:[...unsupported,...[...incomplete].map(name=>({name,reason:'部分柱端缺少 Load Case 結果'}))],
    missingCases,foundCases:[...endData.foundCases].sort(),requiredCases:[...required].sort(),
    completeComboNames:[...completeComboNames].sort(),legacy:false
  };
}
function v304ApplySCWB(){
  if(!V304.imported)return;
  const endData=v304EndCaseRows(V304.imported),combined=v304BuildCombinationRows(endData,V304.scope);
  V304.imported.skippedCases=endData.skippedCases;
  if(!combined.rows.length)throw new Error(combined.missingCases?.length?
    '缺少 Load Case：'+combined.missingCases.join('、'):'沒有可供強柱弱梁檢核的線性組合結果。');
  const classifyBase=scwbClassify;
  if(endData.elementMode)scwbClassify=()=>endData.classification;
  try{scwbData=scwbCompute(combined.rows)}
  finally{scwbClassify=classifyBase}
  scwbData.v304={
    fileName:V304.imported.fileName||'',mode:V304.imported.mode,scope:V304.scope,
    sourceTable:V304.imported.table||'',units:V304.imported.units||'',
    foundCases:combined.foundCases||[],requiredCases:combined.requiredCases||[],
    missingCases:combined.missingCases||[],supportedCombos:combined.supportedCombos?.map(x=>x.name)||[],
    unsupportedCombos:combined.unsupportedCombos||[],warnings:endData.warnings||[],
    elementMode:endData.elementMode,objectToElements:endData.objectToElements||{}
  };
  V304.result=scwbData.v304;
  let ng=0;
  for(const J in scwbData.res){const r=scwbRatioJoint(J);if(r!=null&&r<1.25)ng++}
  $('scwb-row').style.display='flex';$('scwb-dir-row').style.display='flex';$('scwb-lbl-row').style.display='flex';
  $('tg-scwb').checked=true;scwbBuildLegend();scwbSetActive(true);v304RenderStatus(ng);
}
function v304RenderStatus(ng=0){
  const s=$('scwb-status'),m=scwbData?.v304;if(!s||!m)return;
  const imported=V304.imported||{},legacy=m.mode==='legacy',warn=[];
  if(m.missingCases.length)warn.push('缺 Load Case：'+m.missingCases.join('、'));
  if(m.unsupportedCombos.length)warn.push('未重組 '+m.unsupportedCombos.length+' 組（非 Linear Add 或資料不完整）');
  if(imported.skippedCases?.size)warn.push('略過多值／組合案例 '+imported.skippedCases.size+' 個');
  s.innerHTML='<div class="v304-status '+(warn.length?'warn':'ok')+'">'+
    '<b>✓ '+v300Esc(imported.fileName||'結果檔')+'</b>'+
    '<div class="v304-kpis"><span><strong>'+v300Esc(String(imported.rows?.length||0))+'</strong> 原始列</span>'+
    '<span><strong>'+m.foundCases.length+'</strong> Load Case</span><span><strong>'+scwbData.nCombo+'</strong> '+(legacy?'原始組合':'程式重組')+'</span>'+
    '<span><strong>'+Object.keys(scwbData.res||{}).length+'</strong> 檢核節點</span></div>'+
    '<div>'+(legacy?'相容模式：直接採用舊版 Element Joint Forces。':'來源：Element Forces - Frames 的 P；只重建 Linear Add，壓力轉為 Puc 正值。')+'</div>'+
    (warn.length?'<div class="v304-warn">'+v300Esc(warn.join('；'))+'</div>':'')+
    '<div>NG '+ng+'　單位：'+v300Esc(m.units||'—')+'</div></div>';
}
async function v304Import(file){
  $('scwb-status').textContent='讀取 Load Case 結果並重組 Load Comb…';
  const parsed=await v304ReadFile(file);parsed.fileName=file.name;
  if(parsed.mode==='element'){
    const mainCombos=new Set(v304ComboDefinitions().keys());
    parsed.rows=parsed.rows.filter(r=>!mainCombos.has(r.OutputCase));
    if(!parsed.rows.length)throw new Error('沒有讀到 Load Case 的 Element Forces；請勿只匯出 Load Comb。');
  }
  V304.imported=parsed;
  V304.forceIndex=v304BuildForceIndex(parsed);
  v304ApplySCWB();
}
function v304GuideMarkup(){
  return '<div class="v304-guide-head"><b>SAP2000 v27：匯出 Load Case 桿件內力</b><button id="v304-guide-close">×</button></div>'+
    '<div class="v304-guide-body"><div class="v304-callout"><b>目的：</b>只匯出原始 Load Case，HTML 依主模型的 COMBINATION DEFINITIONS 重建 LRFD 組合，避免輸出數百個 Load Comb。</div>'+
    '<ol><li>完成分析；若只做強柱弱梁，可先選取所有柱並勾選 <b>Selection Only</b>。</li>'+
    '<li>File → Export → SAP2000 .s2k Text File。</li><li>Analysis Results → Element Output → Frame Output，勾選 <b>Element Forces - Frames</b>。</li>'+
    '<li>Select Load Cases 只選 DL、LL、LR、EXP、EXN、EYP、EYN、EV、WXP、WXN、WYP、WYN 等原始分析案例；<b>不要選 LRFD／WSD／AMP 組合</b>。</li>'+
    '<li>另勾選 <b>Objects and Elements - Frames</b>，讓自動網格元素可回查原 Frame。</li>'+
    '<li>保留 Frame、Station、OutputCase、CaseType、StepType、P、V2、V3、T、M2、M3 欄位後匯出，再於此處載入。</li></ol>'+
    '<div class="v304-callout warn">目前強柱弱梁只自動採用可精確重建的 <b>Linear Add</b>。Envelope、ABS、SRSS、Range、非線性或多步案例會列為未重組，不會以近似值代替。</div>'+
    '<div class="v304-callout">基礎 Joint Reaction 維持既有流程：匯入 Load Case 後由基礎模組組合。</div></div>';
}
function v304MountImporter(){
  const content=$('content-scwb');if(!content||content.dataset.v304==='1')return;
  content.dataset.v304='1';
  const intro=content.firstElementChild;
  if(intro)intro.innerHTML='載入 SAP「Element Forces - Frames」的 <b>Load Case</b> 結果；程式依主 S2K 的 Load Comb 係數重組柱軸力。';
  const oldLoad=$('scwb-load'),oldFile=$('scwb-file'),oldGuide=$('btn-scwb-guide');
  if(oldLoad){const b=oldLoad.cloneNode(true);b.textContent='📂 載入 Load Case Element Forces';oldLoad.replaceWith(b)}
  if(oldFile){const f=oldFile.cloneNode(true);f.accept='.s2k,.$2k,.txt,.xlsx,.xls,.csv';oldFile.replaceWith(f)}
  if(oldGuide){const b=oldGuide.cloneNode(true);b.textContent='📖 如何匯出 Load Case Element Forces？';oldGuide.replaceWith(b)}
  const file=$('scwb-file'),load=$('scwb-load'),guide=$('btn-scwb-guide'),controls=document.createElement('div');
  controls.className='v304-controls';
  controls.innerHTML='<label>組合用途<select id="v304-combo-scope"><option value="lrfd">LRFD 強度（排除 AMP）</option><option value="amp">AMP 放大地震力</option><option value="all">全部 Linear Add</option></select></label>'+
    '<span title="非 Linear Add、多步及非線性結果不會近似重組">僅精確重組</span>';
  file.insertAdjacentElement('afterend',controls);
  load.onclick=()=>file.click();
  file.onchange=async ev=>{
    const picked=ev.target.files?.[0];if(!picked)return;
    try{await v304Import(picked)}catch(err){$('scwb-status').textContent='✗ '+String(err?.message||err);console.error(err)}
    finally{ev.target.value=''}
  };
  controls.querySelector('select').onchange=ev=>{
    V304.scope=ev.target.value;
    if(V304.imported)try{v304ApplySCWB()}catch(err){$('scwb-status').textContent='✗ '+String(err?.message||err)}
  };
  guide.onclick=()=>{
    const modal=$('scwb-guide-modal');modal.innerHTML='<div class="v304-guide-card">'+v304GuideMarkup()+'</div>';modal.style.display='flex';
    modal.querySelector('#v304-guide-close').onclick=()=>modal.style.display='none';
    modal.onclick=ev=>{if(ev.target===modal)modal.style.display='none'};
  };
}
function v304Reset(){
  V304.imported=null;V304.result=null;V304.forceIndex=null;scwbData=null;
  const status=$('scwb-status');if(status)status.textContent='尚未載入 Load Case Element Forces';
  for(const id of ['scwb-row','scwb-dir-row','scwb-lbl-row'])if($(id))$(id).style.display='none';
  if($('scwb-legend'))$('scwb-legend').innerHTML='';
}

const v304FrameRatioBase=scwbFrameRatio;
scwbFrameRatio=function(f){
  const map=scwbData?.v304?.objectToElements;
  if(scwbData?.v304?.elementMode&&map?.[String(f.id)]){
    const ratios=[];
    for(const elementId of map[String(f.id)]){
      const ef=scwbData.cols?.[elementId]?.f;if(!ef)continue;
      for(const joint of [ef.i,ef.j]){
        const value=scwbRatioJoint(joint);if(value!=null)ratios.push(value);
      }
    }
    return ratios.length?Math.min(...ratios):null;
  }
  return v304FrameRatioBase(f);
};

if(typeof document!=='undefined'){
  v304MountImporter();
  const v304StartBase=startApp;
  startApp=function(...args){
    const out=v304StartBase.apply(this,args);
    v304Reset();v304MountImporter();
    return out;
  };
}
globalThis.__V304_TEST={
  comboDefinitions:v304ComboDefinitions,flattenLinear:v304FlattenLinear,
  selectCombos:v304SelectCombos,rowsFromAOA:v304RowsFromAOA,
  endCaseRows:v304EndCaseRows,buildCombinationRows:v304BuildCombinationRows,
  buildForceIndex:v304BuildForceIndex,combinedFrameForce:v304CombinedFrameForce,
  readForceRows:v304ReadForceRows,setForceIndex:value=>{V304.forceIndex=value}
};
globalThis.v304GetCombinedFrameForce=v304CombinedFrameForce;


/* ════════ V3.0.7 TWO-FILE MODEL / RESULTS WORKFLOW ════════ */
const V305={
  analysisText:'',analysisFileName:'',analysisTables:null,summary:null
};

function v305FindTable(T,pattern){
  return Object.keys(T||{}).find(k=>pattern.test(k))||'';
}
function v305AnalysisSummary(T){
  const force=v305FindTable(T,/ELEMENT FORCES.*FRAMES/i);
  const disp=v305FindTable(T,/JOINT DISPLACEMENTS/i);
  const react=v305FindTable(T,/JOINT REACTIONS/i);
  const map=v305FindTable(T,/OBJECTS AND ELEMENTS.*FRAMES/i);
  const messages=v305FindTable(T,/ANALYSIS MESSAGES/i);
  const cases=new Set();
  for(const key of [force,disp,react]){
    for(const r of (key?T[key]:[])||[]){
      const name=String(r.OutputCase??r.Case??r.CaseName??'').trim();
      if(name)cases.add(name);
    }
  }
  return {
    forceTable:force,forceRows:force?(T[force]||[]).length:0,
    displacementTable:disp,displacementRows:disp?(T[disp]||[]).length:0,
    reactionTable:react,reactionRows:react?(T[react]||[]).length:0,
    mappingTable:map,mappingRows:map?(T[map]||[]).length:0,
    messageTable:messages,messageRows:messages?(T[messages]||[]).length:0,
    cases:[...cases].sort()
  };
}
function v305RenderStatus(){
  const el=$('v305-results-status');if(!el)return;
  const s=V305.summary;
  if(!s){
    el.innerHTML='<div class="v305-empty">尚未匯入第二個 Analysis Results S2K</div>';
    return;
  }
  const hasReaction=s.reactionRows>0;
  el.innerHTML='<div class="v305-result-head"><b>'+v300Esc(V305.analysisFileName)+'</b><span class="v300-pill '+(hasReaction?'ok':'warn')+'">'+
    (hasReaction?'基礎反力已共用':'缺 Joint Reactions')+'</span></div>'+
    '<div class="v305-result-grid"><span><b>'+s.cases.length+'</b> Load Case</span><span><b>'+s.forceRows+'</b> Frame Force</span>'+
    '<span><b>'+s.displacementRows+'</b> Displacement</span><span><b>'+s.reactionRows+'</b> Reaction</span></div>'+
    (!hasReaction?'<div class="v305-warning">這份結果檔沒有 Joint Reactions；強柱弱梁仍可使用，但基礎步驟仍需補匯反力。重新由 SAP 匯出時勾選 Joint Reactions 即可免除第三次匯入。</div>':'');
}
function v305ApplyReactions(T,fileName){
  const result=v300ReactionRows(T);
  if(!result.rows.length)return {rows:0,warnings:result.warnings||[]};
  if(!V300.draft)v300BeginDraft();
  V300.draft.reactionDataset={
    fileName,importedAt:v300Now(),rows:result.rows,warnings:result.warnings||[],
    units:result.units,table:result.table,source:'analysis-results'
  };
  V300.draft.analysisResults=V300.draft.analysisResults||{};
  V300.draft.analysisResults.fileName=fileName;
  V300.draft.analysisResults.importedAt=v300Now();
  if(V300.activeProject){
    V300.activeProject.reactionDataset=v300Clone(V300.draft.reactionDataset);
    V300.activeProject.analysisResults=v300Clone(V300.draft.analysisResults);
    V300.activeProject.updatedAt=v300Now();
    v300Put(V300.activeProject).catch(console.error);
  }
  return {rows:result.rows.length,warnings:result.warnings||[]};
}
async function v305ImportAnalysisFile(file){
  const status=$('v305-results-status');
  if(status)status.innerHTML='<div class="v305-empty">正在解析 Analysis Results…</div>';
  const text=await file.text(),T=parseS2K(text),summary=v305AnalysisSummary(T);
  if(!summary.forceRows&&!summary.displacementRows&&!summary.reactionRows){
    throw new Error('此檔沒有 Element Forces、Joint Displacements 或 Joint Reactions，請確認匯出的是 Analysis Results。');
  }
  V305.analysisText=text;V305.analysisFileName=file.name;V305.analysisTables=T;V305.summary=summary;
  if(V300.draft){
    V300.draft.analysisResults={
      fileName:file.name,importedAt:v300Now(),tableCount:Object.keys(T).length,
      forceRows:summary.forceRows,displacementRows:summary.displacementRows,
      reactionRows:summary.reactionRows,cases:summary.cases
    };
  }
  if(summary.forceRows){
    const parsed=v304ReadForceRows(T);
    parsed.fileName=file.name;
    const mainCombos=new Set(v304ComboDefinitions().keys());
    parsed.rows=parsed.rows.filter(r=>!mainCombos.has(r.OutputCase));
    V304.imported=parsed;V304.forceIndex=v304BuildForceIndex(parsed);
    try{v304ApplySCWB()}
    catch(err){
      const scwb=$('scwb-status');
      if(scwb)scwb.textContent='分析結果已讀取，但強柱弱梁尚無可用組合：'+String(err?.message||err);
    }
  }
  v305ApplyReactions(T,file.name);
  v305RenderStatus();
  try{renderPmSummary()}catch(e){console.error(e)}
  if(V300.step===3&&$('v300-setup-dialog')?.open)v300RenderWizard();
}
function v305Reset(){
  V305.analysisText='';V305.analysisFileName='';V305.analysisTables=null;V305.summary=null;
  v305RenderStatus();
}
function v305SharedInput(){
  return $('v305-results-file');
}
function v305GuideHtml(){
  return '<div class="v305-guide-card"><div class="v305-guide-head"><div><b>SAP2000 v27：兩個 S2K 匯出流程</b>'+
    '<small>① Model Definition　→　② Analysis Results</small></div><button id="v305-guide-close">×</button></div>'+
    '<div class="v305-guide-body">'+
      '<section><h3>第一個檔案：Model Definition</h3><p>File → Export → SAP2000 .s2k Text File。勾選模型定義資料，包含材料、斷面、Load Pattern、Load Case、Load Comb、Joint、Frame／Area connectivity、Assignments 等；Analysis Results 全部不勾。</p>'+
      '<div class="v305-flow-note">先在首頁匯入此檔，建立上構模型及載重組合定義。</div></section>'+
      '<section><h3>第二個檔案：Analysis Results</h3><p>完成分析後再次匯出 S2K，Results 的 Select Load Cases 只選原始 Load Case，不選 LRFD／WSD／AMP Load Comb。</p>'+
      '<div class="v305-check-grid">'+
        '<span class="ok">✓ Joint Displacements</span><span class="ok">✓ Joint Reactions</span>'+
        '<span class="ok">✓ Element Forces - Frames</span><span class="ok">✓ Objects and Elements - Frames</span>'+
        '<span class="optional">○ Analysis Messages（選用）</span><span class="no">✕ Element Joint Forces - Frames</span>'+
      '</div>'+
      '<div class="v305-image-wrap"><img src="data:image/png;base64,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tbNWwdcnIiIiahb333//mkDE5QYkckwlbasyBqSMtm/91KwVJP7nO/B/j/yWfgmiWPnlrzGlghR7/ohr9ftfNmu0/clTrvqBKb4/g4iIiIgqqysYqQWDkZ2EwQgRERERVa/iMC03+1GP9ZxLRERERETbW8XMCBERERER0WZg6oKIiIiIiBqCwQgRERERETUEgxEiIiIiImoIBiNERERERNQQDEaIiIiIiKghGIwQEREREVFDMBghIiIiIqKGaFtZWdmS94y0tbWZtda3ne5lu+HfWfPifzfNiX9nzYv/zTQv/p01J/4307zK/W6YGSEiIiIiooZgMEJERERERA3BYISIiIiIiBqCwQgRERERETUEgxEiIiIiImoIBiNERERERNQQ6wxG5pHYvRu7rSUxb3YVmcfQrk68dEOt3ngJne46ERERERHtWBuQGTmMc4srWFlxlmSnKQ6y70nMfzyPJ/fJhhWkEBERERHRjsJhWkRERERE1BCbF4zcOI+jZujW0fN5UyjcbIj8/BomcRXDX9mFXUO+47uIiIiIiGib2oBgRAUTB905IwkVaoh5JA4OI3LBGbr1Mi6qoKNUJ8Y/fh0DMszrxx/j4/FK47uIiIiIiGg72eA5I0kVYig38lg6fA5Pm/hi36nTKuggIiIiIiIq4JwRIiIiIiJqiM0JRvaFELk6jBfMNJAb58d8hmkREREREdFOtsFzRmSyujyntxPJCwOYPOGUncSxgGFanXhsgBPYiYiIiIh2oraVlZVVs76p2trazFrr2073st3w76x58b+b5sS/s+bF/2aaF//OmhP/m2le5X43nDNCREREREQNwWCEiIiIiIgagsEIERERERE1BIMRIiIiIiJqCAYjRERERETUEAxGiIiIiIioIRiMEBERERFRQ2zZe0aIiIiIiIhszIwQEREREVFDMBghIiIiIqKGYDBCREREREQNwWCEiIiIiIgagsEIERERERE1BIMRIiIiIiJqCAYjRERERNvJjUV0di7ihtncGB/hpc4fIDFvNl1yrd0/wG5veR0vlb3wTSS8ttnrW+fGS6+j86WPvLbb9yT7du9+G6W3GSzgc7H5/T7m37Y+s2o+N5dzPTmn+JqN+Sw3QsX3jLxwftKsEREREdFme/rUgFmrk3R+40Bq/iD2maL1k07w67j+7DeQ7DRFovRa0sl+bjcWg65t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" alt="SAP2000 Analysis Results 匯出設定"><div class="v305-image-note"><b>注意：</b>你截圖中的 Joint Reactions 尚未勾選，請補勾；Element Joint Forces - Frames 可取消。</div></div>'+
      '<div class="v305-flow-note">在主模型載入後，由側邊欄「Analysis Results」只匯入一次。程式會同時供應強柱弱梁、位移資料及基礎柱底反力。</div></section>'+
    '</div></div>';
}
function v305OpenGuide(){
  const modal=$('export-guide-modal');if(!modal)return;
  modal.innerHTML=v305GuideHtml();modal.style.display='flex';
  modal.querySelector('#v305-guide-close').onclick=()=>modal.style.display='none';
  modal.onclick=ev=>{if(ev.target===modal)modal.style.display='none'};
}
function v305Mount(){
  const sidebar=$('sidebar'),foundationCard=$('foundation-card');
  if(sidebar&&foundationCard&&!$('v305-results-card')){
    const card=document.createElement('div');
    card.className='card';card.id='v305-results-card';
    card.innerHTML='<div class="ttl">Analysis Results</div><div class="v305-two-file-label"><span>②</span><div><b>匯入分析結果 S2K</b><small>與 Model Definition 分開</small></div></div>'+
      '<button class="btn" id="v305-results-load">載入 Analysis Results</button>'+
      '<input type="file" id="v305-results-file" accept=".s2k,.$2k,.S2K,.$2K,.txt" hidden>'+
      '<div id="v305-results-status"></div>';
    sidebar.insertBefore(card,foundationCard);
    const input=card.querySelector('#v305-results-file');
    card.querySelector('#v305-results-load').onclick=()=>input.click();
    input.onchange=async ev=>{
      const file=ev.target.files?.[0];if(!file)return;
      try{await v305ImportAnalysisFile(file)}
      catch(err){card.querySelector('#v305-results-status').innerHTML='<div class="v305-warning">✗ '+v300Esc(String(err?.message||err))+'</div>'}
      finally{input.value=''}
    };
  }
  const dropText=$('drop-zone')?.querySelector('p');
  if(dropText)dropText.innerHTML='<b>① 先匯入 Model Definition S2K</b><br>建立模型後，再於側邊欄匯入第二個 Analysis Results S2K';
  const fileTitle=$('file-name')?.parentElement?.querySelector('.v305-model-label');
  if(!fileTitle&&$('file-name')){
    $('file-name').insertAdjacentHTML('beforebegin','<div class="v305-model-label">① Model Definition</div>');
  }
  const guideOld=$('btn-export-guide');
  if(guideOld&&!guideOld.dataset.v305){
    const guide=guideOld.cloneNode(true);guide.dataset.v305='1';guide.textContent='📖 SAP2000 兩個 S2K 匯出教學';
    guideOld.replaceWith(guide);guide.onclick=ev=>{ev.stopPropagation();v305OpenGuide()};
  }
  const scwbLoad=$('scwb-load'),scwbFile=$('scwb-file');
  if(scwbLoad){
    scwbLoad.textContent='📂 載入／更換共用 Analysis Results';
    scwbLoad.onclick=()=>v305SharedInput()?.click();
    const hint=($('btn-scwb-guide')||scwbLoad).previousElementSibling;
    if(hint)hint.innerHTML='由共用 Analysis Results 的 <b>Element Forces - Frames</b> 讀取 Load Case 內力；程式依 Model Definition 的 Load Comb 係數重組，不需另匯組合結果。';
  }
  if(scwbFile)scwbFile.style.display='none';
  v305RenderStatus();
}

if(typeof document!=='undefined'){
  const v305Step3Base=v300Step3;
  v300Step3=function(){
    const d=V300.draft?.reactionDataset;
    if(d?.rows?.length&&d.source==='analysis-results'){
      const c=v300Completeness();
      return '<h3>3. 確認柱底 Load Case Joint Reaction</h3>'+
        '<div class="v300-note ok"><b>已由共用 Analysis Results 自動擷取</b><br>'+v300Esc(d.fileName)+'<br>不需要再匯入柱底反力檔。</div>'+
        '<div class="v300-kpis"><div class="v300-kpi"><b>'+c.selected+'</b><span>選定柱腳</span></div>'+
        '<div class="v300-kpi"><b>'+c.reactions+'</b><span>反力筆數</span></div><div class="v300-kpi"><b>'+c.jointsWithReactions+'</b><span>已有反力 Joint</span></div>'+
        '<div class="v300-kpi"><b>'+c.missing.length+'</b><span>缺反力 Joint</span></div></div>'+
        '<div class="v300-note '+(c.missing.length?'warn':'ok')+'">'+(c.missing.length?'仍缺反力：J'+c.missing.join('、J'):'所有選定柱腳至少有一筆 Load Case 反力')+'</div>';
    }
    return v305Step3Base().replace('3. 匯入柱底 Load Case Joint Reaction','3. 補匯柱底 Load Case Joint Reaction（結果檔未包含時）')
      .replace('主 S2K 提供 Joint 座標與 Load Case／Load Comb；反力檔只補入柱底 Joint Reaction。',
        '若共用 Analysis Results 已包含 Joint Reactions，本步會自動完成；只有結果檔未勾該表時才需在此補匯。');
  };

  v305Mount();
  const v305StartBase=startApp;
  startApp=function(...args){
    const out=v305StartBase.apply(this,args);
    v305Reset();v305Mount();
    return out;
  };
}

globalThis.__V305_TEST={analysisSummary:v305AnalysisSummary};


/* ════════ V3.0.7 TAIWAN LRFD §13.6 SMF CLAUSE-BY-CLAUSE REVIEW ════════ */
const V306={result:null};

function v306Esc(v){return v300Esc(String(v??''))}
function v306Num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function v306FrameLength(f){
  const a=model?.joints?.[f.i],b=model?.joints?.[f.j];
  return a&&b?Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z):(Number(f.len)||0);
}
function v306RawSection(name){
  return (tables?.['FRAME SECTION PROPERTIES 01 - GENERAL']||[]).find(r=>String(r.SectionName)===String(name))||{};
}
function v306RawMaterial(name){
  return (tables?.['MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES']||[]).find(r=>String(r.Material)===String(name))||{};
}
function v306FrameType(f){
  const ow=model?.overwrites?.[String(f.id)]||{};
  return String(ow.FrameType??ow.FramingType??'').trim();
}
function v306DesignatedSMF(f){
  const type=v306FrameType(f);
  return /(^|[^A-Z])SMF([^A-Z]|$)|SPECIAL\s*MOMENT|韌性.*抗彎/i.test(type+' '+(f.groups||[]).join(' '));
}
function v306Scope(){
  const c=scwbClassify(),all=[...Object.values(c.cols),...Object.values(c.beams)].map(x=>x.f);
  const designated=all.filter(v306DesignatedSMF),ids=new Set(designated.map(f=>String(f.id)));
  const globalSMF=/SMF|SPECIAL\s*MOMENT|韌性.*抗彎/i.test(String(model?.steelPrefs?.FrameType||''));
  const colJoints=new Set(Object.values(c.cols).flatMap(x=>[String(x.f.i),String(x.f.j)]));
  const momentAtColumn=b=>{
    const s=model.sections[b.sec]||{};
    if(!v306IShape(s)&&!/BOX|TUBE/i.test(String(s.shape||'')))return false;
    const type=v306FrameType(b.f);
    if(type&&!/PROGRAM DETERMINED/i.test(type)&&!/SMF|SPECIAL\s*MOMENT|韌性.*抗彎/i.test(type))return false;
    const rel=model.releases?.[String(b.f.id)]?.raw||{};
    return [String(b.f.i),String(b.f.j)].some((J,idx)=>colJoints.has(J)&&String(idx?rel.M3J:rel.M3I)!=='Yes');
  };
  const fallbackBeams=Object.fromEntries(Object.entries(c.beams).filter(([,b])=>momentAtColumn(b)));
  const fallbackJoints=new Set(Object.values(fallbackBeams).flatMap(b=>[String(b.f.i),String(b.f.j)]));
  const fallbackCols=Object.fromEntries(Object.entries(c.cols).filter(([,x])=>fallbackJoints.has(String(x.f.i))||fallbackJoints.has(String(x.f.j))));
  return {
    cols:designated.length?Object.fromEntries(Object.entries(c.cols).filter(([id])=>ids.has(String(id)))):fallbackCols,
    beams:designated.length?Object.fromEntries(Object.entries(c.beams).filter(([id])=>ids.has(String(id)))):fallbackBeams,
    explicit:designated.length>0||globalSMF,
    source:designated.length?'桿件 FrameType／群組指定 SMF':globalSMF?'Steel Design Preferences：FrameType=SMF':'未明確指定 SMF，採梁柱抗彎接頭候選',
    count:designated.length||Object.keys(fallbackCols).length+Object.keys(fallbackBeams).length
  };
}
function v306IShape(s){return /I\/|WIDE FLANGE|^I$/i.test(String(s?.shape||''))}
function v306BeamSectionCheck(id,b){
  const s=model.sections[b.sec]||{},tw=twSectionClassify(b.sec),raw=v306RawSection(b.sec);
  const z=Number(s.z33)||0,d=Number(s.t3)||0,bf=Number(s.t2)||0,tf=Number(s.tf)||0;
  const flangeZ=v306IShape(s)&&d>0&&bf>0&&tf>0?bf*tf*(d-tf):null;
  const flangeRatio=flangeZ!=null&&z>0?flangeZ/z:null;
  const plastic=!!tw?.applicable&&tw.rank===0;
  const flangeOK=flangeRatio==null?null:flangeRatio>=.7-1e-9;
  return {
    id:String(id),section:b.sec,shape:s.shape||raw.Shape||'—',plastic,classification:tw?.label||'無法判定',
    flangeZ,zTotal:z,flangeRatio,flangeOK,
    twItems:(tw?.items||[]).map(x=>({name:x.name,lambda:x.lambda,pd:x.limits?.pd,p:x.limits?.p,r:x.limits?.r,label:x.label})),
    basis:tw?.basis||'—',assumption:tw?.assumption||'',
    manual:'塑鉸區斷面變化、梁腹開孔及接頭試驗資料不在 S2K，須人工確認'
  };
}
function v306UnbracedRatio(f){
  const ow=model?.overwrites?.[String(f.id)]||{};
  for(const key of ['XLLTB','UnbracedRatioLTB','LTBRatio']){
    const n=v306Num(ow[key]);if(n!=null&&n>0)return {factor:n,source:key};
  }
  return {factor:1,source:'未覆寫：保守取整支梁長'};
}
function v306BeamBraceCheck(id,b){
  const f=b.f,s=model.sections[b.sec]||{},raw=v306RawSection(b.sec),mat=v306RawMaterial(s.mat);
  const ry=v306Num(raw.R22),E=v306Num(mat.E1??mat.E),fy=v306Num((model.materials[s.mat]||{}).fy);
  const length=v306FrameLength(f),ub=v306UnbracedRatio(f),lb=length*ub.factor;
  const ratio=ry&&ry>0?lb/ry:null,limit=E&&fy&&fy>0?.086*E/fy:null;
  return {id:String(id),section:b.sec,length,lb,ry,E,fy,ratio,limit,ok:ratio!=null&&limit!=null?ratio<=limit+1e-9:null,source:ub.source};
}
function v306JointSupportChecks(scope){
  const jCols={},jBeams={};
  for(const [id,c] of Object.entries(scope.cols)){const f=c.f;(jCols[f.i]||(jCols[f.i]=[])).push(id);(jCols[f.j]||(jCols[f.j]=[])).push(id)}
  for(const [id,b] of Object.entries(scope.beams)){const f=b.f;(jBeams[f.i]||(jBeams[f.i]=[])).push(id);(jBeams[f.j]||(jBeams[f.j]=[])).push(id)}
  const rows=[];
  for(const J of Object.keys(jCols)){
    const beamIds=jBeams[J]||[];if(!beamIds.length)continue;
    const dirs=new Set(beamIds.map(id=>scope.beams[id].dir));
    const slab=(model.areas||[]).some(a=>(a.joints||[]).map(String).includes(String(J)));
    const candidate=dirs.size>1||slab;
    rows.push({joint:String(J),beams:beamIds.join('、'),directions:[...dirs].join('/'),slab,candidate,
      note:candidate?'模型中有正交梁或樓板支撐候選；仍須確認上下翼板支撐位置、強度與接合':'模型未辨識正交梁或樓板支撐候選，需補充或人工確認'});
  }
  return rows;
}
function v306ConnectionChecks(scope){
  const jCols={},jBeams={};
  for(const [id,c] of Object.entries(scope.cols)){const f=c.f;(jCols[f.i]||(jCols[f.i]=[])).push({id:String(id),section:c.sec});(jCols[f.j]||(jCols[f.j]=[])).push({id:String(id),section:c.sec})}
  for(const [id,b] of Object.entries(scope.beams)){const f=b.f;(jBeams[f.i]||(jBeams[f.i]=[])).push({id:String(id),section:b.sec,dir:b.dir});(jBeams[f.j]||(jBeams[f.j]=[])).push({id:String(id),section:b.sec,dir:b.dir})}
  return Object.keys(jCols).filter(J=>(jBeams[J]||[]).length).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(J=>({
    joint:String(J),columns:jCols[J].map(x=>x.id).join('、'),columnSections:[...new Set(jCols[J].map(x=>x.section))].join('、'),
    beams:jBeams[J].map(x=>x.id).join('、'),beamSections:[...new Set(jBeams[J].map(x=>x.section))].join('、'),
    directions:[...new Set(jBeams[J].map(x=>x.dir))].join('/'),qualification:'待文件',rotation:'待文件',
    note:'確認預認可／試驗接頭型式、塑性轉角能力、適用斷面與材料範圍'
  }));
}
function v306ContinuityChecks(scope){
  const joints=v306ConnectionChecks(scope),colById=scope.cols;
  return joints.map(x=>{
    const colIds=x.columns.split('、').filter(Boolean),hCols=colIds.filter(id=>v306IShape(model.sections[colById[id]?.sec]||{}));
    return {...x,hColumns:hCols.join('、'),applicable:hCols.length>0?'H 形柱接頭':'非 H 形柱／待判定',plateThickness:'待細部圖',weld:'待細部圖',
      note:hCols.length?'確認連續板對正梁上下翼板，厚度、強度與銲道符合規定':'S2K 無連續板／續接板幾何與銲道資料'};
  });
}
function v306TrussReview(){
  const frames=(model?.frames||[]).filter(f=>/TRUSS|桁架/i.test((f.groups||[]).join(' ')+' '+v306FrameType(f)));
  return {count:frames.length,ids:frames.map(f=>String(f.id)),rows:frames.map(f=>({
    id:String(f.id),section:f.sect||'—',groups:(f.groups||[]).join('、')||'—',frameType:v306FrameType(f)||'—',
    note:'確認特殊桁架適用條件、桁架與柱強度比、重力效應與柱軸力限制'
  }))};
}
function v306ScopeJoints(scope){
  const colJ=new Set(Object.values(scope.cols).flatMap(c=>[String(c.f.i),String(c.f.j)]));
  const beamJ=new Set(Object.values(scope.beams).flatMap(b=>[String(b.f.i),String(b.f.j)]));
  return new Set([...colJ].filter(J=>beamJ.has(J)));
}
function v306FilterPz(full,scope){
  if(!full)return null;
  const joints=v306ScopeJoints(scope),res={};let tot=0,ng=0;
  for(const [J,dirs] of Object.entries(full.res||{})){
    if(!joints.has(String(J)))continue;
    res[J]=dirs;
    for(const r of Object.values(dirs)){tot++;if(r.ng)ng++}
  }
  return {res,tot,ng};
}
function v306Status(kind,label,detail,counts={}){
  return {kind,label,detail,...counts};
}
function v306Compute(){
  if(!model)throw new Error('請先匯入 Model Definition。');
  const scope=v306Scope(),beamChecks=Object.entries(scope.beams).map(([id,b])=>v306BeamSectionCheck(id,b));
  const braceChecks=Object.entries(scope.beams).map(([id,b])=>v306BeamBraceCheck(id,b));
  const connectionChecks=v306ConnectionChecks(scope),continuityChecks=v306ContinuityChecks(scope);
  const supportChecks=v306JointSupportChecks(scope),truss=v306TrussReview();
  let pz=null;
  try{const fullPz=pjzCompute();pjzData=fullPz;pz=v306FilterPz(fullPz,scope)}catch(_){}
  const secNg=beamChecks.filter(x=>x.plastic===false||x.flangeOK===false).length;
  const secReview=beamChecks.filter(x=>x.flangeOK==null).length;
  const braceNg=braceChecks.filter(x=>x.ok===false).length,braceUnknown=braceChecks.filter(x=>x.ok==null).length;
  const supportMissing=supportChecks.filter(x=>!x.candidate).length;
  let scwb=null;
  if(scwbData){
    const rows=Object.values(scwbData.res||{}),applicable=rows.filter(r=>[r.rX,r.rY].some(v=>v!=null));
    scwb={total:applicable.length,ng:applicable.filter(r=>r.verdict?.startsWith('NG')).length,
      exempt:applicable.filter(r=>r.exempt).length};
  }
  const sections=[
    v306Status('review','13.6.1 梁柱接頭',
      `逐接頭列出 ${connectionChecks.length} 個模型範圍；接頭資格、試驗報告與塑性轉角能力待文件確認，不得以線彈性 Joint Displacements 取代。`,{total:connectionChecks.length}),
    pz&&pz.tot?v306Status(pz.ng?'ng':'review','13.6.2 梁柱腹板交會區',
      `已完成塑性彎矩下限與交會區板厚初步檢核：${pz.tot} 項，NG ${pz.ng}。重力＋放大地震分析需求及補強板接合仍須確認。`,{total:pz.tot,ng:pz.ng}):
      v306Status('wait','13.6.2 梁柱腹板交會區','模型未辨識可檢核的梁柱交會區。'),
    v306Status(secNg?'ng':'review','13.6.3 梁斷面限制',
      `梁 ${beamChecks.length} 支；λ≤λpd 與翼板塑性模數占比自動 NG ${secNg}，無法判斷 ${secReview}。塑鉸區斷面變化及腹板開孔仍須人工確認。`,
      {total:beamChecks.length,ng:secNg}),
    v306Status('review','13.6.4 H型柱連續板',
      `逐接頭列出 ${continuityChecks.length} 個候選；S2K 不含連續板幾何、厚度與銲接細節，須依結構細部圖確認。`,{total:continuityChecks.length}),
    scwb?v306Status(scwb.ng?'ng':'ok','13.6.5 梁柱彎矩強度比',
      `已由 Load Case Element Forces 重組組合：節點 ${scwb.total}，NG ${scwb.ng}，λpd 頂層豁免 ${scwb.exempt}。`,scwb):
      v306Status('wait','13.6.5 梁柱彎矩強度比','尚未匯入 Analysis Results；需 Element Forces - Frames 與 Objects and Elements - Frames。'),
    v306Status(supportMissing?'review':'review','13.6.6 梁柱接頭側向束制',
      `接頭 ${supportChecks.length} 個；模型未辨識正交梁／樓板支撐候選 ${supportMissing} 個。支撐作用位置、2%強度及非束制接頭 L/r<60 仍須人工確認。`,
      {total:supportChecks.length,missing:supportMissing}),
    v306Status(braceNg?'ng':'review','13.6.7 梁側向支撐',
      `已檢核 Lb/ry ≤ 0.086E/Fy：梁 ${braceChecks.length} 支，NG ${braceNg}，資料不足 ${braceUnknown}；側撐2%強度與塑鉸位置仍須確認。`,
      {total:braceChecks.length,ng:braceNg}),
    v306Status('review','13.6.8 SMF桁架',
      truss.count?`由 FrameType／群組名稱辨識 ${truss.count} 支桁架構材；桁架與柱強度比、重力效應及柱軸力限制需專案判讀。`:
        'S2K 未辨識名稱含 TRUSS／桁架的構材；請確認本案是否無 SMF 桁架。',{total:truss.count})
  ];
  return {scope,connectionChecks,beamChecks,continuityChecks,braceChecks,supportChecks,truss,sections,runAt:new Date().toISOString()};
}
function v306Badge(s){
  const map={ok:['ok','通過'],ng:['ng','NG'],review:['review','待確認'],wait:['wait','待資料']},v=map[s.kind]||map.review;
  return `<span class="v306-badge ${v[0]}">${v[1]}</span>`;
}
function v306Fmt(v,d=3){return v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d)}
function v306Table(headers,rows){
  const cell=v=>{
    if(v&&typeof v==='object'&&!Array.isArray(v))return `<td${v.title?` title="${v306Esc(v.title)}"`:''}>${v.html??v306Esc(v.text??'')}</td>`;
    return `<td>${v306Esc(v)}</td>`;
  };
  return `<div class="v306-table-wrap"><table class="v306-table"><thead><tr>${headers.map(x=>`<th>${v306Esc(x)}</th>`).join('')}</tr></thead><tbody>`+
    (rows.length?rows.map(row=>`<tr>${row.map(cell).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="v306-empty-cell">沒有辨識到適用項目</td></tr>`)+
    '</tbody></table></div>';
}
function v306ClauseView(n,r){
  if(n===1)return {title:'13.6.1 梁柱接頭資格與塑性轉角',note:'逐接頭列出 SMF 範圍。接頭試驗／預認可文件及塑性轉角能力必須人工確認；線彈性位移不是塑性鉸轉角。',
    headers:['Joint','柱 Frame','柱斷面','梁 Frame','梁斷面','方向','接頭資格','塑性轉角','應確認文件'],
    rows:r.connectionChecks.map(x=>[x.joint,x.columns,x.columnSections,x.beams,x.beamSections,x.directions,x.qualification,x.rotation,x.note])};
  if(n===3)return {title:'13.6.3 梁斷面限制',note:'逐梁檢核 λ≤λpd，I／H 梁另檢核 Zflange=bf×tf×(d−tf)，Zflange/Ztotal≥0.70。將滑鼠停在寬厚比欄可看完整限制值。',
    headers:['Frame','斷面','形狀','翼板 λ / λpd','腹板 λ / λpd','斷面分類','Zflange/Ztotal','≥0.70','自動判定','人工確認'],
    rows:r.beamChecks.map(x=>{
      const t=x.twItems||[],a=t[0],b=t[1],tip=i=>i?`${i.name}：λ=${v306Fmt(i.lambda)}；λpd=${v306Fmt(i.pd)}、λp=${v306Fmt(i.p)}、λr=${v306Fmt(i.r)} → ${i.label}`:'資料不足';
      const verdict=x.plastic&&x.flangeOK!==false?'OK':x.flangeOK==null&&!x.plastic?'資料不足／NG':'NG';
      return [x.id,x.section,x.shape,{text:a?`${v306Fmt(a.lambda)} / ${v306Fmt(a.pd)}`:'—',title:tip(a)},{text:b?`${v306Fmt(b.lambda)} / ${v306Fmt(b.pd)}`:'—',title:tip(b)},
        {html:`<span class="v306-class ${x.plastic?'ok':'ng'}">${v306Esc(x.classification)}</span>`,title:[x.basis,x.assumption].filter(Boolean).join('；')},
        x.flangeRatio==null?'—':v306Fmt(x.flangeRatio,4),x.flangeOK==null?'—':x.flangeOK?'OK':'NG',verdict,x.manual];
    })};
  if(n===4)return {title:'13.6.4 H 型柱連續板／續接板',note:'逐接頭列出 H 型柱候選。S2K 無連續板厚度、幾何與銲道資料，因此明列待細部圖確認，不能自動判定合格。',
    headers:['Joint','H型柱 Frame','柱斷面','梁 Frame','梁斷面','適用性','連續板厚度','銲道','確認內容'],
    rows:r.continuityChecks.map(x=>[x.joint,x.hColumns||'—',x.columnSections,x.beams,x.beamSections,x.applicable,x.plateThickness,x.weld,x.note])};
  if(n===6)return {title:'13.6.6 梁柱接頭側向束制',note:'模型只判斷正交梁／樓板是否可能提供束制；翼板束制位置、2% 強度、連接細部及未束制接頭柱段 L/r<60 仍須工程確認。',
    headers:['Joint','梁 Frame','方向','樓板相接','正交梁／樓板候選','模型判定','仍需確認'],
    rows:r.supportChecks.map(x=>[x.joint,x.beams,x.directions,x.slab?'是':'否',x.candidate?'有':'未辨識',x.candidate?'候選存在':'需補充',x.note])};
  if(n===7)return {title:'13.6.7 梁側向支撐',note:'逐梁檢核 Lb/ry ≤ 0.086E/Fy。未提供 LTB 覆寫時保守採整支 Frame 長度；側撐強度、勁度及塑鉸位置另列人工確認。',
    headers:['Frame','斷面','L (m)','Lb (m)','ry (m)','Lb/ry','0.086E/Fy','判定','Lb來源','人工確認'],
    rows:r.braceChecks.map(x=>[x.id,x.section,v306Fmt(x.length,4),v306Fmt(x.lb,4),v306Fmt(x.ry,6),v306Fmt(x.ratio),v306Fmt(x.limit),x.ok==null?'資料不足':x.ok?'OK':'NG',x.source,'側撐2%強度、勁度及塑鉸位置'])};
  return {title:'13.6.8 特殊桁架／其他構架識別',note:'依 FrameType 或群組名稱中的 TRUSS／桁架辨識。未辨識不代表本案必然沒有特殊桁架，仍須由構架配置確認。',
    headers:['Frame','斷面','群組','FrameType','辨識結果','專案確認內容'],
    rows:r.truss.rows.map(x=>[x.id,x.section,x.groups,x.frameType,'已辨識桁架候選',x.note])};
}
function v306Render(){
  const el=$('v306-results');if(!el)return;
  const r=V306.result;
  if(!r){el.innerHTML='<div class="v305-empty">尚未執行 13.6 總檢核</div>';return}
  const ng=r.sections.filter(x=>x.kind==='ng').length,review=r.sections.filter(x=>x.kind==='review').length,wait=r.sections.filter(x=>x.kind==='wait').length;
  el.innerHTML=`<div class="v306-scope"><b>檢核範圍：</b>${v306Esc(r.scope.source)}（${r.scope.count} 支）</div>`+
    `<div class="v306-summary"><div class="v306-kpi"><b>${ng}</b><span>NG章節</span></div><div class="v306-kpi"><b>${review}</b><span>待人工確認</span></div><div class="v306-kpi"><b>${wait}</b><span>待分析資料</span></div></div>`+
    '<div class="v306-list">'+r.sections.map(s=>`<div class="v306-item"><div class="v306-item-head"><b>${v306Esc(s.label)}</b>${v306Badge(s)}</div><div class="v306-detail">${v306Esc(s.detail)}</div></div>`).join('')+'</div>';
}
function v306RenderClauses(){
  for(const n of [1,3,4,6,7,8]){
    const el=$(`v306-results-${n}`);if(!el)continue;
    if(!V306.result){el.innerHTML='<div class="v305-empty">尚未執行本節檢核</div>';continue}
    const v=v306ClauseView(n,V306.result),s=V306.result.sections[n-1];
    el.innerHTML=`<div class="v306-clause-head"><div><b>${v306Esc(v.title)}</b><div>${v306Esc(v.note)}</div></div>${v306Badge(s)}</div>${v306Table(v.headers,v.rows)}`;
  }
}
function v306Run(){
  try{V306.result=v306Compute();v306Render();v306RenderClauses()}
  catch(err){const el=$('v306-results');if(el)el.innerHTML='<div class="v305-warning">✗ '+v306Esc(err.message||err)+'</div>'}
}
function v306AoaSheet(rows,widths){
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=widths.map(w=>({wch:w}));return ws;
}
function v306ClauseSheet(n,r){
  if(n===1)return {name:'13.6.1接頭資格',widths:[10,18,24,18,24,10,12,12,65],rows:[['13.6.1 梁柱接頭資格與塑性轉角'],['Joint','柱Frame','柱斷面','梁Frame','梁斷面','方向','接頭資格','塑性轉角','應確認文件'],...r.connectionChecks.map(x=>[x.joint,x.columns,x.columnSections,x.beams,x.beamSections,x.directions,x.qualification,x.rotation,x.note])]};
  if(n===2){const rows=[];for(const [J,dirs] of Object.entries(r.pz?.res||{}))for(const [dir,x] of Object.entries(dirs))rows.push([J,dir,x.csec,x.beams.map(b=>b.fr).join('、'),x.phiVn,x.phiVup,x.ratioV,x.okV?'OK':'NG',x.tzUse,x.tzReq,x.okTz?'OK':'NG',x.edge?'邊柱候選':'']);return {name:'13.6.2交會區',widths:[10,8,22,20,14,14,12,10,12,12,10,18],rows:[['13.6.2 梁柱腹板交會區'],['Joint','方向','柱斷面','梁Frame','φVn','φVup','φVn/φVup','剪力','tz','tz需求','厚度','備註'],...rows]}}
  if(n===3)return {name:'13.6.3梁斷面',widths:[9,24,16,28,28,18,16,10,18,52],rows:[['13.6.3 梁斷面限制'],['Frame','斷面','形狀','翼板 λ／λpd','腹板 λ／λpd','分類','Zflange/Ztotal','≥70%','判定','人工確認'],...r.beamChecks.map(x=>{const a=x.twItems?.[0],b=x.twItems?.[1];return[x.id,x.section,x.shape,a?`${v306Fmt(a.lambda)} / ${v306Fmt(a.pd)}`:'—',b?`${v306Fmt(b.lambda)} / ${v306Fmt(b.pd)}`:'—',x.classification,x.flangeRatio==null?'—':+x.flangeRatio.toFixed(4),x.flangeOK==null?'—':x.flangeOK?'OK':'NG',x.plastic&&x.flangeOK!==false?'OK':'NG／資料不足',x.manual]})]};
  if(n===4)return {name:'13.6.4連續板',widths:[10,18,24,18,24,18,16,16,60],rows:[['13.6.4 H型柱連續板／續接板'],['Joint','H型柱Frame','柱斷面','梁Frame','梁斷面','適用性','連續板厚度','銲道','確認內容'],...r.continuityChecks.map(x=>[x.joint,x.hColumns||'—',x.columnSections,x.beams,x.beamSections,x.applicable,x.plateThickness,x.weld,x.note])]};
  if(n===5){const rows=Object.entries(scwbData?.res||{}).map(([J,x])=>[J,x.rX,x.cX,x.rY,x.cY,x.govCombo,x.top?'是':'否',x.pucMax,x.thr,x.compactAll?'是':'否',x.verdict,x.clause]);return {name:'13.6.5強柱弱梁',widths:[10,12,18,12,18,20,10,14,14,14,18,45],rows:[['13.6.5 強柱弱梁'],['Joint','比值X','控制組合X','比值Y','控制組合Y','控制組合','頂層','Puc控制','0.3FycAg','梁柱λpd','判定','條文／說明'],...rows]}}
  if(n===6)return {name:'13.6.6接頭束制',widths:[10,24,10,12,16,16,70],rows:[['13.6.6 梁柱接頭側向束制'],['Joint','梁Frame','方向','樓板相接','支撐候選','模型判定','仍需確認'],...r.supportChecks.map(x=>[x.joint,x.beams,x.directions,x.slab?'是':'否',x.candidate?'有':'未辨識',x.candidate?'候選存在':'需補充',x.note])]};
  if(n===7)return {name:'13.6.7梁側撐',widths:[9,24,11,11,11,12,14,12,24,40],rows:[['13.6.7 梁側向支撐'],['公式','Lb/ry ≤ 0.086E/Fy；E、Fy採模型一致單位'],[],['Frame','斷面','L(m)','Lb(m)','ry(m)','Lb/ry','0.086E/Fy','判定','Lb來源','人工確認'],...r.braceChecks.map(x=>[x.id,x.section,+x.length.toFixed(4),+x.lb.toFixed(4),x.ry==null?'—':+x.ry.toFixed(6),x.ratio==null?'—':+x.ratio.toFixed(3),x.limit==null?'—':+x.limit.toFixed(3),x.ok==null?'資料不足':x.ok?'OK':'NG',x.source,'側撐2%強度、勁度及塑鉸位置'])]};
  return {name:'13.6.8特殊桁架',widths:[10,24,30,24,18,65],rows:[['13.6.8 特殊桁架／其他構架識別'],['Frame','斷面','群組','FrameType','辨識結果','專案確認內容'],...r.truss.rows.map(x=>[x.id,x.section,x.groups,x.frameType,'桁架候選',x.note])]};
}
function v306ExportClause(n){
  if(!V306.result)v306Run();const r=V306.result;if(!r)return;r.pz=v306FilterPz(pjzData,r.scope);
  const d=v306ClauseSheet(n,r),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,v306AoaSheet(d.rows,d.widths),d.name);XLSX.writeFile(wb,`SMF_${d.name}_V3.0.7.xlsx`);
}
function v306Export(){
  if(!V306.result)v306Run();const r=V306.result;if(!r)return;r.pz=v306FilterPz(pjzData,r.scope);
  const wb=XLSX.utils.book_new(),overview=[['台灣鋼結構極限設計法規範 13.6 韌性抗彎矩構架檢核總表'],['版本','V3.0.7'],['檢核範圍',r.scope.source],[],['條文','項目','狀態','說明'],...r.sections.map(s=>[s.label.split(' ')[0],s.label.replace(/^\S+\s*/,''),s.kind==='ok'?'通過':s.kind==='ng'?'NG':s.kind==='wait'?'待資料':'待人工確認',s.detail])];
  XLSX.utils.book_append_sheet(wb,v306AoaSheet(overview,[10,24,14,100]),'13.6總表');
  for(const n of [1,2,3,4,5,6,7,8]){const d=v306ClauseSheet(n,r);XLSX.utils.book_append_sheet(wb,v306AoaSheet(d.rows,d.widths),d.name)}
  XLSX.writeFile(wb,'SMF_13.6_逐節檢核_V3.0.7.xlsx');
}
function v306GuideHtml(){
  return '<div class="v305-guide-card"><div class="v305-guide-head"><div><b>SAP2000 v27：兩個 S2K 匯出流程</b>'+
    '<small>① Model Definition　→　② Analysis Results</small></div><button id="v305-guide-close">×</button></div>'+
    '<div class="v305-guide-body"><div class="v306-guide-images">'+
      '<figure><h3>第一個檔案：Model Definition</h3><figcaption>勾選整個 MODEL DEFINITION；ANALYSIS RESULTS 全部不勾。先由首頁載入。</figcaption>'+
      '<img src="data:image/png;base64,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" alt="SAP2000 Model Definition 匯出設定"></figure>'+
      '<figure><h3>第二個檔案：Analysis Results</h3><figcaption>Select Load Cases 只選 11 個原始 Load Case，不選 Load Comb；再勾選下列四張表。</figcaption>'+
      '<img src="data:image/png;base64,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tbNWwdcnIiIiahb333//mkDE5QYkckwlbasyBqSMtm/91KwVJP7nO/B/j/yWfgmiWPnlrzGlghR7/ohr9ftfNmu0/clTrvqBKb4/g4iIiIgqqysYqQWDkZ2EwQgRERERVa/iMC03+1GP9ZxLRERERETbW8XMCBERERER0WZg6oKIiIiIiBqCwQgRERERETUEgxEiIiIiImoIBiNERERERNQQDEaIiIiIiKghGIwQEREREVFDMBghIiIiIqKGaFtZWdmS94y0tbWZtda3ne5lu+HfWfPifzfNiX9nzYv/zTQv/p01J/4307zK/W6YGSEiIiIiooZgMEJERERERA3BYISIiIiIiBqCwQgRERERETUEgxEiIiIiImoIBiNERERERNQQ6wxG5pHYvRu7rSUxb3YVmcfQrk68dEOt3ngJne46ERERERHtWBuQGTmMc4srWFlxlmSnKQ6y70nMfzyPJ/fJhhWkEBERERHRjsJhWkRERERE1BCbF4zcOI+jZujW0fN5UyjcbIj8/BomcRXDX9mFXUO+47uIiIiIiGib2oBgRAUTB905IwkVaoh5JA4OI3LBGbr1Mi6qoKNUJ8Y/fh0DMszrxx/j4/FK47uIiIiIiGg72eA5I0kVYig38lg6fA5Pm/hi36nTKuggIiIiIiIq4JwRIiIiIiJqiM0JRvaFELk6jBfMNJAb58d8hmkREREREdFOtsFzRmSyujyntxPJCwOYPOGUncSxgGFanXhsgBPYiYiIiIh2oraVlZVVs76p2trazFrr2073st3w76x58b+b5sS/s+bF/2aaF//OmhP/m2le5X43nDNCREREREQNwWCEiIiIiIgagsEIERERERE1BIMRIiIiIiJqCAYjRERERETUEAxGiIiIiIioIRiMEBERERFRQ2zZe0aIiIiIiIhszIwQEREREVFDMBghIiIiIqKGYDBCREREREQNwWCEiIiIiIgagsEIERERERE1BIMRIiIiIiJqCAYjRERERNvJjUV0di7ihtncGB/hpc4fIDFvNl1yrd0/wG5veR0vlb3wTSS8ttnrW+fGS6+j86WPvLbb9yT7du9+G6W3GSzgc7H5/T7m37Y+s2o+N5dzPTmn+JqN+Sw3QsX3jLxwftKsEREREdFme/rUgFmrk3R+40Bq/iD2maL1k07w67j+7DeQ7DRFovRa0sl+bjcWg65t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" alt="SAP2000 Analysis Results 匯出設定"></figure></div>'+
      '<div class="v305-check-grid"><span class="ok">✓ Joint Displacements</span><span class="ok">✓ Joint Reactions</span>'+
        '<span class="ok">✓ Element Forces - Frames</span><span class="ok">✓ Objects and Elements - Frames</span>'+
        '<span class="optional">○ Analysis Messages（選用）</span><span class="no">✕ Element Joint Forces - Frames</span></div>'+
      '<div class="v305-flow-note"><b>匯入順序：</b>首頁載入 Model Definition → 側邊欄載入 Analysis Results。Joint Reactions 已包含在第二檔，不需再匯入第三個柱底反力檔。</div>'+
      '<div class="v305-warning">Element Joint Forces - Frames 與 Element Forces 高度重複且本程式不使用，請勿勾選。單位固定 Tonf, m, C。</div>'+
    '</div></div>';
}
function v306Mount(){
  const selector=$('check-selector'),card=$('check-card');if(!selector||!card)return;
  if(!selector.dataset.v306){
    selector.dataset.v306='1';
    selector.innerHTML='<option value="smf136-overview">13.6 總覽</option><option value="smf136-1">13.6.1 梁柱接頭資格</option><option value="smf136-2">13.6.2 梁柱交會區</option><option value="smf136-3">13.6.3 梁斷面限制</option><option value="smf136-4">13.6.4 柱連續板／續接板</option><option value="smf136-5">13.6.5 強柱弱梁</option><option value="smf136-6">13.6.6 接頭側向束制</option><option value="smf136-7">13.6.7 梁側向支撐</option><option value="smf136-8">13.6.8 特殊桁架</option>';
    const addPanel=(id,html)=>{const p=document.createElement('div');p.className='tab-content';p.id=id;p.innerHTML=html;card.appendChild(p)};
    addPanel('content-smf136-overview','<div class="v306-intro">13.6.1～13.6.8 已拆成獨立檢核分項；總覽只彙整各節結果，請由上方選單進入各節查看逐項資料。</div><button class="btn" id="v306-run">⚙ 執行 13.6 全部分項</button><div id="v306-results"></div><button class="btn" id="v306-export" style="margin-top:6px;">⬇ 下載 SMF 13.6 逐節檢核.xlsx</button>');
    for(const n of [1,3,4,6,7,8])addPanel(`content-smf136-${n}`,`<button class="btn" id="v306-run-${n}">⚙ 執行 13.6.${n} 檢核</button><div id="v306-results-${n}"></div><button class="btn" id="v306-export-${n}" style="margin-top:6px;">⬇ 下載 13.6.${n} 分項.xlsx</button>`);
    $('v306-run').onclick=v306Run;$('v306-export').onclick=v306Export;
    for(const n of [1,3,4,6,7,8]){$(`v306-run-${n}`).onclick=v306Run;$(`v306-export-${n}`).onclick=()=>v306ExportClause(n)}
    $('content-scwb')?.querySelector(':scope > div')?.insertAdjacentHTML('beforebegin','<div class="v306-linked-title"><b>13.6.5 梁柱彎矩強度比（強柱弱梁）</b><span>本節沿用完整強柱弱梁檢核、3D 上色、節點明細與獨立 Excel。</span></div>');
    $('content-pjz')?.querySelector(':scope > div')?.insertAdjacentHTML('beforebegin','<div class="v306-linked-title"><b>13.6.2 梁柱腹板交會區（Panel Zone）</b><span>本節沿用完整交會區檢核、3D 上色、節點明細與獨立 Excel。</span></div>');
    selector.addEventListener('change',()=>{
      card.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));
      const map={'smf136-overview':'content-smf136-overview','smf136-1':'content-smf136-1','smf136-2':'content-pjz','smf136-3':'content-smf136-3','smf136-4':'content-smf136-4','smf136-5':'content-scwb','smf136-6':'content-smf136-6','smf136-7':'content-smf136-7','smf136-8':'content-smf136-8'};
      $(map[selector.value]||'content-smf136-overview')?.classList.add('active');
    });
    selector.value='smf136-overview';selector.dispatchEvent(new Event('change'));
  }
  v306Render();v306RenderClauses();
}

/* 13.6.5 豁免必須滿足 λpd（塑性斷面），不能把僅達 λp 的結實斷面算入。 */
const v306ScwbWtBase=scwbWtCheck;
scwbWtCheck=function(sec){
  const w=v306ScwbWtBase(sec);if(!w)return w;
  return {...w,compact:w.rank===0,plastic:w.rank===0};
};
const v306ScwbComputeBase=scwbCompute;
scwbCompute=function(rows){
  const out=v306ScwbComputeBase(rows);
  for(const [J,r] of Object.entries(out.res||{})){
    const cs=Object.entries(out.cols).filter(([,c])=>c.f.i===J||c.f.j===J);
    const bs=Object.values(out.beams).filter(b=>b.f.i===J||b.f.j===J);
    let plasticAll=true;
    for(const [,c] of cs){
      const w=scwbWtCheck(c.sec),s=model.sections[c.sec]||{},fy=(model.materials[s.mat]||{}).fy||0;
      const P=r.govCombo!=null?scwbAxialGet(out.axial,c.f.id,J,r.govCombo):null;
      if(!w?.plastic){plasticAll=false;continue}
      if(v306IShape(s)&&P!=null&&fy>0&&s.area>0&&s.tw>0){
        const fyc=fy/1e4,phi=.9,pr=Math.max(0,P)/(phi*fy*s.area),h=(s.t3-2*s.tf)*100,tw=s.tw*100,lambda=h/tw;
        let limit;
        if(pr<=.125)limit=138/Math.sqrt(fyc)*(1-1.54*pr);
        else limit=Math.max(68/Math.sqrt(fyc),51/Math.sqrt(fyc)*(2.33-pr));
        if(lambda>limit+1e-9)plasticAll=false;
      }
    }
    for(const b of bs)if(!scwbWtCheck(b.sec)?.plastic)plasticAll=false;
    r.compactAll=plasticAll;
    if(r.verdict!=='OK'){
      const pucOk=cs.every(([,c])=>{
        const s=model.sections[c.sec]||{},fy=(model.materials[s.mat]||{}).fy||0,P=r.govCombo!=null?scwbAxialGet(out.axial,c.f.id,J,r.govCombo):null;
        return P!=null&&P<.3*fy*s.area;
      });
      r.exempt=!!(r.top&&plasticAll&&pucOk);
      r.verdict=r.exempt?'豁免(免檢)':'NG(需檢討)';
      r.clause=r.exempt?'1(1) 頂層柱、Puc<0.3FycAg、梁柱皆滿足λpd':(!plasticAll?'未滿足λpd，不可豁免':'—(可查1(2)/2)');
    }
  }
  const scope=v306Scope(),scopeJoints=v306ScopeJoints(scope);
  for(const J of Object.keys(out.res||{}))if(!scopeJoints.has(String(J)))delete out.res[J];
  out.cols=scope.cols;out.beams=scope.beams;out.colset=new Set(Object.keys(scope.cols));out.nColTot=out.colset.size;
  out.nColAx=[...out.colset].filter(id=>out.axial?.[id]).length;
  return out;
};
const v306PjzComputeBase=pjzCompute;
pjzCompute=function(){
  const full=v306PjzComputeBase();
  return v306FilterPz(full,v306Scope())||{res:{},tot:0,ng:0};
};

if(typeof document!=='undefined'){
  v305GuideHtml=v306GuideHtml;
  v306Mount();
  const v306StartBase=startApp;
  startApp=function(...args){const out=v306StartBase.apply(this,args);V306.result=null;v306Mount();return out};
  const v306ImportBase=v305ImportAnalysisFile;
  v305ImportAnalysisFile=async function(file){const out=await v306ImportBase(file);if(model)v306Run();return out};
}
globalThis.__V306_TEST={compute:v306Compute,beamSectionCheck:v306BeamSectionCheck,beamBraceCheck:v306BeamBraceCheck};

/* V4.15.1 增強碼須與主程式共用 ES module 詞彙作用域。
   inline module 於 DOM 解析完成後執行，因此可安全讀取頁尾的 text/plain 原始碼並 direct eval。 */
const v4151EnhancementSource=document.getElementById('v4151-enhancement-source')?.textContent||'';
if(v4151EnhancementSource)eval(v4151EnhancementSource);
