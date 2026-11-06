// Layout check for every game page, run before shipping a change:  node scripts/check-layout.cjs [page ...]
//  1. no page scrolls sideways on a phone (360x740, 740x360) or a desktop (1280x800);
//  2. board grids keep every cell the same size after ~25 random taps (a row or column must never grow to fit
//     what was drawn in it, like a hit marker or an X).
// Grids whose cells legitimately differ (a header row, clue strips, a number pad) are listed in ALLOW.
// Needs Playwright with Chromium (npm i -D playwright; npx playwright install chromium).
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const ALLOW={'bingo.html':['.card'],'picture-cross.html':['#board'],'cross-sums.html':['#pad']};
(async()=>{const only=process.argv.slice(2);
  const files=only.length?only.map(f=>f.endsWith('.html')?f:f+'.html'):fs.readdirSync(ROOT).filter(f=>f.endsWith('.html')&&f!=='index.html');
  const b=await chromium.launch();const problems=[];
  for(const [w,h] of [[360,740],[740,360],[1280,800]]){const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:w<800,isMobile:w<800});
    for(const f of files){const p=await ctx.newPage();p.on('dialog',d=>d.accept());const errs=[];p.on('pageerror',e=>errs.push(e.message));
      await p.goto('file://'+path.join(ROOT,f));await p.waitForTimeout(300);
      const measure=()=>p.evaluate(()=>{const out=[];for(const g of document.querySelectorAll('*')){const cs=getComputedStyle(g);if(!/grid/.test(cs.display))continue;
        const kids=[...g.children].filter(k=>getComputedStyle(k).position!=='absolute'&&k.offsetParent!==null);if(kids.length<9||cs.gridTemplateColumns.split(' ').length<3)continue;
        if(new Set(kids.map(k=>k.tagName)).size>1)continue;if(kids.some(k=>{const s=getComputedStyle(k);return /span/.test(s.gridColumnEnd+s.gridRowEnd)}))continue;
        const t=x=>x.split(' ').map(parseFloat).filter(n=>!isNaN(n)),rr=t(cs.gridTemplateRows),cc=t(cs.gridTemplateColumns);
        out.push({sel:g.id?'#'+g.id:'.'+[...g.classList].join('.'),spread:Math.max(Math.max(...rr)-Math.min(...rr),Math.max(...cc)-Math.min(...cc))})}return out});
      for(let k=0;k<25;k++){await p.evaluate(()=>{const gs=[...document.querySelectorAll('*')].filter(g=>/grid/.test(getComputedStyle(g).display)&&g.children.length>=9);
        const g=gs[Math.floor(Math.random()*gs.length)];if(!g)return;const c=g.children[Math.floor(Math.random()*g.children.length)];if(c&&!c.disabled)c.click()}).catch(()=>{});await p.waitForTimeout(60)}
      await p.waitForTimeout(700);
      const ov=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth).catch(()=>0);if(ov>1)problems.push(`${w}x${h} ${f}: page scrolls sideways by ${ov}px`);
      for(const g of await measure().catch(()=>[]))if(g.spread>1.5&&!(ALLOW[f]||[]).includes(g.sel))problems.push(`${w}x${h} ${f}: cells of ${g.sel} differ by ${g.spread.toFixed(1)}px`);
      if(errs.length)problems.push(`${w}x${h} ${f}: script error: ${errs[0]}`);
      await p.close()}await ctx.close()}
  await b.close();
  if(problems.length){console.log(problems.join('\n'));console.log(`\n${problems.length} problem(s).`);process.exit(1)}
  console.log(`Layout OK: ${files.length} page(s) at 3 sizes.`)})();
