// Run from the repository root. Install/use Playwright in your existing test environment.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd();const publicDir=path.join(root,'public');const out=path.join(root,'qa/pricing');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');let file=path.join(publicDir,decodeURIComponent(url.pathname));
 if(!file.startsWith(publicDir+path.sep)&&file!==publicDir){res.writeHead(403);return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 else if(!fs.existsSync(file)&&fs.existsSync(file+'.html'))file+='.html';
 if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
 const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.ico':'image/x-icon'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue():route.abort());
  const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,768,375,320]){
   await page.setViewportSize({width,height:900});const response=await page.goto(origin+'/pricing');assert.equal(response.status(),200);
   await page.locator('h1').waitFor();assert.equal(await page.locator('h1').innerText(),'料金表');
   const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<-.5||r.right>innerWidth+.5)}).map(e=>e.tagName+'.'+e.className)}));
   assert.ok(layout.scroll<=width,JSON.stringify(layout));assert.equal(layout.overflow.length,0,JSON.stringify(layout));
   assert.equal(await page.locator('[data-price-item]:visible').count(),25);
   const amounts = await page.locator('.amount').evaluateAll(es=>es.map(e=>({text:e.innerText,height:e.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e).lineHeight),scroll:e.scrollWidth,width:e.clientWidth})));
   assert.ok(amounts.every(a=>a.height<=a.lineHeight+1&&a.scroll<=a.width+1),JSON.stringify(amounts));
   assert.equal(await page.locator('[data-term]:visible').count(),6);
   for(const link of await page.locator('.price-index a').all()){
    const href=await link.getAttribute('href');await link.click();assert.equal(new URL(page.url()).hash,href);assert.ok(await page.locator(href).isVisible());
   }
   await page.getByRole('link',{name:'初回60分の無料相談',exact:true}).click();assert.equal(new URL(page.url()).hash,'#contact');
   await page.getByRole('link',{name:'お問い合わせフォームへ',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/');assert.equal(new URL(page.url()).hash,'#contact');assert.ok(await page.locator('#contact form').isVisible());
   // Never submit the existing form or invoke mailto.
   await page.goto(origin+'/');const link=page.getByRole('link',{name:'料金表を見る（税込・サービス別） →',exact:true});
   await link.click();assert.equal(new URL(page.url()).pathname,'/pricing');
   await page.goto(origin+'/pricing');
   if(width===1440||width===375)await page.screenshot({path:path.join(out,`pricing-${width}.png`),fullPage:true});
   results.push({width,status:'PASS',...layout,prices:25,terms:6,categoryLinks:6,topToPricing:true,pricingToContactForm:true});
  }
  await page.goto(origin+'/pricing');await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').innerText(),'本文へ移動');
  await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,'#main');
  await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/pricing');
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  const zoom=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(zoom.scroll<=zoom.viewport,'200% text reflow');
  assert.deepEqual(errors,[],'no JavaScript runtime errors');
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({browser:await browser.version(),environment:'Local static server with Firebase-style directory index routing; external requests blocked; no form submission',results,keyboardSkipLink:'PASS',textScale200Percent:zoom,pageErrors:errors},null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
