/*
 * Game Parlor carrom: the board, the physics, the rules, the computer player and the game flow, shared by
 * carrom.html (top-down 2D) and carrom-3d.html (three.js). A page supplies only a renderer and its input;
 * this file owns everything else, including online play through P2P.net (p2p.js).
 *
 * Units: the playing surface is 100 x 100 (x to the right, y down). Player 1 (white) sits at the bottom,
 * player 2 (black) at the top. Coins have radius 2.15 and the striker 2.8, matching a regulation board.
 * The physics runs in fixed steps of 1/960 s using only + - * / and sqrt, so two devices given the same
 * shot compute exactly the same result.
 */
(function(){
  const B=100,CR=2.15,SR=2.8,CM=1,SM=2.6,STEP=1/960,MAXV=340;
  const MU=55,DRAG=0.9,E_PIECE=0.9,E_WALL=0.72,STOP=0.5;
  const POCKETS=[{x:4.3,y:4.3},{x:B-4.3,y:4.3},{x:4.3,y:B-4.3},{x:B-4.3,y:B-4.3}],PR=3.0,HOLE=3.25;
  // each player's baseline: the striker sits on it between the two end circles
  const BASE={y:[B-13.5,13.5],x0:21,x1:B-21};
  const COLOR=['w','b'];

  /* ---------- board state ---------- */
  // pieces[0] is the striker; then the queen, 9 white and 9 black coins in the classic hexagonal pattern
  function setup(){const P=[{k:'s',r:SR,m:SM,x:B/2,y:BASE.y[0],vx:0,vy:0,on:true},{k:'q',r:CR,m:CM,x:B/2,y:B/2,vx:0,vy:0,on:true}];
    const d=2*CR+0.03,ring=[];for(let i=0;i<6;i++){const a=i*Math.PI/3+Math.PI/6;ring.push([Math.cos(a)*d,Math.sin(a)*d])}
    for(let i=0;i<6;i++){const a=i*Math.PI/3+Math.PI/6;ring.push([Math.cos(a)*2*d,Math.sin(a)*2*d]);const b=a+Math.PI/6;ring.push([Math.cos(b)*d*Math.sqrt(3),Math.sin(b)*d*Math.sqrt(3)])}
    // colors: inner ring alternates; the outer ring alternates in pairs, which gives 9 and 9
    const col=['w','b','w','b','w','b', 'b','w','w','b','b','w','w','b','b','w','w','b'];
    ring.forEach(([x,y],i)=>P.push({k:col[i],r:CR,m:CM,x:B/2+x,y:B/2+y,vx:0,vy:0,on:true}));
    P.forEach((p,i)=>p.id=i);return P}
  const clone=P=>P.map(p=>({id:p.id,k:p.k,r:p.r,m:p.m,x:p.x,y:p.y,vx:p.vx,vy:p.vy,on:p.on}));

  /* ---------- physics ---------- */
  function step(P,ev){const h=STEP;let moving=false;
    for(const p of P){if(!p.on)continue;const s2=p.vx*p.vx+p.vy*p.vy;if(!s2)continue;const s=Math.sqrt(s2),ns=s-(MU+DRAG*s)*h;
      if(ns<STOP){p.vx=p.vy=0;continue}const k=ns/s;p.vx*=k;p.vy*=k;p.x+=p.vx*h;p.y+=p.vy*h;moving=true}
    for(let i=0;i<P.length;i++){const a=P[i];if(!a.on)continue;
      for(let j=i+1;j<P.length;j++){const b=P[j];if(!b.on)continue;const rr=a.r+b.r,dx=b.x-a.x,dy=b.y-a.y;if(dx>rr||dx<-rr||dy>rr||dy<-rr)continue;
        const d2=dx*dx+dy*dy;if(d2>=rr*rr||d2===0)continue;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,ov=rr-d,ia=1/a.m,ib=1/b.m;
        a.x-=nx*ov*ia/(ia+ib);a.y-=ny*ov*ia/(ia+ib);b.x+=nx*ov*ib/(ia+ib);b.y+=ny*ov*ib/(ia+ib);
        const rel=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;if(rel<=0)continue;const jv=rel*(1+E_PIECE)/(ia+ib);
        a.vx-=jv*ia*nx;a.vy-=jv*ia*ny;b.vx+=jv*ib*nx;b.vy+=jv*ib*ny;
        if(ev){if(ev.first==null&&(a.id===0||b.id===0))ev.first=a.id===0?b.id:a.id;ev.clicks.push(Math.min(1,rel/200))}}}
    for(const p of P){if(!p.on)continue;
      // the frame
      if(p.x<p.r){p.x=p.r;if(p.vx<0){p.vx=-p.vx*E_WALL;if(ev)ev.thuds.push(Math.min(1,p.vx/200))}}
      if(p.x>B-p.r){p.x=B-p.r;if(p.vx>0){p.vx=-p.vx*E_WALL;if(ev)ev.thuds.push(Math.min(1,-p.vx/200))}}
      if(p.y<p.r){p.y=p.r;if(p.vy<0){p.vy=-p.vy*E_WALL;if(ev)ev.thuds.push(Math.min(1,p.vy/200))}}
      if(p.y>B-p.r){p.y=B-p.r;if(p.vy>0){p.vy=-p.vy*E_WALL;if(ev)ev.thuds.push(Math.min(1,-p.vy/200))}}
      // the pockets: a piece whose center passes over the hole drops in
      for(let k=0;k<4;k++){const q=POCKETS[k],dx=p.x-q.x,dy=p.y-q.y;if(dx*dx+dy*dy<PR*PR){p.on=false;p.vx=p.vy=0;p.pocket=k;if(ev)ev.pots.push({id:p.id,k:p.k,p:k});break}}}
    return moving}
  const newEvents=()=>({first:null,pots:[],clicks:[],thuds:[]});
  function strike(P,dx,dy,power){const s=P[0],d=Math.sqrt(dx*dx+dy*dy)||1,v=10+(MAXV-10)*Math.max(0,Math.min(1,power));s.vx=dx/d*v;s.vy=dy/d*v}
  function simulate(P,dx,dy,power){const b=clone(P),ev=newEvents();strike(b,dx,dy,power);for(let i=0;i<960*20;i++){if(!step(b,ev)&&i>2)break}return{pieces:b,ev}}
  // where the striker may sit: on the player's baseline, not on top of a coin
  const free=(P,x,y,r,skip)=>P.every(o=>!o.on||o.id===skip||(o.x-x)**2+(o.y-y)**2>=(o.r+r)**2*1.01);
  function placeStriker(P,p,x){const y=BASE.y[p];x=Math.max(BASE.x0,Math.min(BASE.x1,x));if(free(P,x,y,SR,0))return{x,y};
    for(let d=0.5;d<70;d+=0.5)for(const s of[-1,1]){const nx=x+s*d;if(nx>=BASE.x0&&nx<=BASE.x1&&free(P,nx,y,SR,0))return{x:nx,y}}return{x,y}}
  // a coin coming back goes on the center spot, or as close to it as there's room
  function respot(P,piece){for(let d=0;d<30;d+=0.5)for(let a=0;a<(d?24:1);a++){const x=B/2+Math.cos(a*Math.PI/12)*d,y=B/2+Math.sin(a*Math.PI/12)*d;
      if(free(P,x,y,piece.r,piece.id)){Object.assign(piece,{x,y,vx:0,vy:0,on:true});return}}}
  // the striker has to go forward, away from its own baseline
  const forward=(p,dx,dy)=>{const l=Math.sqrt(dx*dx+dy*dy)||1;return(p===0?-dy:dy)/l>0.02};

  /* ---------- rules ---------- */
  const left=(S,k)=>S.pieces.filter(c=>c.on&&c.k===k).length;
  function judge(S,ev){const p=S.turn,o=1-p,me=COLOR[p],them=COLOR[o];const pots=ev.pots;
    const strikerIn=pots.some(x=>x.k==='s'),mine=pots.filter(x=>x.k===me),queenIn=pots.some(x=>x.k==='q');
    const piece=id=>S.pieces[id];let msg='',keep=false,foul=false;const who=S.names[p],their=who==='You'?'your':'their';
    S.shots++;
    if(strikerIn){foul=true;
      // a foul: coins of your own that went in come back, plus one you'd already pocketed
      mine.forEach(x=>respot(S.pieces,piece(x.id)));
      const prev=S.pieces.find(c=>!c.on&&c.k===me&&!mine.some(m=>m.id===c.id));if(prev)respot(S.pieces,prev);
      if(queenIn)respot(S.pieces,S.pieces[1]);
      if(S.queenPending===p){respot(S.pieces,S.pieces[1]);S.queenPending=null}
      msg=`Foul! ${who} pocketed the striker`+(mine.length||prev?`, so one of ${their} coins comes back to the center`:'')+'.'}
    else{
      // the queen must be covered: pocket one of your own coins with her, or on the very next shot
      if(S.queenPending===p){if(mine.length){S.queenBy=p;msg=`${S.names[p]} covered the queen!`}else{respot(S.pieces,S.pieces[1]);msg='The queen wasn\'t covered and goes back to the center.'}S.queenPending=null}
      if(queenIn){if(mine.length){S.queenBy=p;msg=`${S.names[p]} pocketed and covered the queen!`}else{S.queenPending=p;msg=`${who} pocketed the queen: cover her with one of ${their} coins next shot.`;keep=true}}
      if(mine.length)keep=true}
    // pocketing your last coin before the queen is covered doesn't count: it comes back
    for(const [q,k] of [[p,me],[o,them]])if(!left(S,k)&&S.queenBy==null&&S.queenPending==null){const last=S.pieces.filter(c=>!c.on&&c.k===k).pop();if(last){respot(S.pieces,last);msg=(msg?msg+' ':'')+`The queen must be covered first, so a ${k==='w'?'white':'black'} coin comes back.`;if(q===p)keep=false}}
    for(const [q,k] of [[p,me],[o,them]])if(!left(S,k)&&S.queenBy!=null){const pts=left(S,COLOR[1-q])+(S.queenBy===q?3:0);
      S.over={winner:q,points:pts,why:`${S.names[q]} cleared every ${k==='w'?'white':'black'} coin${S.queenBy===q?' and won the queen':''}. ${pts} point${pts===1?'':'s'}.`};return{msg:S.over.why}}
    if(!keep||foul)S.turn=o;
    // the striker goes back to the baseline of whoever plays next
    const s=S.pieces[0];s.on=true;s.vx=s.vy=0;const sp=placeStriker(S.pieces,S.turn,B/2);s.x=sp.x;s.y=sp.y;
    return{msg,keep:S.turn===p,foul}}

  /* ---------- computer player ---------- */
  const LEVELS={easy:{noise:.05,sims:0,power:1.15,spots:9},medium:{noise:.014,sims:1,cands:5,spots:15,power:1},hard:{noise:.004,sims:1,cands:10,spots:25,power:1}};
  const clearPath=(P,ax,ay,bx,by,r,skip)=>{const sx=bx-ax,sy=by-ay,l2=sx*sx+sy*sy||1;return P.every(o=>{if(!o.on||skip.includes(o.id))return true;
    const t=Math.max(0,Math.min(1,((o.x-ax)*sx+(o.y-ay)*sy)/l2)),dx=o.x-ax-sx*t,dy=o.y-ay-sy*t;return dx*dx+dy*dy>=(o.r+r)**2*0.98})};
  function candidates(S,spots){const p=S.turn,me=COLOR[p],out=[];const queenOk=S.pieces[1].on&&S.pieces.some(c=>!c.on&&c.k===me);
    const targets=S.pieces.filter(c=>c.on&&(c.k===me||(c.k==='q'&&(queenOk||S.queenPending===p))));
    for(let i=0;i<spots;i++){const sx=BASE.x0+(BASE.x1-BASE.x0)*i/(spots-1),sp=placeStriker(S.pieces,p,sx);if(Math.abs(sp.x-sx)>3)continue;
      for(const c of targets)for(const q of POCKETS){const tx=q.x-c.x,ty=q.y-c.y,tl=Math.sqrt(tx*tx+ty*ty),ux=tx/tl,uy=ty/tl,gx=c.x-ux*(CR+SR),gy=c.y-uy*(CR+SR);
        const ax=gx-sp.x,ay=gy-sp.y,al=Math.sqrt(ax*ax+ay*ay);if(al<1||!forward(p,ax,ay))continue;const cut=(ax*ux+ay*uy)/al;if(cut<0.35)continue;
        if(!clearPath(S.pieces,sp.x,sp.y,gx,gy,SR,[0,c.id])||!clearPath(S.pieces,c.x,c.y,q.x,q.y,CR,[c.id,0]))continue;
        const dist=al+tl;out.push({x:sp.x,dx:ax,dy:ay,power:Math.min(1,0.18+dist/150/Math.max(.4,cut)),score:cut*cut*100-dist*.3+(c.k==='q'?25:0)})}
      // bank shots: bounce the striker off the far edge or a side to reach coins it can't hit straight (such as ones behind the baseline)
      for(const c of targets)for(const q of POCKETS){const tx=q.x-c.x,ty=q.y-c.y,tl=Math.sqrt(tx*tx+ty*ty),gx=c.x-tx/tl*(CR+SR),gy=c.y-ty/tl*(CR+SR);
        for(const [mx,my] of [[gx,p===0?2*SR-gy:2*(B-SR)-gy],[2*SR-gx,gy],[2*(B-SR)-gx,gy]]){const ax=mx-sp.x,ay=my-sp.y,al=Math.sqrt(ax*ax+ay*ay);if(!forward(p,ax,ay))continue;
          out.push({x:sp.x,dx:ax,dy:ay,power:Math.min(1,0.3+(al+tl)/170),score:-20-al*.2,bank:true})}}}
    out.sort((a,b)=>b.score-a.score);
    const direct=out.filter(c=>!c.bank),banks=out.filter(c=>c.bank);if(direct.length<3&&banks.length){out.length=0;out.push(...direct,...banks.filter((_,i)=>i%Math.max(1,Math.floor(banks.length/8))===0))}else{out.length=0;out.push(...direct)}
    if(!out.length){// nothing makes a clean cut: drive into the pack from the middle of the baseline
      const sp=placeStriker(S.pieces,p,B/2);out.push({x:sp.x,dx:B/2-sp.x+(Math.random()-.5)*6,dy:B/2-sp.y,power:.7,score:-50})}
    return out}
  function evalShot(S,c){const T=Object.assign({},S,{pieces:clone(S.pieces)});const sp=placeStriker(T.pieces,S.turn,c.x);T.pieces[0].x=sp.x;T.pieces[0].y=sp.y;
    const r=simulate(T.pieces,c.dx,c.dy,c.power);T.pieces=r.pieces;const before=left(S,COLOR[S.turn]),themBefore=left(S,COLOR[1-S.turn]);const res=judge(T,r.ev);
    if(T.over)return T.over.winner===S.turn?1e4:-1e4;let s=(before-left(T,COLOR[S.turn]))*120-(themBefore-left(T,COLOR[1-S.turn]))*60;if(res.foul)s-=250;if(T.queenBy===S.turn&&S.queenBy==null)s+=150;if(res.keep)s+=60;return s}
  function think(S,level,rand){rand=rand||Math.random;const L=LEVELS[level]||LEVELS.medium,p=S.turn;
    let list=S.shots===0?[{x:B/2,dx:(rand()-.5)*2,dy:(p===0?-1:1)*(BASE.y[0]-B/2),power:.95}]:candidates(S,L.spots);
    const wob=c=>{const a=Math.atan2(c.dy,c.dx)+(rand()-.5)*2*L.noise,l=Math.sqrt(c.dx*c.dx+c.dy*c.dy);let dx=Math.cos(a)*l,dy=Math.sin(a)*l;if(!forward(p,dx,dy)){dx=c.dx;dy=c.dy}
      return{x:c.x,dx,dy,power:Math.min(1,c.power*L.power*(1+(rand()-.5)*(L.sims?.05:.12)))}};
    let pick=wob(list[0]);
    if(L.sims&&S.shots>0){let best=-1e9;for(const c of list.slice(0,L.cands))for(const pm of [.85,1,1.2]){const cc=wob(Object.assign({},c,{power:Math.min(1,c.power*pm)}));const s=evalShot(S,cc);if(s>best){best=s;pick=cc}}}
    return pick}

  /* ---------- game flow (shared by both pages) ----------
   * Carrom.app({game, renderer:{draw(api), resize()}}) wires the controls by id: #mode #level #conn #netbar #newgame
   * #status #players #power #slide (striker position) #overlay #modal. The renderer calls api.aimAt(x,y),
   * api.nudge(rad), api.slideTo(x), api.setPower(p) and api.shoot(). */
  function app(o){const $=id=>document.getElementById(id);
    const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
    const KEY='parlor-carrom';const cfg=Object.assign({mode:'cpu',level:'medium'},store.get(KEY,{}));if(!['cpu','two'].includes(cfg.mode))cfg.mode='cpu';if(!LEVELS[cfg.level])cfg.level='medium';
    let S=null,net=null,games=0,anim=null,aim={dx:0,dy:-1},power=0,lastSend=0,cpuT=0,peerAim=null;const sfx=window.sfx||function(){};
    const online=()=>cfg.mode==='net'&&!!net&&net.online();
    const me=()=>cfg.mode==='net'?(net&&net.role==='guest'?1:0):cfg.mode==='cpu'?0:S.turn;
    const isCpu=p=>cfg.mode==='cpu'&&p===1;
    const myTurn=()=>S&&!S.over&&!anim&&!S.busy&&(cfg.mode==='two'||(cfg.mode==='cpu'?S.turn===0:online()&&S.turn===me()));
    // which player sits at the bottom of this screen: you; with 2 players on one device, whoever is about to shoot
    const bottom=()=>cfg.mode==='net'?(net&&net.role==='guest'?1:0):cfg.mode==='two'&&S?S.turn:0;
    function names(){return cfg.mode==='cpu'?['You','Computer']:cfg.mode==='two'?['Player 1','Player 2']:(net&&net.role==='guest'?['Friend','You']:['You','Friend'])}
    function newGame(from){
      if(cfg.mode==='net'&&!from&&online()&&net.role==='guest'){net.send({t:'again'});net.note('Asked the host for a new game.');return}
      $('overlay').hidden=true;clearTimeout(cpuT);anim=null;const first=from?from.turn:cfg.mode==='net'?(games++%2):0;
      S={pieces:setup(),turn:first,queenBy:null,queenPending:null,over:null,shots:0,msg:'',names:names(),gen:(S?S.gen:0)+1};
      const sp=placeStriker(S.pieces,S.turn,B/2);S.pieces[0].x=sp.x;S.pieces[0].y=sp.y;aimDefault();power=0;setPowerUI(0);render();
      if(cfg.mode==='net'){if(!online()&&!from)net.start();else if(net.role==='host'&&!from)net.send({t:'start',turn:S.turn})}
      maybeCpu()}
    function aimDefault(){aim={dx:0,dy:S.turn===0?-1:1}}
    const api={get S(){return S},get aim(){return aim},get power(){return power},get myTurn(){return myTurn()},get anim(){return anim},get peerAim(){return peerAim},get bottom(){return bottom()},
      B,CR,SR,POCKETS,HOLE,BASE,
      aimAt(x,y){if(!myTurn())return;const s=S.pieces[0],dx=x-s.x,dy=y-s.y;if(dx*dx+dy*dy<1||!forward(S.turn,dx,dy))return;aim={dx,dy};changed()},
      nudge(rad){if(!myTurn())return;const a=Math.atan2(aim.dy,aim.dx)+rad,dx=Math.cos(a),dy=Math.sin(a);if(!forward(S.turn,dx,dy))return;aim={dx,dy};changed()},
      slideTo(x){if(!myTurn())return;const s=S.pieces[0],sp=placeStriker(S.pieces,S.turn,x);s.x=sp.x;s.y=sp.y;changed()},
      setPower(v){power=Math.max(0,Math.min(1,v));setPowerUI(power);changed()},
      shoot(){if(!myTurn()||power<0.02)return false;const s=S.pieces[0],shot={x:s.x,dx:aim.dx,dy:aim.dy,power,n:S.shots};if(cfg.mode==='net')net.send(Object.assign({t:'shot'},shot));play(shot);return true},
      guide(){return guide()},render};
    function changed(){render();if(online()&&myTurn()){const t=Date.now();if(t-lastSend>90){lastSend=t;net.send({t:'aim',dx:aim.dx,dy:aim.dy,power,x:S.pieces[0].x})}}}
    // the aim line runs to the first coin or the frame; a short line shows where that coin would go
    function guide(){const s=S.pieces[0],d=Math.sqrt(aim.dx*aim.dx+aim.dy*aim.dy)||1,ux=aim.dx/d,uy=aim.dy/d;let best=1e9,hit=null;
      for(const c of S.pieces){if(!c.on||c.id===0)continue;const fx=c.x-s.x,fy=c.y-s.y,t=fx*ux+fy*uy;if(t<=0)continue;const rr=c.r+SR,perp2=fx*fx+fy*fy-t*t;if(perp2>rr*rr)continue;const tt=t-Math.sqrt(rr*rr-perp2);if(tt<best){best=tt;hit=c}}
      let wall=1e9;if(ux>0)wall=Math.min(wall,(B-SR-s.x)/ux);if(ux<0)wall=Math.min(wall,(SR-s.x)/ux);if(uy>0)wall=Math.min(wall,(B-SR-s.y)/uy);if(uy<0)wall=Math.min(wall,(SR-s.y)/uy);
      const t=Math.min(best,wall),gx=s.x+ux*t,gy=s.y+uy*t;let dir=null;if(hit&&best<=wall){const nx=hit.x-gx,ny=hit.y-gy,nl=Math.sqrt(nx*nx+ny*ny)||1;dir={x:nx/nl,y:ny/nl}}
      return{x:gx,y:gy,piece:hit&&best<=wall?hit:null,dir,ux,uy}}
    function play(shot){const s=S.pieces[0];s.x=shot.x;s.y=BASE.y[S.turn];peerAim=null;const ev=newEvents();strike(S.pieces,shot.dx,shot.dy,shot.power);sfx('clack',{big:shot.power>.6});
      anim={ev,steps:0,gen:S.gen,last:performance.now(),acc:0};power=0;setPowerUI(0);
      const tick=t=>{if(!anim||anim.gen!==S.gen)return;anim.acc+=Math.min(0.1,(t-anim.last)/1000);anim.last=t;let moving=true;
        while(anim.acc>=STEP&&moving){anim.acc-=STEP;moving=step(S.pieces,ev);anim.steps++;if(anim.steps>960*20)moving=false}
        sounds(ev);render();if(moving&&anim.steps<960*20)requestAnimationFrame(tick);else finish(ev)};
      requestAnimationFrame(t=>{anim.last=t;tick(t)})}
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&anim){const ev=anim.ev;while(step(S.pieces,ev)&&anim.steps++<960*20);finish(ev)}});
    function sounds(ev){for(const v of ev.clicks.splice(0))if(v>.04)sfx('clack',{big:v>.5});for(const v of ev.thuds.splice(0))if(v>.06)sfx('bounce');while((ev._h||0)<ev.pots.length){ev._h=(ev._h||0)+1;sfx('drop')}}
    function finish(ev){if(!anim)return;anim=null;const res=judge(S,ev);S.msg=res.msg||'';
      if(S.over){render();sfx(cfg.mode==='cpu'?(S.over.winner===0?'win':'lose'):cfg.mode==='net'?(S.over.winner===me()?'win':'lose'):'win');setTimeout(showEnd,700)}
      else{if(res.foul)sfx('bad');aimDefault();render()}
      if(online()&&net.role==='host')net.send({t:'state',S:pack()});maybeCpu()}
    function maybeCpu(){clearTimeout(cpuT);if(!S||S.over||!isCpu(S.turn))return;S.busy=true;render();const g=S.gen;
      cpuT=setTimeout(()=>{if(g!==S.gen)return;const plan=think(S,cfg.level);const s=S.pieces[0],sp=placeStriker(S.pieces,1,plan.x);s.x=sp.x;s.y=sp.y;aim={dx:plan.dx,dy:plan.dy};render();
        let k=0;const pull=setInterval(()=>{if(g!==S.gen){clearInterval(pull);return}k++;power=Math.min(plan.power,k/12*plan.power);setPowerUI(power);render();
          if(k>=12){clearInterval(pull);S.busy=false;play({x:s.x,dx:plan.dx,dy:plan.dy,power:plan.power,n:S.shots})}},55)},650)}
    function pack(){return{pieces:clone(S.pieces),turn:S.turn,queenBy:S.queenBy,queenPending:S.queenPending,over:S.over,shots:S.shots,msg:S.msg}}
    function showEnd(){if(!S.over)return;const w=S.over.winner;const t=cfg.mode==='cpu'?(w===0?'You win!':'Computer wins'):cfg.mode==='net'?(w===me()?'You win!':'Your friend wins'):`${S.names[w]} wins!`;
      $('modal').innerHTML=`<h2>${t}</h2><p>${S.over.why}</p><div class="row"><button class="btn" id="mview">View board</button><button class="btn primary" id="magain">Play again</button></div>`;
      $('overlay').hidden=false;$('mview').onclick=()=>{$('overlay').hidden=true};$('magain').onclick=()=>newGame();$('magain').focus()}
    function render(){if(!S)return;if(net)net.render();const nm=cfg.mode==='net',live=online();
      $('players').innerHTML=[0,1].map(p=>{const k=COLOR[p],got=9-left(S,k),dots=Array.from({length:9},(_,i)=>`<i class="cc ${k}${i<got?' got':''}"></i>`).join('');
        const q=S.queenBy===p?'<i class="cc q got" title="Queen"></i>':S.queenPending===p?'<i class="cc q pend" title="Queen, to cover"></i>':'';
        return`<div class="pl${!S.over&&S.turn===p?' cur':''}"><b>${S.names[p]}</b><small>${k==='w'?'White':'Black'} · ${got}/9${S.queenBy===p?' · queen':''}</small><span class="ccs">${dots}${q}</span></div>`}).join('');
      let st;if(S.over)st=S.over.why;else if(nm&&!live)st='Not connected. Tap Connect to play a friend.';else if(anim)st='Sliding…';else if(isCpu(S.turn))st='The computer is lining up a shot…';
      else if(myTurn())st=`${cfg.mode==='two'?S.names[S.turn]+': s':'S'}lide the striker along your line, aim, then pull back and let go.`;else st='Your friend is lining up a shot…';
      $('status').innerHTML=(S.msg&&!anim&&!S.over?`<b>${S.msg}</b> `:'')+st;
      $('level').hidden=cfg.mode!=='cpu';document.body.classList.toggle('my-turn',myTurn());
      const sl=$('slide');if(sl){const x=S.pieces[0].x,flip=bottom()===1;sl.value=String(Math.round(((flip?B-x:x)-BASE.x0)/(BASE.x1-BASE.x0)*1000))}
      o.renderer.draw(api)}
    function setPowerUI(p){const el=$('power');if(el)el.style.setProperty('--p',p)}
    function sync(){$('mode').value=cfg.mode;$('level').value=cfg.level}
    const started=()=>S&&S.shots>0&&!S.over;
    $('mode').onchange=e=>{if(started()&&!confirm('Start a new game?')){sync();return}cfg.mode=e.target.value;if(cfg.mode!=='net')store.set(KEY,cfg);games=0;newGame()};
    $('level').onchange=e=>{cfg.level=e.target.value;store.set(KEY,cfg);render()};
    $('newgame').onclick=()=>{if(started()&&!confirm('Start a new game?'))return;newGame()};
    // the striker slider reads left to right as this screen shows the board (turned around for the player at the top)
    const sl=$('slide');if(sl)sl.addEventListener('input',()=>{if(!myTurn())return;const f=+sl.value/1000,x=BASE.x0+(BASE.x1-BASE.x0)*f;api.slideTo(bottom()===1?B-x:x)});
    if(window.P2P&&P2P.net)net=P2P.net({game:o.game,bar:$('netbar'),conn:$('conn'),active:()=>cfg.mode==='net',
      onOpen(role){S.names=names();if(role==='host'){games=0;newGame();net.note('Connected! You strike first, with white.')}else{render();net.note('Connected! Waiting for the host…')}},
      onMessage(m){
        if(m.t==='shot'){if(anim||S.over||S.turn===me()||m.n!==S.shots){if(net.role==='host')net.send({t:'state',S:pack()});return}play(m);return}
        if(m.t==='aim'){if(!anim&&S.turn!==me()){peerAim=m;const s=S.pieces[0];s.x=m.x;aim={dx:m.dx,dy:m.dy};setPowerUI(m.power);render()}return}
        if(net.role==='host'){if(m.t==='again')newGame();return}
        if(m.t==='start'){newGame({turn:m.turn});net.note(m.turn===1?'New game: you strike first.':'New game: your friend strikes first.')}
        else if(m.t==='state'){if(anim)anim=null;Object.assign(S,m.S);S.names=names();aimDefault();render();if(S.over)setTimeout(showEnd,500)}},
      onLeave(){cfg.mode='cpu';sync();newGame()},onDrop(){render()}});
    if(net&&net.join)cfg.mode='net';
    sync();newGame();addEventListener('resize',()=>{o.renderer.resize&&o.renderer.resize();render()});
    window.onAppBack=()=>{if(!$('overlay').hidden){$('overlay').hidden=true;return true}return false};
    return api}

  window.Carrom={B,CR,SR,POCKETS,HOLE,BASE,COLOR,setup,clone,step,simulate,strike,judge,think,placeStriker,forward,app};
})();
