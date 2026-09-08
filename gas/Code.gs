/** StructLab GAS: stateless public API. No Drive, Sheets, user data store or eval. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('StructLab｜雲端結構工作室')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function analyzeModel(request) {
  if (!request || typeof request.text !== 'string') throw new Error('請提供 S2K／F2K 文字檔。');
  const text = request.text;
  if (text.length > 8 * 1024 * 1024 || Utilities.newBlob(text).getBytes().length > 8 * 1024 * 1024)
    throw new Error('單次匯入上限為 8 MiB，請分別匯出模型定義與分析結果。');
  if (/^version https:\/\/git-lfs.github.com\/spec/m.test(text)) throw new Error('這是 Git LFS 指標，請先下載真正的模型檔。');
  const tables = parseTables_(text);
  const safe = !!tables['POINT OBJECT CONNECTIVITY'];
  const source = safe ? safeTables_(tables) : tables;
  const model = legacyModel_(source);
  const warnings = [];
  validateModel_(model, source);
  if (Object.keys(model.joints).length > 40000 || model.frames.length > 50000 || model.areas.length > 20000)
    throw new Error('模型超過此版上限：40,000 節點／50,000 桿件／20,000 面元素。');
  const supportedUnits = /^tonf\s*,\s*m\s*,/i.test(model.units);
  const sections = Object.keys(model.sections).map(name => ({name, ...legacyClassification_(model,name)}));
  let loads = null;
  if (supportedUnits && !safe) {
    loads = legacyLoads_(model);
    if (model.areaLoads.some(l=> !/^(gravity|z|global\s*z)$/i.test(l.dir))) warnings.push('面載重沿用舊版純量加總，包含非重力方向；此結果不是完整重力反力。');
    if (!model.loadPats.some(p=>p.selfWtMult>0)) warnings.push('沿用舊版：未找到正自重係數時，桿件自重係數採 1。');
    if (model.frames.some(f=>!model.sections[f.sect]?.area || !model.materials[model.sections[f.sect]?.mat]?.unitWt)) warnings.push('部分桿件缺斷面面積或材料單位重，自重未計入，請補齊資料。');
  } else {
    sections.forEach(s=>Object.assign(s,{applicable:false,label:'尚未支援此格式／單位的計算',items:[]}));
    warnings.push(safe ? 'SAFE F2K 目前支援幾何與原始表格檢視，工程計算尚未接通。' : '目前工程計算限 Tonf, m, C；本檔只顯示幾何與原始資料，未假設單位或換算。');
  }
  if (!Object.keys(model.joints).length) warnings.push('此檔沒有模型幾何，可檢視分析結果表；３Ｄ需另匯入模型定義。');
  warnings.push('載重彙整沿用舊版符號與樓層分攤；不含面元素自重、節點力與完整分析反力。');
  return {version:'GAS 0.1.0', name:String(request.name||'模型').slice(0,200), format:safe?'SAFE F2K':'SAP2000 S2K', model, tables, sections, loads, warnings};
}

function parseTables_(text) {
  const tables=Object.create(null); let cur=null,buf='',rows=0;
  const forbidden=new Set(['__proto__','prototype','constructor']);
  function read(line) {
    line=line.trim(); if(!line) return;
    const h=line.match(/^TABLE:\s*"([^"]+)"/i);
    if(h){ if(forbidden.has(h[1]))throw new Error('不合法的資料表名稱。'); cur=tables[h[1]]||(tables[h[1]]=[]);return; }
    if(/^END TABLE DATA/i.test(line)){cur=null;return;}
    if(!cur)return;
    const rec=Object.create(null), rx=/(?:"([^"]+)"|([A-Za-z0-9_#$?.\-]+))\s*=\s*(?:"((?:[^"]|"")*)"|(\S+))/g;
    let m;
    while((m=rx.exec(line))){const k=m[1]||m[2],v=m[3]!==undefined?m[3].replace(/""/g,'"'):m[4];if(forbidden.has(k)||forbidden.has(v))throw new Error('不合法的欄位或識別碼。');rec[k]=v;}
    if(Object.keys(rec).length){cur.push(rec);if(++rows>150000)throw new Error('資料超過 150,000 列上限。');}
  }
  for(const line of text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/)){
    const t=line.trimEnd();
    if(/\s_$/.test(t))buf+=t.slice(0,-1);else {read(buf+t);buf='';}
  }
  if(buf)read(buf);
  if(!Object.keys(tables).length)throw new Error('找不到 TABLE 表格，請匯出 SAP2000／SAFE 的表格式文字檔。');
  return tables;
}

function requiredNumber_(v, label, min, max) {
  if(v===null || v===undefined || String(v).trim()==='' || !Number.isFinite(Number(v)))throw new Error(label+' 必須是有效數值。');
  const n=Number(v);if(n<min || n>max)throw new Error(label+' 必須介於 '+min+' 與 '+max+'。');return n;
}
function validateModel_(m,T) {
  const seen=new Set();
  for(const r of T['JOINT COORDINATES']||[]) {
    if(!r.Joint || seen.has(r.Joint)) throw new Error('節點編號缺漏或重複：'+(r.Joint||'空白'));
    seen.add(r.Joint);
    for(const [key,v] of [['X',r.GlobalX??r.XorR],['Y',r.GlobalY??r.Y],['Z',r.GlobalZ??r.Z]])requiredNumber_(v,'節點 '+r.Joint+' 的 '+key,-1e9,1e9);
  }
  const frameIds=new Set();
  for(const f of m.frames){
    if(!f.id || frameIds.has(f.id))throw new Error('桿件編號缺漏或重複。');frameIds.add(f.id);
    const a=m.joints[f.i],b=m.joints[f.j];if(!a||!b)throw new Error('桿件 '+f.id+' 引用了不存在的節點。');
    const len=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    if(!(len>0))throw new Error('桿件 '+f.id+' 長度為零。');
    if(!f.len)f.len=len;
    requiredNumber_(f.len,'桿件長度',Number.MIN_VALUE,1e12);
  }
  for(const a of m.areas)if(a.joints.length<3 || a.joints.some(id=>!m.joints[id]))throw new Error('面元素 '+a.id+' 的節點不完整。');
  const areaIds=new Set(m.areas.map(a=>a.id));
  for(const [name,keys] of [
    ['FRAME SECTION PROPERTIES 01 - GENERAL',['t3','t2','tf','tw','Area']],
    ['MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES',['UnitWeight']],
    ['MATERIAL PROPERTIES 03A - STEEL DATA',['Fy','Fu']],
    ['MATERIAL PROPERTIES 03 - DESIGN STEEL',['Fy','Fu']],
    ['FRAME LOADS - DISTRIBUTED',['RelDistA','RelDistB','AbsDistA','AbsDistB','FOverLA','FOverLB']],
    ['AREA LOADS - UNIFORM',['UnifLoad']],
    ['AREA LOADS - UNIFORM TO FRAME',['UnifLoad']],
    ['LOAD PATTERN DEFINITIONS',['SelfWtMult']]
  ]) for(const r of T[name]||[])for(const k of keys)if(r[k]!==undefined)requiredNumber_(r[k],name+'／'+k,-1e12,1e12);
  for(const l of m.frameLoads)if(!frameIds.has(l.frame))throw new Error('分布載重引用了不存在的桿件：'+l.frame);
  for(const l of m.areaLoads)if(!areaIds.has(l.area))throw new Error('面載重引用了不存在的面元素：'+l.area);
  // Do not let legacy display-size fallbacks masquerade as engineering dimensions.
  for(const r of T['FRAME SECTION PROPERTIES 01 - GENERAL']||[]){const s=m.sections[r.SectionName];for(const k of ['t3','t2','tf','tw'])s[k]=Number(r[k])||0;}
}

function safeTables_(T) {
  const id=r=>r.UniqueName||r['Unique Name'];
  const n=Object.assign(Object.create(null),T);
  n['JOINT COORDINATES']=(T['POINT OBJECT CONNECTIVITY']||[]).map(r=>({Joint:id(r),GlobalX:r.X,GlobalY:r.Y,GlobalZ:r.Z}));
  n['CONNECTIVITY - FRAME']=[...(T['COLUMN OBJECT CONNECTIVITY']||[]),...(T['BEAM OBJECT CONNECTIVITY']||[])].map(r=>({Frame:id(r),JointI:r.UniquePtI,JointJ:r.UniquePtJ,Length:r.Length}));
  n['CONNECTIVITY - AREA']=(T['FLOOR OBJECT CONNECTIVITY']||[]).map(r=>{const a={Area:id(r)};for(let k=1;k<=9;k++)if(r['UniquePt'+k])a['Joint'+k]=r['UniquePt'+k];return a;});
  n['FRAME SECTION ASSIGNMENTS']=(T['FRAME ASSIGNMENTS - SECTION PROPERTIES']||[]).map(r=>({Frame:id(r),AnalSect:r['Section Property']}));
  n['AREA SECTION ASSIGNMENTS']=(T['AREA ASSIGNMENTS - SECTION PROPERTIES']||[]).map(r=>({Area:id(r),Section:r['Section Property']}));
  return n;
}

function calculatePM(input) {
  if(!input || typeof input!=='object')throw new Error('缺少柱墩輸入。');
  const p={};
  for(const [k,min,max] of [['B',10,300],['H',10,300],['fc',100,1000],['fy',1000,8000],['Es',1e6,3e6],['Ab',0.1,30],['cover',1,40],['rebarX',2,30],['rebarY',2,30],['alpha',1,2]])p[k]=requiredNumber_(input[k],k,min,max);
  if(!Number.isInteger(p.rebarX)||!Number.isInteger(p.rebarY))throw new Error('鋼筋支數必須為整數。');
  if(p.cover>=Math.min(p.B,p.H)/2)throw new Error('鋼筋中心至外緣距離必須小於斷面半寬。');
  if((2*p.rebarX+2*p.rebarY-4)*p.Ab>=p.B*p.H)throw new Error('鋼筋總面積必須小於斷面面積。');
  if(!Array.isArray(input.forces)||!input.forces.length||input.forces.length>1000)throw new Error('請提供 1～1,000 列 Pu、Mux、Muy。');
  p.forces=input.forces.map((f,i)=>{const r={};for(const k of ['p','mx','my'])r[k]=requiredNumber_(f[k],'第 '+(i+1)+' 列 '+k,-1e9,1e9);return r;});
  const r=legacyPM_(p);
  return {input:p,...r,notice:'沿用舊版柱墩 P-M 曲線及雙向互制算法，僅為斷面強度比較；不含細長效應、剪力、錨定與配筋細則檢核。不取代正式分析、設計審查或工程簽證。'};
}
