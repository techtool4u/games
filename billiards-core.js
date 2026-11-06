/*
 * Game Parlor billiards: the table, the physics, 8-ball rules, the computer player and the game flow,
 * shared by billiards.html (top-down 2D) and billiards-3d.html (three.js). A page supplies only a renderer
 * and its input; this file owns everything else, including online play through P2P.net (p2p.js).
 *
 * Units: the playing surface is 200 x 100 (x along the length, y across). Ball radius 2.25 matches a
 * regulation ball on a 9-foot table. The physics runs in fixed steps of 1/960 s using only + - * / and sqrt,
 * so two devices given the same shot compute exactly the same result.
 */
(function(){
  const L=200,W=100,R=2.25,STEP=1/960,MAXV=620;
  const MU=11,DRAG=0.22,E_BALL=0.95,E_RAIL=0.78,STOP=0.6;
  const CORNER_MOUTH=5.6,SIDE_MOUTH=3.9;
  // pocket centers sit a little outside the cushion line; a ball whose center comes within PR is in
  const POCKETS=[{x:-1.6,y:-1.6,r:4.8},{x:L/2,y:-2.9,r:4.3},{x:L+1.6,y:-1.6,r:4.8},{x:-1.6,y:W+1.6,r:4.8},{x:L/2,y:W+2.9,r:4.3},{x:L+1.6,y:W+1.6,r:4.8}];
  // cushions between the pocket mouths; their end points act as the rounded jaws
  const RAILS=[[CORNER_MOUTH,0,L/2-SIDE_MOUTH,0],[L/2+SIDE_MOUTH,0,L-CORNER_MOUTH,0],[CORNER_MOUTH,W,L/2-SIDE_MOUTH,W],[L/2+SIDE_MOUTH,W,L-CORNER_MOUTH,W],
    [0,CORNER_MOUTH,0,W-CORNER_MOUTH],[L,CORNER_MOUTH,L,W-CORNER_MOUTH]];
  const HEAD=L*0.25,FOOT={x:L*0.75,y:W/2};
  const COLORS=['#f8f4e6','#f2c230','#2257c9','#d8312c','#6a3fb0','#ef7a21','#1f8a4c','#8a2131','#141414','#f2c230','#2257c9','#d8312c','#6a3fb0','#ef7a21','#1f8a4c','#8a2131'];
  const groupOf=n=>n===0?'cue':n===8?'eight':n<8?'solid':'stripe';

  /* ---------- table state ---------- */
  function rack(rand){rand=rand||Math.random;
    const order=[1,2,3,4,5,6,7,9,10,11,12,13,14,15];for(let i=order.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
    // the 8 goes in the middle of the third row; the two back corners get one solid and one stripe
    const slots=[];for(let row=0;row<5;row++)for(let k=0;k<=row;k++)slots.push({row,k});
    const pick=g=>{const i=order.findIndex(n=>groupOf(n)===g);return order.splice(i,1)[0]};
    const at={};at[4]=8;const flip=rand()<.5;at[10]=pick(flip?'solid':'stripe');at[14]=pick(flip?'stripe':'solid');
    const dx=2*R*0.866+0.02,balls=[{n:0,x:HEAD-12,y:W/2,vx:0,vy:0,on:true}];
    slots.forEach((s,i)=>{const n=at[i]!=null?at[i]:order.shift();balls.push({n,x:FOOT.x+s.row*dx,y:FOOT.y+(s.k-s.row/2)*(2*R+0.02),vx:0,vy:0,on:true})});
    balls.sort((a,b)=>a.n-b.n);return balls}
  const clone=b=>b.map(o=>({n:o.n,x:o.x,y:o.y,vx:o.vx,vy:o.vy,on:o.on}));

  /* ---------- physics ---------- */
  // Advance one fixed step. ev collects what happened during a shot (first ball the cue touched, rails, pots).
  function step(balls,ev){const h=STEP;let moving=false;
    for(const b of balls){if(!b.on)continue;const s2=b.vx*b.vx+b.vy*b.vy;if(!s2)continue;const s=Math.sqrt(s2);
      const ns=s-(MU+DRAG*s)*h;if(ns<=STOP*h*60&&ns<STOP){b.vx=b.vy=0;continue}const k=ns/s;b.vx*=k;b.vy*=k;b.x+=b.vx*h;b.y+=b.vy*h;moving=true}
    // ball against ball
    for(let i=0;i<balls.length;i++){const a=balls[i];if(!a.on)continue;
      for(let j=i+1;j<balls.length;j++){const b=balls[j];if(!b.on)continue;const dx=b.x-a.x,dy=b.y-a.y;if(dx>2*R||dx<-2*R||dy>2*R||dy<-2*R)continue;
        const d2=dx*dx+dy*dy;if(d2>=4*R*R||d2===0)continue;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,rel=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
        const push=(2*R-d)/2;a.x-=nx*push;a.y-=ny*push;b.x+=nx*push;b.y+=ny*push;
        if(rel<=0)continue;const jv=rel*(1+E_BALL)/2;a.vx-=jv*nx;a.vy-=jv*ny;b.vx+=jv*nx;b.vy+=jv*ny;
        if(ev){if(ev.first==null&&(a.n===0||b.n===0))ev.first=a.n===0?b.n:a.n;ev.clicks.push(Math.min(1,rel/300))}}}
    // cushions and jaws
    for(const b of balls){if(!b.on)continue;
      for(const [x1,y1,x2,y2] of RAILS){const sx=x2-x1,sy=y2-y1,t=Math.max(0,Math.min(1,((b.x-x1)*sx+(b.y-y1)*sy)/(sx*sx+sy*sy)));
        const cx=x1+sx*t,cy=y1+sy*t,dx=b.x-cx,dy=b.y-cy,d2=dx*dx+dy*dy;if(d2>=R*R)continue;
        let d=Math.sqrt(d2),nx,ny;if(d<1e-9){nx=x1===x2?(b.x<x1?-1:1)*-1:0;ny=y1===y2?(y1===0?1:-1):0;if(x1===x2)nx=x1===0?1:-1;d=0}else{nx=dx/d;ny=dy/d}
        // a ball behind the cushion line (inside a pocket mouth) is pushed toward the table
        b.x+=nx*(R-d);b.y+=ny*(R-d);const vn=b.vx*nx+b.vy*ny;
        if(vn<0){b.vx-=(1+E_RAIL)*vn*nx;b.vy-=(1+E_RAIL)*vn*ny;b.vx*=0.985;b.vy*=0.985;if(ev){ev.rails.add(b.n);if(ev.first!=null)ev.railAfter=true;ev.thuds.push(Math.min(1,-vn/300))}}}
      // pockets
      for(let p=0;p<POCKETS.length;p++){const pk=POCKETS[p],dx=b.x-pk.x,dy=b.y-pk.y;
        if(dx*dx+dy*dy<pk.r*pk.r){b.on=false;b.vx=b.vy=0;b.pocket=p;if(ev)ev.pots.push({n:b.n,p});break}}
      if(b.on&&(b.x<-6||b.x>L+6||b.y<-6||b.y>W+6)){let best=0,bd=1e9;POCKETS.forEach((pk,p)=>{const d=(b.x-pk.x)**2+(b.y-pk.y)**2;if(d<bd){bd=d;best=p}});
        b.on=false;b.vx=b.vy=0;b.pocket=best;if(ev)ev.pots.push({n:b.n,p:best})}}
    return moving}
  const newEvents=()=>({first:null,rails:new Set(),railAfter:false,pots:[],clicks:[],thuds:[]});
  function strike(balls,dx,dy,power){const cue=balls[0],d=Math.sqrt(dx*dx+dy*dy)||1,v=12+(MAXV-12)*Math.max(0,Math.min(1,power));cue.vx=dx/d*v;cue.vy=dy/d*v}
  // run a whole shot without drawing (used by the computer player and to settle online shots)
  function simulate(balls,dx,dy,power,maxSteps){const b=clone(balls),ev=newEvents();strike(b,dx,dy,power);
    for(let i=0;i<(maxSteps||960*25);i++){if(!step(b,ev)&&i>2)break}return{balls:b,ev}}
  const canPlace=(balls,x,y,kitchen)=>{if(x<R||x>L-R||y<R||y>W-R)return false;if(kitchen&&x>HEAD)return false;
    return balls.every(o=>!o.on||o.n===0||(o.x-x)**2+(o.y-y)**2>=4*R*R*1.02)};
  function nearestFree(balls,x,y,kitchen){x=Math.max(R,Math.min((kitchen?HEAD:L-R),x));y=Math.max(R,Math.min(W-R,y));if(canPlace(balls,x,y,kitchen))return{x,y};
    for(let rad=1;rad<60;rad+=1)for(let a=0;a<16;a++){const nx=x+Math.cos(a*Math.PI/8)*rad,ny=y+Math.sin(a*Math.PI/8)*rad;if(canPlace(balls,nx,ny,kitchen))return{x:nx,y:ny}}return{x,y}}

  /* ---------- 8-ball rules ---------- */
  // Who may be hit first: the player's group, or anything but the 8 while the table is open; the 8 once the group is cleared.
  function targets(S,p){const g=S.groups[p];if(!g){const t=S.balls.filter(b=>b.on&&b.n!==0&&b.n!==8).map(b=>b.n);return t.length?t:[8]}
    const own=S.balls.filter(b=>b.on&&groupOf(b.n)===g).map(b=>b.n);return own.length?own:[8]}
  // Decide the outcome of a finished shot. Returns a short message; updates turn, groups, ball in hand and game over.
  function judge(S,ev){const p=S.turn,o=1-p,potted=ev.pots.map(x=>x.n),scratch=potted.includes(0),wasBreak=!S.broken;
    const legalFirst=targets(S,p);let foul=null;
    if(ev.first==null)foul='The cue ball didn\'t touch another ball.';
    else if(!legalFirst.includes(ev.first))foul=ev.first===8?'Hit the 8 first.':`Hit the wrong group first (${groupOf(ev.first)}s).`;
    else if(!potted.length&&!ev.railAfter&&!wasBreak)foul='No ball reached a cushion after contact.';
    if(scratch)foul='Scratch: the cue ball went in.';
    S.broken=true;S.shots++;
    const own=S.groups[p];
    if(potted.includes(8)){
      if(wasBreak){const e=S.balls[8];const sp=nearestFree(S.balls,FOOT.x,FOOT.y,false);Object.assign(e,{on:true,x:sp.x,y:sp.y,vx:0,vy:0});if(scratch)return turnOver(S,'The 8 went in on the break and is spotted again. Scratch: ball in hand.',true);return{msg:'The 8 went in on the break and is spotted again.',keep:true}}
      const cleared=own&&!S.balls.some(b=>b.on&&groupOf(b.n)===own);
      if(cleared&&!foul&&legalFirst.includes(8)){S.over={winner:p,why:`${S.names[p]} sank the 8.`};return{msg:S.over.why}}
      S.over={winner:o,why:foul?`${S.names[p]} sank the 8 on a foul.`:`${S.names[p]} sank the 8 too early.`};return{msg:S.over.why}}
    if(scratch){const c=S.balls[0];c.on=true;c.vx=c.vy=0}
    if(foul)return turnOver(S,foul,true);
    // the first legally potted group ball on an open table decides the groups
    let mine=potted.filter(n=>n!==0);
    if(!S.groups[p]&&mine.length&&!wasBreak){const g=groupOf(mine[0]);S.groups[p]=g;S.groups[o]=g==='solid'?'stripe':'solid';
      return{msg:`${S.names[p]} takes the ${g}s.`,keep:true}}
    if(wasBreak&&mine.length)return{msg:'Good break! Shoot again; the table is still open.',keep:true};
    if(S.groups[p]?mine.some(n=>groupOf(n)===S.groups[p]):mine.length)return{msg:'',keep:true};
    return turnOver(S,mine.length?`${S.names[p]} potted only the other group's ball.`:'',false)}
  function turnOver(S,msg,foul){S.turn=1-S.turn;if(foul&&msg)msg='Foul! '+msg;if(foul){S.inHand='anywhere';const c=S.balls[0];c.on=true;const sp=nearestFree(S.balls,c.x,c.y,false);c.x=sp.x;c.y=sp.y}return{msg,foul}}

  /* ---------- computer player ---------- */
  const LEVELS={easy:{noise:.06,sims:0,power:1.2},medium:{noise:.016,sims:1,cands:4,pows:[1],power:1},hard:{noise:.005,sims:1,cands:8,pows:[.85,1,1.2],power:1}};
  const clearPath=(balls,ax,ay,bx,by,skip)=>{const sx=bx-ax,sy=by-ay,len2=sx*sx+sy*sy;return balls.every(o=>{if(!o.on||skip.includes(o.n))return true;
    const t=Math.max(0,Math.min(1,((o.x-ax)*sx+(o.y-ay)*sy)/len2)),dx=o.x-ax-sx*t,dy=o.y-ay-sy*t;return dx*dx+dy*dy>=4*R*R*0.98})};
  function candidates(S,cx,cy){const out=[],tg=targets(S,S.turn);
    for(const n of tg){const b=S.balls[n];if(!b.on)continue;
      for(const pk of POCKETS){const px=pk.x+(pk.x<0?1.5:pk.x>L?-1.5:0),py=pk.y+(pk.y<0?2:pk.y>W?-2:0);
        const tx=px-b.x,ty=py-b.y,tl=Math.sqrt(tx*tx+ty*ty),ux=tx/tl,uy=ty/tl,gx=b.x-ux*2*R,gy=b.y-uy*2*R;
        const ax=gx-cx,ay=gy-cy,al=Math.sqrt(ax*ax+ay*ay);if(al<0.5)continue;const cut=(ax*ux+ay*uy)/al;if(cut<0.25)continue;
        if(!clearPath(S.balls,cx,cy,gx,gy,[0,n])||!clearPath(S.balls,b.x,b.y,px,py,[n,0]))continue;
        const dist=al+tl,power=Math.min(1,0.12+dist/260/Math.max(.35,cut));out.push({dx:ax,dy:ay,power,score:cut*cut*120-dist*0.25,n})}}
    out.sort((a,b)=>b.score-a.score);
    if(!out.length)for(const n of tg){const b=S.balls[n];if(b.on)out.push({dx:b.x-cx,dy:b.y-cy,power:.45,score:-50,n})}
    return out}
  function evalShot(S,c){const T=Object.assign({},S,{balls:clone(S.balls),groups:S.groups.slice(),over:null}),r=simulate(T.balls,c.dx,c.dy,c.power);T.balls=r.balls;
    const e0=S.balls[8],e1=T.balls[8],moved8=e0.on&&e1.on?Math.sqrt((e0.x-e1.x)**2+(e0.y-e1.y)**2):0,on8=targets(S,S.turn).includes(8);
    const res=judge(T,r.ev);if(T.over)return T.over.winner===S.turn?1e4:-1e4;let s=res.foul?-300:res.keep?200:0;
    // a shot that knocks the 8 around is a risk even when it works out in the simulation
    if(!on8)s-=Math.min(250,moved8*12);
    // prefer leaving the cue ball somewhere with a follow-up shot
    if(res.keep&&!res.foul){const cue=T.balls[0];const nxt=candidates(T,cue.x,cue.y);s+=nxt.length&&nxt[0].score>0?nxt[0].score*0.5:-20}return s}
  function think(S,level,rand){rand=rand||Math.random;const L_=LEVELS[level]||LEVELS.medium;let cue=S.balls[0];
    let place=null;
    if(S.inHand){// try a few spots for the cue ball and keep the one with the best shot
      let best=null;for(let i=0;i<60;i++){const x=R+rand()*((S.inHand==='kitchen'?HEAD:L)-2*R),y=R+rand()*(W-2*R);if(!canPlace(S.balls,x,y,S.inHand==='kitchen'))continue;
        const c=candidates(S,x,y)[0];if(c&&(!best||c.score>best.s))best={x,y,s:c.score}}
      place=best?{x:best.x,y:best.y}:nearestFree(S.balls,HEAD-12,W/2,S.inHand==='kitchen')}
    const cx=place?place.x:cue.x,cy=place?place.y:cue.y;
    let list=candidates(S,cx,cy);
    if(!S.broken)list=[{dx:FOOT.x-cx+(rand()-.5)*1.2,dy:FOOT.y-cy+(rand()-.5)*1.2,power:.92+rand()*.08}];
    if(!list.length)list=[{dx:1,dy:0.01,power:.5}];
    // the computer's aim isn't perfect: each shot it considers gets its wobble first, and the shot it tested is the shot it plays
    const wobble=c=>{const a=Math.atan2(c.dy,c.dx)+(rand()-.5)*2*L_.noise*(S.broken?1:.3),l=Math.sqrt(c.dx*c.dx+c.dy*c.dy);
      return{dx:Math.cos(a)*l,dy:Math.sin(a)*l,power:Math.min(1,c.power*L_.power*(1+(rand()-.5)*(L_.sims?.04:.1)))}};
    let pick=wobble(list[0]);
    if(L_.sims&&S.broken){const T=Object.assign({},S,{balls:clone(S.balls)});if(place){T.balls[0].x=place.x;T.balls[0].y=place.y;T.balls[0].on=true}
      let best=-1e9;for(const c of list.slice(0,L_.cands))for(const pm of L_.pows){const cc=wobble(Object.assign({},c,{power:Math.min(1,c.power*pm)}));const s=evalShot(T,cc);if(s>best){best=s;pick=cc}}}
    return{place,dx:pick.dx,dy:pick.dy,power:pick.power}}

  /* ---------- game flow (shared by both pages) ----------
   * Pool.app({game:'Billiards', renderer:{draw(view), resize()}, ...}) wires the common controls by id:
   * #mode #level #conn #netbar #newgame #status #players #power (power bar) #overlay #modal.
   * The renderer calls app.aimAt(x,y) / app.nudge(rad) / app.placeCue(x,y) / app.setPower(p) / app.shoot(). */
  function app(o){const $=id=>document.getElementById(id);
    const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
    const KEY='parlor-billiards';const cfg=Object.assign({mode:'cpu',level:'medium'},store.get(KEY,{}));if(!['cpu','two'].includes(cfg.mode))cfg.mode='cpu';if(!LEVELS[cfg.level])cfg.level='medium';
    let S=null,net=null,games=0,anim=null,aim={dx:1,dy:0},power=0,lastAimSend=0,cpuT=0,peerAim=null;const sfx=window.sfx||function(){};
    const online=()=>cfg.mode==='net'&&!!net&&net.online();
    const me=()=>cfg.mode==='net'?(net&&net.role==='guest'?1:0):cfg.mode==='cpu'?0:S.turn;
    const isCpu=p=>cfg.mode==='cpu'&&p===1;
    const myTurn=()=>S&&!S.over&&!anim&&!S.busy&&(cfg.mode==='two'||(cfg.mode==='cpu'?S.turn===0:online()&&S.turn===me()));
    function names(){return cfg.mode==='cpu'?['You','Computer']:cfg.mode==='two'?['Player 1','Player 2']:(net&&net.role==='guest'?['Friend','You']:['You','Friend'])}
    function newGame(from){
      if(cfg.mode==='net'&&!from&&online()&&net.role==='guest'){net.send({t:'again'});net.note('Asked the host for a new game.');return}
      $('overlay').hidden=true;clearTimeout(cpuT);anim=null;
      const breaker=from?from.turn:cfg.mode==='net'?(games++%2):0;
      S={balls:from?from.balls:rack(),turn:breaker,groups:[null,null],broken:false,inHand:'kitchen',over:null,shots:0,msg:'',names:names(),gen:(S?S.gen:0)+1};
      aimDefault();power=0;setPowerUI(0);render();
      if(cfg.mode==='net'){if(!online()&&!from)net.start();else if(net.role==='host'&&!from)net.send({t:'start',balls:S.balls,turn:S.turn})}
      maybeCpu()}
    function aimDefault(){const c=S.balls[0];aim={dx:FOOT.x-c.x,dy:FOOT.y-c.y}}
    // --- input from the renderer ---
    const api={
      get S(){return S},get aim(){return aim},get power(){return power},get myTurn(){return myTurn()},get anim(){return anim},get peerAim(){return peerAim},
      L,W,R,POCKETS,RAILS,HEAD,COLORS,groupOf,
      aimAt(x,y){if(!myTurn())return;const c=S.balls[0];const dx=x-c.x,dy=y-c.y;if(dx*dx+dy*dy<1)return;aim={dx,dy};changed()},
      setAim(a){if(!myTurn())return;aim={dx:Math.cos(a),dy:Math.sin(a)};changed()},
      nudge(rad){if(!myTurn())return;const a=Math.atan2(aim.dy,aim.dx)+rad;aim={dx:Math.cos(a),dy:Math.sin(a)};changed()},
      canPlace(x,y){return !!S.inHand&&myTurn()&&canPlace(S.balls,x,y,S.inHand==='kitchen')},
      placeCue(x,y){if(!S.inHand||!myTurn())return false;const sp=nearestFree(S.balls,x,y,S.inHand==='kitchen');const c=S.balls[0];c.x=sp.x;c.y=sp.y;c.on=true;changed();return true},
      setPower(p){power=Math.max(0,Math.min(1,p));setPowerUI(power);changed()},
      shoot(){if(!myTurn()||power<0.02)return false;const c=S.balls[0],shot={cue:{x:c.x,y:c.y},dx:aim.dx,dy:aim.dy,power,n:S.shots};
        if(cfg.mode==='net')net.send(Object.assign({t:'shot'},shot));play(shot);return true},
      ghost(){return ghost()},render};
    function changed(){render();if(online()&&myTurn()){const t=Date.now();if(t-lastAimSend>90){lastAimSend=t;const c=S.balls[0];net.send({t:'aim',dx:aim.dx,dy:aim.dy,power,cue:{x:c.x,y:c.y}})}}}
    // where the aim line first meets a ball or a cushion, for drawing the guide and the ghost ball
    function ghost(){const c=S.balls[0];const d=Math.sqrt(aim.dx*aim.dx+aim.dy*aim.dy)||1,ux=aim.dx/d,uy=aim.dy/d;let best=1e9,hit=null;
      for(const b of S.balls){if(!b.on||b.n===0)continue;const fx=b.x-c.x,fy=b.y-c.y,t=fx*ux+fy*uy;if(t<=0)continue;const perp2=fx*fx+fy*fy-t*t;if(perp2>4*R*R)continue;const tt=t-Math.sqrt(4*R*R-perp2);if(tt<best){best=tt;hit=b}}
      let wall=1e9;if(ux>0)wall=Math.min(wall,(L-R-c.x)/ux);if(ux<0)wall=Math.min(wall,(R-c.x)/ux);if(uy>0)wall=Math.min(wall,(W-R-c.y)/uy);if(uy<0)wall=Math.min(wall,(R-c.y)/uy);
      const t=Math.min(best,wall),gx=c.x+ux*t,gy=c.y+uy*t;let out=null;if(hit&&best<=wall){const nx=hit.x-gx,ny=hit.y-gy,nl=Math.sqrt(nx*nx+ny*ny)||1;out={x:nx/nl,y:ny/nl}}
      return{x:gx,y:gy,ball:hit&&best<=wall?hit:null,dir:out,ux,uy}}
    // --- playing a shot: the same fixed steps on every device, drawn as they happen ---
    function play(shot){const c=S.balls[0];if(S.inHand){c.x=shot.cue.x;c.y=shot.cue.y;c.on=true}S.inHand=null;peerAim=null;
      const ev=newEvents();strike(S.balls,shot.dx,shot.dy,shot.power);sfx('clack',{big:shot.power>.6});
      anim={ev,steps:0,gen:S.gen,last:performance.now(),acc:0};power=0;setPowerUI(0);
      const tick=t=>{if(!anim||anim.gen!==S.gen)return;anim.acc+=Math.min(0.1,(t-anim.last)/1000);anim.last=t;let moving=true;
        while(anim.acc>=STEP&&moving){anim.acc-=STEP;moving=step(S.balls,ev);anim.steps++;if(anim.steps>960*25)moving=false}
        sounds(ev);render();if(moving&&anim.steps<960*25)requestAnimationFrame(tick);else finishShot(ev)};
      requestAnimationFrame(t=>{anim.last=t;tick(t)})}
    // run the rest of a shot at once (a hidden tab doesn't animate)
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&anim){const ev=anim.ev;while(step(S.balls,ev)&&anim.steps++<960*25);finishShot(ev)}});
    function sounds(ev){for(const v of ev.clicks.splice(0))if(v>.05)sfx('clack',{big:v>.5});for(const v of ev.thuds.splice(0))if(v>.08)sfx('bounce');for(const p of ev.pots.slice(ev._heard||0)){sfx('drop');ev._heard=(ev._heard||0)+1}}
    function finishShot(ev){if(!anim)return;anim=null;const was=S.turn,res=judge(S,ev);S.msg=res.msg||'';
      if(S.over){render();sfx(cfg.mode==='cpu'?(S.over.winner===0?'win':'lose'):cfg.mode==='net'?(S.over.winner===me()?'win':'lose'):'win');setTimeout(showEnd,700)}
      else{if(res.foul)sfx('bad');aimDefault();if(S.turn===was&&S.balls[0].on){}render()}
      if(online()&&net.role==='host')net.send({t:'state',S:pack()});
      maybeCpu()}
    function maybeCpu(){clearTimeout(cpuT);if(!S||S.over||!isCpu(S.turn))return;S.busy=true;render();const g=S.gen;
      cpuT=setTimeout(()=>{if(g!==S.gen)return;const plan=think(S,cfg.level);
        if(plan.place){const c=S.balls[0];c.x=plan.place.x;c.y=plan.place.y;c.on=true}aim={dx:plan.dx,dy:plan.dy};render();
        // show the aim for a moment, then shoot
        let k=0;const pull=setInterval(()=>{if(g!==S.gen){clearInterval(pull);return}k++;power=Math.min(plan.power,k/12*plan.power);setPowerUI(power);render();
          if(k>=12){clearInterval(pull);S.busy=false;const c=S.balls[0];play({cue:{x:c.x,y:c.y},dx:plan.dx,dy:plan.dy,power:plan.power,n:S.shots})}},55)},650)}
    function pack(){return{balls:clone(S.balls),turn:S.turn,groups:S.groups,broken:S.broken,inHand:S.inHand,over:S.over,shots:S.shots,msg:S.msg}}
    function showEnd(){if(!S.over)return;const w=S.over.winner;const t=cfg.mode==='cpu'?(w===0?'You win!':'Computer wins'):cfg.mode==='net'?(w===me()?'You win!':'Your friend wins'):`${S.names[w]} wins!`;
      $('modal').innerHTML=`<h2>${t}</h2><p>${S.over.why}</p><div class="row"><button class="btn" id="mview">View table</button><button class="btn primary" id="magain">Play again</button></div>`;
      $('overlay').hidden=false;$('mview').onclick=()=>{$('overlay').hidden=true};$('magain').onclick=()=>newGame();$('magain').focus()}
    // --- status and players ---
    function render(){if(!S)return;if(net)net.render();
      const nm=cfg.mode==='net',live=online();
      const grp=p=>S.groups[p]?(S.groups[p]==='solid'?'Solids 1–7':'Stripes 9–15'):'Open table';
      const left=p=>{const g=S.groups[p];if(!g)return'';const n=S.balls.filter(b=>b.on&&groupOf(b.n)===g).length;return n?`${n} left`:'on the 8'};
      $('players').innerHTML=[0,1].map(p=>{const g=S.groups[p],balls=g?S.balls.filter(b=>groupOf(b.n)===g).map(b=>`<i class="bb${b.on?'':' gone'}" style="--c:${COLORS[b.n]}" data-s="${g==='stripe'?1:0}"><span>${b.n}</span></i>`).join(''):'';
        return`<div class="pl${!S.over&&S.turn===p?' cur':''}"><b>${S.names[p]}</b><small>${grp(p)}${g?' · '+left(p):''}</small><span class="bbs">${balls}</span></div>`}).join('');
      let st;if(S.over)st=S.over.why;else if(nm&&!live)st='Not connected. Tap Connect to play a friend.';
      else if(anim)st='Rolling…';else if(isCpu(S.turn))st='The computer is lining up a shot…';
      else{const who=cfg.mode==='two'?`${S.names[S.turn]}: `:'';const mine=myTurn();
        st=mine?`${who}${S.inHand?(S.inHand==='kitchen'?'Place the cue ball behind the line, then ':'Ball in hand: place the cue ball anywhere, then '):''}aim and pull back the cue to shoot.`:"Your friend is lining up a shot…"}
      $('status').innerHTML=(S.msg&&!anim&&!S.over?`<b>${S.msg}</b> `:'')+st;
      $('level').hidden=cfg.mode!=='cpu';document.body.classList.toggle('my-turn',myTurn());
      o.renderer.draw(api)}
    function setPowerUI(p){const el=$('power');if(el)el.style.setProperty('--p',p)}
    // --- settings ---
    function sync(){$('mode').value=cfg.mode;$('level').value=cfg.level}
    const started=()=>S&&S.broken&&!S.over;
    $('mode').onchange=e=>{if(started()&&!confirm('Start a new game?')){sync();return}cfg.mode=e.target.value;if(cfg.mode!=='net')store.set(KEY,cfg);games=0;newGame()};
    $('level').onchange=e=>{cfg.level=e.target.value;store.set(KEY,cfg);render()};
    $('newgame').onclick=()=>{if(started()&&!confirm('Start a new game?'))return;newGame()};
    // --- online: both devices run each shot; the host's table after every shot settles any difference ---
    if(window.P2P&&P2P.net)net=P2P.net({game:o.game,bar:$('netbar'),conn:$('conn'),active:()=>cfg.mode==='net',
      onOpen(role){S.names=names();if(role==='host'){games=0;newGame();net.note('Connected! You break first.')}else{render();net.note('Connected! Waiting for the host…')}},
      onMessage(m){
        if(m.t==='shot'){if(anim||S.over||S.turn===me()||m.n!==S.shots){if(net.role==='host')net.send({t:'state',S:pack()});return}play(m);return}
        if(m.t==='aim'){if(!anim&&S.turn!==me()){peerAim=m;if(S.inHand&&m.cue){const c=S.balls[0];c.x=m.cue.x;c.y=m.cue.y}aim={dx:m.dx,dy:m.dy};setPowerUI(m.power);render()}return}
        if(net.role==='host'){if(m.t==='again')newGame();return}
        if(m.t==='start'){newGame({balls:m.balls,turn:m.turn});net.note(m.turn===1?'New game: you break.':'New game: your friend breaks.')}
        else if(m.t==='state'){if(anim)anim=null;Object.assign(S,m.S);S.names=names();aimDefault();render();if(S.over)setTimeout(showEnd,500)}},
      onLeave(){cfg.mode='cpu';sync();newGame()},onDrop(){render()}});
    if(net&&net.join)cfg.mode='net';
    sync();newGame();addEventListener('resize',()=>{o.renderer.resize&&o.renderer.resize();render()});
    window.onAppBack=()=>{if(!$('overlay').hidden){$('overlay').hidden=true;return true}return false};
    return api}

  window.Pool={L,W,R,STEP,POCKETS,RAILS,HEAD,FOOT,COLORS,groupOf,rack,clone,step,simulate,strike,newEvents,judge,targets,think,canPlace,nearestFree,app};
})();
