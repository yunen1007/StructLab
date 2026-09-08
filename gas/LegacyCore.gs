/** Reviewed V4.15.5 pure functions, server only. See tests/parity.test.cjs. */
function legacyModel_(T) {
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

return buildModel(T);
}
function legacyClassification_(model, secName) {
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
return twSectionClassify(secName);
}
function legacyLoads_(model) {
const zLevels=[...new Set(Object.values(model.joints).map(j=>+j.z.toFixed(3)))].sort((a,b)=>a-b);
const areaM2Cache={};
const loadCalc={types:[],vals:{},frameSelfWt:true,selfWtMult:(model.loadPats.find(p=>p.selfWtMult>0)||{}).selfWtMult||1};
for(const l of model.areaLoads){if(!l.pat)continue;const tid="s2k:"+l.pat;if(!loadCalc.vals[l.area])loadCalc.vals[l.area]={};loadCalc.vals[l.area][tid]=(loadCalc.vals[l.area][tid]||0)+l.v;}
for(const name of new Set([...model.areaLoads,...model.frameLoads].map(l=>l.pat).filter(Boolean)))loadCalc.types.push({id:"s2k:"+name,name});
function frameUnitWt(f){
  const s=model.sections[f.sect]; if(!s||!s.area) return 0;
  const mat=model.materials[s.mat]; if(!mat||!mat.unitWt) return 0;
  return s.area*mat.unitWt;
}
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
function isWeightLoadDirection(dir){
  const d=String(dir||'').trim().toLowerCase().replace(/\s+/g,'');
  return d==='gravity'||d==='z'||d==='globalz';
}
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


}
recalcLoadCalc(); return loadCalc;
}
function legacyPM_(p) {
    function calculateRebarCoordinates(B, H, rebarX, rebarY, d_prime) {
        const coords = [];
        const minX = -(B / 2 - d_prime);
        const maxX = B / 2 - d_prime;
        const minY = -(H / 2 - d_prime);
        const maxY = H / 2 - d_prime;

        const dx = rebarX > 1 ? (maxX - minX) / (rebarX - 1) : 0;
        const dy = rebarY > 1 ? (maxY - minY) / (rebarY - 1) : 0;

        for (let i = 0; i < rebarX; i++) {
            const x = minX + i * dx;
            coords.push({ x: x, y: maxY });
            coords.push({ x: x, y: minY });
        }

        for (let j = 1; j < rebarY - 1; j++) {
            const y = minY + j * dy;
            coords.push({ x: minX, y: y });
            coords.push({ x: maxX, y: y });
        }

        return coords;
    }

    function calculatePMCurve(width, depth, fc, fy, Es, Ab, rebarCoords, axisKey, d_prime) {
        const points = [];
        let beta1 = 0.85;
        if (fc > 280) {
            beta1 = Math.max(0.65, 0.85 - 0.05 * (fc - 280) / 70);
        }

        const Ag = width * depth;
        const Ast = rebarCoords.length * Ab;

        const Pnt = -fy * Ast / 1000;
        const Put = 0.90 * Pnt;
        points.push({ c: 0, pn: Pnt, mn: 0, pu: Put, mu: 0, phi: 0.90, desc: "純拉" });

        const cValues = [];
        for (let c = 0.5; c < d_prime; c += 0.1) cValues.push(c);
        for (let c = d_prime; c < depth; c += 0.5) cValues.push(c);
        for (let c = depth; c <= depth * 1.5; c += 2.0) cValues.push(c);
        cValues.push(depth * 3.0);
        cValues.push(depth * 10.0);

        cValues.forEach(c => {
            const a = Math.min(depth, beta1 * c);
            const Cc = 0.85 * fc * a * width / 1000;
            const Mc = Cc * (depth / 2 - a / 2) / 100;

            let sumFs = 0;
            let sumMs = 0;
            const dt = depth - d_prime;
            const et = 0.003 * (dt - c) / c;

            rebarCoords.forEach(coord => {
                const pos = coord[axisKey];
                const di = depth / 2 - pos;
                const esi = 0.003 * (c - di) / c;
                
                let fsi = esi * Es;
                if (fsi > fy) fsi = fy;
                if (fsi < -fy) fsi = -fy;

                let Fsi = Ab * fsi / 1000;
                if (di <= a) {
                    Fsi -= 0.85 * fc * Ab / 1000;
                }

                sumFs += Fsi;
                sumMs += Fsi * pos / 100;
            });

            const Pn = Cc + sumFs;
            const Mn = Mc + sumMs;

            let phi = 0.65;
            const ey = fy / Es;
            const absEt = Math.abs(et);
            if (absEt >= 0.005) {
                phi = 0.90;
            } else if (absEt <= ey) {
                phi = 0.65;
            } else {
                phi = 0.65 + 0.25 * (absEt - ey) / (0.005 - ey);
            }

            points.push({
                c: c, pn: Pn, mn: Mn,
                pu: phi * Pn, mu: phi * Mn,
                phi: phi,
                desc: absEt >= 0.005 ? "拉力控制" : (absEt <= ey ? "壓力控制" : "過渡區")
            });
        });

        const Po = (0.85 * fc * (Ag - Ast) + fy * Ast) / 1000;
        points.push({ c: 99999, pn: Po, mn: 0, pu: 0.65 * Po, mu: 0, phi: 0.65, desc: "純壓" });

        points.sort((a, b) => a.pu - b.pu);

        const Pu_max = 0.80 * 0.65 * Po;
        const finalPoints = [];
        let capAdded = false;

        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (pt.pu > Pu_max) {
                if (!capAdded) {
                    const prev = points[i - 1];
                    const ratio = (Pu_max - prev.pu) / (pt.pu - prev.pu);
                    const mu_cap = prev.mu + ratio * (pt.mu - prev.mu);
                    finalPoints.push({ c: pt.c, pn: pt.pn, mn: pt.mn, pu: Pu_max, mu: mu_cap, phi: 0.65, desc: "最大軸力限制" });
                    capAdded = true;
                }
                finalPoints.push({ c: pt.c, pn: pt.pn, mn: pt.mn, pu: Pu_max, mu: 0, phi: 0.65, desc: "最大軸力限制(上限)" });
            } else {
                finalPoints.push(pt);
            }
        }

        return {
            calcPoints: points, 
            drawPoints: finalPoints 
        };
    }

    function performBiaxialCheck(forces, pmX_calc, pmY_calc, alpha, pmX_draw, pmY_draw) {
        const Pu_max = pmX_draw[pmX_draw.length - 1].pu;
        const Pu_min = pmX_draw[0].pu;

        return forces.map(f => {
            const Pu = f.p;
            const Mux = Math.abs(f.mx);
            const Muy = Math.abs(f.my);

            if (Pu > Pu_max) {
                return {
                    p: Pu, mx: f.mx, my: f.my,
                    phiMnx: 0, phiMny: 0,
                    ratio: 999,
                    status: "NG (軸壓超限)",
                    note: "軸力超出了最大容許設計軸力上限！"
                };
            }
            if (Pu < Pu_min) {
                return {
                    p: Pu, mx: f.mx, my: f.my,
                    phiMnx: 0, phiMny: 0,
                    ratio: 999,
                    status: "NG (軸拉超限)",
                    note: "軸拉力超出了斷面純拉設計強度！"
                };
            }

            const phiMnx = interpolateMu(Pu, pmX_calc);
            const phiMny = interpolateMu(Pu, pmY_calc);

            let ratio = 0;
            let status = "OK";
            let note = "";

            if (phiMnx <= 0 || phiMny <= 0) {
                ratio = 999;
                status = "NG";
                note = "該軸力下無彎矩容量。";
            } else {
                ratio = Math.pow(Mux / phiMnx, alpha) + Math.pow(Muy / phiMny, alpha);
                if (ratio > 1.0) {
                    status = "NG";
                }
            }

            return {
                p: Pu, mx: f.mx, my: f.my,
                phiMnx: phiMnx,
                phiMny: phiMny,
                ratio: ratio,
                status: status,
                note: note
            };
        });
    }

    function interpolateMu(targetP, pmPoints) {
        for (let i = 0; i < pmPoints.length - 1; i++) {
            const p1 = pmPoints[i].pu;
            const p2 = pmPoints[i+1].pu;

            if (targetP >= p1 && targetP <= p2) {
                const mu1 = pmPoints[i].mu;
                const mu2 = pmPoints[i+1].mu;
                
                if (p2 === p1) return mu1;
                const r = (targetP - p1) / (p2 - p1);
                return mu1 + r * (mu2 - mu1);
            }
        }
        if (targetP < pmPoints[0].pu) return 0;
        return pmPoints[pmPoints.length - 1].mu;
    }


const coords=calculateRebarCoordinates(p.B,p.H,p.rebarX,p.rebarY,p.cover);
const x=calculatePMCurve(p.B,p.H,p.fc,p.fy,p.Es,p.Ab,coords,"y",p.cover);
const y=calculatePMCurve(p.H,p.B,p.fc,p.fy,p.Es,p.Ab,coords,"x",p.cover);
return {x,y,coords,results:performBiaxialCheck(p.forces,x.calcPoints,y.calcPoints,p.alpha,x.drawPoints,y.drawPoints)};
}
