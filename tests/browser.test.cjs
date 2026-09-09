// Local browser integration: real client + real .gs functions through a test-only RPC bridge.
// This does not validate Apps Script deployment, quotas, permissions or network serialization.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
test('browser project isolation, downloads, table paging and PM recovery',async()=>{
  const engine=vm.createContext({});
  for(const name of ['LegacyCore.gs','Code.gs'])vm.runInContext(fs.readFileSync(path.join(root,'gas',name),'utf8'),engine);
  const html=fs.readFileSync(path.join(root,'gas/Index.html'),'utf8');
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('testRpc',({name,payload})=>{
      assert.ok(['analyzeModel','calculatePM'].includes(name));
      return JSON.parse(JSON.stringify(engine[name](payload)));
    });
    await page.addInitScript(()=>{
      const bridge=(success=()=>{},failure=()=>{})=>({
        withSuccessHandler(fn){return bridge(fn,failure);},withFailureHandler(fn){return bridge(success,fn);},
        analyzeModel(payload){window.testRpc({name:'analyzeModel',payload}).then(success,failure);},
        calculatePM(payload){window.testRpc({name:'calculatePM',payload}).then(success,failure);}
      });window.google={script:{run:bridge()}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const ready=()=>page.waitForFunction(()=>!document.getElementById('demo').disabled);
    await page.locator('#demo').click();await ready();
    assert.match(await page.locator('#stats').innerText(),/8/);
    const download=async(selector)=>{const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending;return fs.readFileSync(await d.path(),'utf8');};
    const saved=JSON.parse(await download('#saveProject'));
    assert.equal(saved.schema,'structlab-gas-project');assert.ok(saved.text.includes('JOINT COORDINATES'));
    const upload=async(p)=>{await page.locator('#projectFile').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await ready();};
    const originalName=await page.locator('#modelName').innerText();
    await upload({...saved,text:'invalid',pm:{...saved.pm,B:80}});
    assert.match(await page.locator('#status').innerText(),/TABLE/);
    assert.equal(await page.locator('#pm-B').inputValue(),'60');assert.equal(await page.locator('#modelName').innerText(),originalName);
    await upload({...saved,pm:{...saved.pm,forces:[null]}});
    assert.match(await page.locator('#status').innerText(),/載重列/);
    assert.equal(await page.locator('#modelName').innerText(),originalName);
    await upload({...saved,text:'',name:'PM only',pm:{...saved.pm,B:80}});
    assert.equal(await page.locator('#modelName').innerText(),'尚未匯入模型');assert.equal(await page.locator('#stats').innerText(),'');
    assert.equal(JSON.parse(await download('#saveProject')).text,'');
    await upload(saved);assert.equal(await page.locator('#modelName').innerText(),originalName);
    await page.locator('[data-tab="pm"]').click();await page.locator('#runPM').click();await ready();
    assert.match(await page.locator('#pmTable').innerText(),/0.06542924/);
    assert.match(await download('#pmCsv'),/NG \(軸壓超限\)/);
    await page.locator('#pm-cover').fill('30');await page.locator('#runPM').click();await ready();
    assert.equal(await page.locator('#pmTable').innerText(),'');assert.match(await page.locator('#status').innerText(),/小於/);
    await page.locator('#pm-cover').fill('6');await page.locator('#runPM').click();await ready();
    assert.match(await page.locator('#pmTable').innerText(),/0.06542924/);
    await page.locator('[data-tab="model"]').click();
    const extra='\nTABLE: "BROWSER ROWS"\n'+Array.from({length:205},(_,i)=>`Row=${i} Value="${i===0?'=1+1':'item '+i}"`).join('\n');
    await page.locator('#modelFile').setInputFiles({name:'paging.s2k',mimeType:'text/plain',buffer:Buffer.from(saved.text.replace('END TABLE DATA','')+extra)});await ready();
    await page.locator('[data-tab="tables"]').click();await page.locator('#tableSelect').selectOption('BROWSER ROWS');
    assert.match(await page.locator('#pageInfo').innerText(),/1／3 頁，共 205 列/);
    await page.locator('#next').click();await page.locator('#next').click();assert.equal(await page.locator('#rawTable tbody tr').count(),5);
    await page.locator('#tableSearch').fill('item 204');assert.equal(await page.locator('#rawTable tbody tr').count(),1);
    const csv=await download('#tableCsv');assert.equal(csv.split('\r\n').length,206);assert.ok(csv.includes("\"'=1+1\""));
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-tab="model"]').click();assert.ok(await page.locator('#modelCanvas').isVisible());
    assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
