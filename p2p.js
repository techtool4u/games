/*
 * Game Parlor peer-to-peer link.
 * Two devices talk directly over a WebRTC data channel: no game server sits in between.
 * To open the link the players swap two short codes once (the host's invite, then the guest's reply),
 * by QR code, copy and paste, or the share sheet. A public STUN server is asked for each device's
 * internet address so play also works across networks; it never sees any game data. On the same
 * Wi-Fi no outside server is needed at all.
 *
 * Usage:
 *   P2P.open({game:'Memory Match', onOpen(link){...}, onClose(){...}})
 *   link.role is 'host' or 'guest'; link.send(obj) sends JSON; set link.onmessage = obj => ...; link.close().
 * With quick:true the first screen offers one-code play: the host gets a 6-character game code and the friend
 * types it in (a free public PeerJS server pairs the devices; peerjs.min.js is loaded on demand). The two-code way
 * is still offered there. join:'CODE' skips straight to joining with that code. open() returns {close()}.
 * The page needs qrcode.js loaded first (for drawing codes). jsqr.js is loaded on demand for scanning.
 */
(function(){
  const ICE=[{urls:'stun:stun.l.google.com:19302'}];
  /* ---------- codes: a WebRTC offer or answer packed into a few dozen letters and digits ---------- */
  // Only what differs between devices is sent, packed as bytes and written in base58 (letters and digits with no
  // look-alikes such as 0/O or I/l). The rest of the session description is the same every time and is rebuilt.
  //   byte 0      version (high 3 bits), offer/answer, DTLS role (2 bits), "ICE login derived" flag
  //   [ufrag, pwd as length + ASCII, only when not derived]
  //   32 bytes    the DTLS certificate fingerprint (SHA-256): this is what keeps the link private
  //   candidates  1 byte kind (host / internet / relay) and address form (IPv4, IPv6, hidden .local name),
  //               then the address (4, 16 or 16 bytes) and a 2-byte port
  // The ICE username and password are normally made from the fingerprint on both sides (see derive), so they
  // don't need to be sent; if a browser won't accept them, its own ones are sent instead.
  const VER=2,ABC='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes){let n=0n;for(const x of bytes)n=n*256n+BigInt(x);let s='';while(n>0n){s=ABC[Number(n%58n)]+s;n/=58n}
    for(const x of bytes){if(x)break;s='1'+s}return s}
  function unb58(str){let n=0n;for(const ch of str){const v=ABC.indexOf(ch);if(v<0)throw new Error('bad');n=n*58n+BigInt(v)}
    const out=[];while(n>0n){out.unshift(Number(n%256n));n/=256n}for(const ch of str){if(ch!=='1')break;out.unshift(0)}return out}
  const ICECH='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const derive=fp=>{const t=i=>ICECH[fp[i]&63];return{ufrag:[0,1,2,3].map(t).join(''),pwd:[...Array(24)].map((_,i)=>t(4+i)).join('')}};
  const fpBytes=sdp=>{const m=sdp.match(/a=fingerprint:sha-256 ([0-9A-F:]+)/i);return m?m[1].split(':').map(h=>parseInt(h,16)):null};
  // Swap the browser's random ICE username and password for ones both sides can work out from the fingerprint.
  function munge(desc){const fp=fpBytes(desc.sdp);if(!fp)return desc;const d=derive(fp);
    return{type:desc.type,sdp:desc.sdp.replace(/a=ice-ufrag:.*/g,'a=ice-ufrag:'+d.ufrag).replace(/a=ice-pwd:.*/g,'a=ice-pwd:'+d.pwd)}}
  const KIND={host:0,srflx:1,relay:2},KN=['host','srflx','relay'];
  function packAddr(ip){
    let m=ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);if(m)return[0,m.slice(1).map(Number)];
    m=ip.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
    if(m){const h=m.slice(1).join('');return[2,[...Array(16)].map((_,i)=>parseInt(h.substr(i*2,2),16))]}
    if(ip.includes(':')){let[l,r]=ip.split('::');const L=l?l.split(':'):[],R=r!==undefined&&r?r.split(':'):[];
      const g=r===undefined?L:[...L,...Array(8-L.length-R.length).fill('0'),...R];if(g.length!==8)return null;
      return[1,g.flatMap(x=>{const v=parseInt(x||'0',16);return[v>>8,v&255]})]}
    return null}
  function unpackAddr(form,b){if(form===0)return b.join('.');
    const h=b.map(x=>x.toString(16).padStart(2,'0')).join('');
    if(form===2)return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}.local`;
    return h.match(/.{4}/g).map(x=>x.replace(/^0+(?=.)/,'')).join(':')}
  // Pick the few addresses worth sending: Wi-Fi (or the hidden .local name) and the internet address, skipping
  // IPv6 when IPv4 does the same job and link-local IPv6 always.
  function pickCands(sdp){const all=[];
    for(const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx|relay)/gi)){
      const p=packAddr(m[1]);if(!p||(p[0]===1&&/^fe80/i.test(m[1]))||all.some(c=>c.key===m[1]+' '+m[2]))continue;all.push({k:KIND[m[3].toLowerCase()],form:p[0],b:p[1],port:+m[2],key:m[1]+' '+m[2]})}
    const out=[];
    for(const k of[0,1,2]){const mine=all.filter(c=>c.k===k),v4=mine.filter(c=>c.form!==1),v6=mine.filter(c=>c.form===1);
      out.push(...(v4.length?v4:v6).slice(0,k===0?2:1))}
    return out}
  function compact(desc){const sdp=desc.sdp,get=k=>{const m=sdp.match(new RegExp('a='+k+':(.+)'));return m?m[1].trim():''};
    const fp=fpBytes(sdp),setup=get('setup'),cands=pickCands(sdp);
    if(!fp||fp.length!==32)throw new Error('this browser uses an unsupported security setting');
    if(!cands.length)throw new Error('no network route found');
    const d=derive(fp),derived=get('ice-ufrag')===d.ufrag&&get('ice-pwd')===d.pwd;
    const out=[VER<<5|(desc.type==='offer'?16:0)|({active:1,passive:2}[setup]||0)<<2|(derived?2:0)];
    if(!derived)for(const t of[get('ice-ufrag'),get('ice-pwd')])out.push(t.length,...[...t].map(c=>c.charCodeAt(0)));
    out.push(...fp);for(const c of cands)out.push(c.k<<2|c.form,...c.b,c.port>>8,c.port&255);
    return b58(out)}
  // Codes are shown in groups of four to make them easier to read; spaces and dashes are ignored when reading one.
  const pretty=code=>code.match(/.{1,4}/g).join(' ');
  function decode(code){const str=String(code).replace(/[\s-]+/g,'');
    if(/~/.test(str))throw new Error('That code is from an older version of Game Parlor. Update both devices and try again.');
    let b;try{b=unb58(str)}catch(e){throw new Error('That doesn\'t look like a Game Parlor code.')}
    if(!b.length||b[0]>>5!==VER)throw new Error('That doesn\'t look like a Game Parlor code.');
    let i=1;const h=b[0],r={type:h&16?'offer':'answer',setup:['actpass','active','passive'][h>>2&3]||'actpass'};
    const take=n=>{if(i+n>b.length)throw new Error('That code is incomplete. Copy all of it, or scan it again.');const x=b.slice(i,i+n);i+=n;return x};
    if(!(h&2)){const str2=()=>String.fromCharCode(...take(take(1)[0]));r.ufrag=str2();r.pwd=str2()}
    r.fp=take(32);if(h&2)Object.assign(r,derive(r.fp));
    r.cands=[];while(i<b.length){const t=take(1)[0],form=t&3;r.cands.push({k:t>>2&3,ip:unpackAddr(form,take(form===0?4:16)),port:(x=>x[0]<<8|x[1])(take(2))})}
    if(!r.cands.length)throw new Error('That code is incomplete. Copy all of it, or scan it again.');
    return r}
  function expand(code){const r=decode(code);
    const prio=[2130706431,1694498815,16777215];
    const cands=r.cands.map((c,i)=>`a=candidate:${i+1} 1 udp ${prio[c.k]-i} ${c.ip} ${c.port} typ ${KN[c.k]}${c.k?' raddr 0.0.0.0 rport 0':''}`);
    const fpHex=r.fp.map(x=>x.toString(16).padStart(2,'0').toUpperCase()).join(':');
    const sdp=['v=0','o=- 1 2 IN IP4 127.0.0.1','s=-','t=0 0','a=group:BUNDLE 0','a=msid-semantic: WMS','m=application 9 UDP/DTLS/SCTP webrtc-datachannel','c=IN IP4 0.0.0.0',
      ...cands,'a=end-of-candidates',`a=ice-ufrag:${r.ufrag}`,`a=ice-pwd:${r.pwd}`,`a=fingerprint:sha-256 ${fpHex}`,`a=setup:${r.setup}`,'a=mid:0','a=sctp-port:5000','a=max-message-size:262144',''].join('\r\n');
    return{type:r.type,sdp}}
  const isCode=t=>{try{decode(t);return true}catch(e){return false}};
  // Wait until the browser has found its network routes (or a few seconds, whichever comes first).
  const gathered=pc=>new Promise(res=>{if(pc.iceGatheringState==='complete')return res();const t=setTimeout(res,4000);
    pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);res()}})});

  /* ---------- the connection ---------- */
  function makeLink(role){const pc=new RTCPeerConnection({iceServers:ICE});
    // A pre-agreed channel (same id on both sides) needs no extra round trip to set up.
    const dc=pc.createDataChannel('game',{negotiated:true,id:0,ordered:true});
    const link={role,pc,dc,onmessage:null,onclose:null,open:false,
      send(obj){if(dc.readyState==='open')dc.send(JSON.stringify(obj))},
      close(){link.open=false;try{dc.close()}catch(e){}try{pc.close()}catch(e){}}};
    let closed=false;const lost=()=>{if(closed||!link.open)return;closed=true;link.open=false;if(link.onclose)link.onclose()};
    dc.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(err){return}if(m&&m.__ping)return;if(link.onmessage)link.onmessage(m)};
    dc.onclose=lost;pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))lost()};
    // A small heartbeat notices a partner who vanished without closing cleanly (phone locked, app killed).
    let last=Date.now();dc.addEventListener('message',()=>{last=Date.now()});
    const hb=setInterval(()=>{if(closed){clearInterval(hb);return}if(dc.readyState==='open'){dc.send('{"__ping":1}');if(Date.now()-last>20000)lost()}},4000);
    return link}
  const setLocal=async(pc,d)=>{try{await pc.setLocalDescription(munge(d))}catch(e){await pc.setLocalDescription(d)}};
  async function hostOffer(link){const o=await link.pc.createOffer();await setLocal(link.pc,o);await gathered(link.pc);return compact(link.pc.localDescription)}
  async function guestAnswer(link,code){await link.pc.setRemoteDescription(expand(code));const a=await link.pc.createAnswer();await setLocal(link.pc,a);await gathered(link.pc);return compact(link.pc.localDescription)}
  const opened=(link,ms)=>new Promise((res,rej)=>{if(link.dc.readyState==='open')return res();const t=setTimeout(()=>rej(new Error('timeout')),ms);link.dc.addEventListener('open',()=>{clearTimeout(t);res()})});

  // Chrome hides a device's Wi-Fi address behind a random "….local" name unless the page may use the camera or
  // microphone. Another browser on the same computer can look that name up, but a phone or a second computer
  // often can't, so two devices on the same Wi-Fi fail to find each other. Granting camera access once fixes it.
  const hostAddrs=sdp=>[...sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) \d+ typ host/gi)].map(m=>m[1]);
  async function addressHidden(){try{const pc=new RTCPeerConnection({iceServers:[]});pc.createDataChannel('probe');
      await pc.setLocalDescription(await pc.createOffer());await Promise.race([gathered(pc),new Promise(r=>setTimeout(r,1500))]);
      const hs=hostAddrs(pc.localDescription.sdp);pc.close();return hs.length>0&&hs.every(h=>/\.local$/i.test(h))}catch(e){return false}}
  async function unhide(){for(const c of[{video:true},{audio:true}]){try{const st=await navigator.mediaDevices.getUserMedia(c);st.getTracks().forEach(t=>t.stop());return true}catch(e){}}return false}
  // What a code tells about the routes to that device, in words.
  function routes(code){const r={wifi:false,hidden:false,net:false};let d;try{d=decode(code)}catch(e){return r}
    for(const c of d.cands){if(c.k===0){if(c.ip.endsWith('.local'))r.hidden=true;else r.wifi=true}else r.net=true}
    return r}
  const routeText=r=>`Wi-Fi address: ${r.wifi?'yes':r.hidden?'hidden':'none'} · internet address: ${r.net?'yes':'none'}`;

  /* ---------- the pairing dialog ---------- */
  const css=`.p2p-ov{position:fixed;inset:0;background:rgba(10,10,20,.6);display:grid;padding:14px;z-index:5000;overflow:auto}
.p2p{margin:auto;background:var(--panel,#fff);color:var(--fg,#1d1d22);border-radius:18px;padding:18px;width:100%;max-width:400px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;font-family:var(--body,system-ui,sans-serif);box-shadow:0 20px 40px rgba(0,0,0,.35)}
.p2p h2{margin:0;font-family:var(--display,inherit);font-size:26px;line-height:1.15}
.p2p p{margin:0;color:var(--muted,#666);font-size:14px;line-height:1.4}
.p2p .row{display:flex;gap:8px;flex-wrap:wrap}
.p2p .row>*{flex:1 1 auto}
.p2p button{font:inherit;font-weight:800;border-radius:999px;padding:10px 14px;min-height:44px;border:1px solid var(--line,#ddd);background:var(--chip,#f1f1f4);color:inherit;cursor:pointer}
.p2p button.pri{background:var(--accent,#2f6fd6);color:var(--accent-ink,#fff);border-color:var(--accent,#2f6fd6)}
.p2p button:disabled{opacity:.45;cursor:not-allowed}
.p2p textarea{font:12.5px/1.35 ui-monospace,Menlo,Consolas,monospace;width:100%;box-sizing:border-box;border-radius:10px;border:1px solid var(--line,#ccc);padding:8px;background:var(--bg,#fafafa);color:inherit;resize:none;word-break:break-all}
.p2p textarea[readonly]{font-size:16px;line-height:1.5;text-align:center;letter-spacing:.03em;word-break:normal;word-spacing:.25em}
.p2p .qr{display:grid;place-items:center;background:#fff;border-radius:12px;padding:10px}
.p2p .qr svg{width:min(240px,70vw);height:auto;display:block}
.p2p video{width:100%;border-radius:12px;background:#000;max-height:46vh;object-fit:cover}
.p2p .step{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#666)}
.p2p .err{color:#c62b2b;font-weight:700}
.p2p .ok{color:#1f8a4c;font-weight:700}
.p2p .bigcode{font:700 40px/1.1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-align:center;padding:14px 8px;border-radius:14px;background:var(--bg,#fafafa);border:2px dashed var(--line,#ccc);user-select:all;-webkit-user-select:all}
.p2p input.code{font:700 28px ui-monospace,Menlo,Consolas,monospace;text-align:center;letter-spacing:.2em;text-transform:uppercase;padding:10px;border-radius:12px;border:1px solid var(--line,#ccc);background:var(--bg,#fafafa);color:inherit;width:100%;box-sizing:border-box;min-height:56px}
.p2p details{font-size:13px;color:var(--muted,#666)}.p2p details summary{cursor:pointer;padding:6px 0;font-weight:700}.p2p details p{margin:4px 0 8px}
.p2p .wait::before{content:'';display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--accent,#2f6fd6);margin-right:8px;vertical-align:1px;animation:p2pb .8s ease-in-out infinite alternate}
@keyframes p2pb{to{opacity:.15}}
.p2p-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--panel,#fff);color:var(--fg,inherit);border:1px solid var(--line,#ddd);border-radius:14px;padding:8px 12px;font-size:14px;box-sizing:border-box}
.p2p-bar>i{width:10px;height:10px;border-radius:50%;background:#2bb36a;flex:none}
.p2p-bar.off>i{background:#c62b2b}
.p2p-bar>span{flex:1;min-width:0;font-weight:700}
.p2p-bar>button{font:inherit;font-weight:800;border-radius:999px;padding:5px 14px;min-height:36px;border:1px solid var(--line,#ddd);background:var(--chip,#f1f1f4);color:inherit;cursor:pointer}
.p2p-bar>button.pri{background:var(--accent,#2f6fd6);color:var(--accent-ink,#fff);border-color:var(--accent,#2f6fd6)}
.p2p-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--fg,#222);color:var(--bg,#fff);padding:10px 16px;border-radius:999px;font:700 14px var(--body,system-ui,sans-serif);z-index:4900;max-width:calc(100vw - 32px);box-sizing:border-box;text-align:center}
`;
  let styleAdded=false;
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function qrSVG(text){if(typeof qrcode!=='function')return'';const q=qrcode(0,'L');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true})}
  let jsqrLoading=null;
  const loadJsQR=()=>jsqrLoading||(jsqrLoading=new Promise((res,rej)=>{if(window.jsQR)return res();const s=document.createElement('script');s.src='jsqr.js';s.onload=res;s.onerror=()=>rej(new Error('scanner unavailable'));document.head.appendChild(s)}));

  /* ---------- one-code play ----------
   * The host gets a short game code and the friend just types it in. A free public matchmaking server (PeerJS)
   * introduces the two devices to each other using that code; after that the moves go straight between them.
   * If a direct connection isn't possible (some strict networks), PeerJS's free relay carries them instead.
   * The two-code way above still works without any server, and stays available from the first screen. */
  const QABC='ABCDEFGHJKMNPQRSTUVWXYZ23456789';// no look-alikes: no I, L, O, 0 or 1
  const newCode=()=>{const a=new Uint32Array(6);crypto.getRandomValues(a);return[...a].map(x=>QABC[x%QABC.length]).join('')};
  const cleanCode=v=>String(v||'').toUpperCase().replace(/[\s-]+/g,'');
  const goodCode=c=>c.length===6&&[...c].every(ch=>QABC.includes(ch));
  const peerId=(game,code)=>'gameparlor-'+String(game).toLowerCase().replace(/[^a-z0-9]+/g,'')+'-'+code.toLowerCase();
  const peerOpts=()=>Object.assign({debug:0},window.P2P_PEER_OPTIONS||{});
  let pjLoading=null;
  const loadPeerJS=()=>pjLoading||(pjLoading=new Promise((res,rej)=>{if(window.Peer)return res();const s=document.createElement('script');s.src='peerjs.min.js';s.onload=res;s.onerror=()=>{pjLoading=null;rej(new Error('peerjs.min.js is missing'))};document.head.appendChild(s)}));
  function peerLink(role,peer,conn){
    const link={role,peer,conn,via:'code',onmessage:null,onclose:null,open:false,
      send(obj){if(conn.open)conn.send(obj)},
      close(){link.open=false;try{conn.close()}catch(e){}try{peer.destroy()}catch(e){}}};
    let closed=false,last=Date.now();
    const lost=()=>{if(closed||!link.open)return;closed=true;link.open=false;try{peer.destroy()}catch(e){}if(link.onclose)link.onclose()};
    conn.on('data',m=>{last=Date.now();if(m&&m.__ping)return;if(link.onmessage)link.onmessage(m)});
    conn.on('close',lost);conn.on('error',lost);
    const hb=setInterval(()=>{if(closed){clearInterval(hb);return}if(conn.open){try{conn.send({__ping:1})}catch(e){}if(Date.now()-last>20000)lost()}},4000);
    return link}
  const peerErr=e=>({'browser-incompatible':'This browser can\'t make direct connections.','network':'Couldn\'t reach the game-code server. Check the internet connection.','server-error':'The game-code server isn\'t answering right now. Try again in a minute, or use the two-code way.','socket-error':'Lost touch with the game-code server. Check the internet connection.','socket-closed':'Lost touch with the game-code server. Check the internet connection.','webrtc':'The connection between the two devices failed.'})[e&&e.type]||('Something went wrong'+(e&&e.message?': '+e.message:'.'));
  function open(opts){
    if(!styleAdded){const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);styleAdded=true}
    if(!window.RTCPeerConnection){alert('This browser can\'t make direct connections (WebRTC is missing).');return}
    const ov=document.createElement('div');ov.className='p2p-ov';ov.innerHTML='<div class="p2p" role="dialog" aria-modal="true"></div>';document.body.appendChild(ov);
    const box=ov.firstChild;let link=null,stream=null,done=false,scanT=0,qpeer=null,qT=0;
    const stopScan=()=>{clearTimeout(scanT);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}};
    const cancel=()=>{stopScan();if(link&&!done)link.close();if(qpeer&&!done){try{qpeer.destroy()}catch(e){}}clearTimeout(qT);ov.remove();window.onAppBack=prevBack;if(!done&&opts.onCancel)opts.onCancel()};
    const prevBack=window.onAppBack;window.onAppBack=()=>{cancel();return true};
    const show=h=>{box.innerHTML=h;const c=box.querySelector('[data-cancel]');if(c)c.onclick=cancel};
    const codeBlock=(code,label)=>`<div class="qr" aria-label="${label} as a QR code">${qrSVG(code)}</div><textarea rows="3" readonly aria-label="${label}">${esc(pretty(code))}</textarea>
      <div class="row"><button data-copy>Copy</button>${navigator.share?'<button data-share>Share</button>':''}</div>`;
    const wireCode=(code)=>{const cp=box.querySelector('[data-copy]'),sh=box.querySelector('[data-share]'),ta=box.querySelector('textarea[readonly]');
      ta.onclick=()=>ta.select();
      cp.onclick=async()=>{try{await navigator.clipboard.writeText(pretty(code));cp.textContent='Copied!'}catch(e){ta.select();document.execCommand('copy');cp.textContent='Copied!'}setTimeout(()=>cp.textContent='Copy',1500)};
      if(sh)sh.onclick=()=>navigator.share({text:pretty(code),title:`${opts.game} code`}).catch(()=>{})};
    // Read a code from the camera: the built-in detector when there is one, otherwise the bundled scanner.
    async function scanInto(ta,after){const wrap=box.querySelector('[data-scanner]');
      try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})}catch(e){wrap.innerHTML='<p class="err">The camera isn\'t available. Paste the code instead.</p>';return}
      wrap.innerHTML='<video playsinline muted></video><p>Point the camera at the code on the other device.</p>';const v=wrap.querySelector('video');v.srcObject=stream;await v.play().catch(()=>{});
      let det=null;if('BarcodeDetector' in window){try{det=new BarcodeDetector({formats:['qr_code']})}catch(e){det=null}}
      if(!det){try{await loadJsQR()}catch(e){wrap.innerHTML='<p class="err">The scanner couldn\'t load. Paste the code instead.</p>';stopScan();return}}
      const cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
      const tick=async()=>{if(!stream)return;let txt=null;
        try{if(det){const r=await det.detect(v);if(r[0])txt=r[0].rawValue}
          else if(v.videoWidth){const w=Math.min(640,v.videoWidth),h=Math.round(w*v.videoHeight/v.videoWidth);cv.width=w;cv.height=h;cx.drawImage(v,0,0,w,h);const r=jsQR(cx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'});if(r)txt=r.data}}catch(e){}
        if(txt&&isCode(txt)){stopScan();wrap.innerHTML='';ta.value=txt;after();return}scanT=setTimeout(tick,180)};tick()}
    const pasteBlock=(label,goText)=>`<textarea rows="3" data-in placeholder="Paste the ${label.toLowerCase()} here" aria-label="${label}"></textarea><div data-scanner></div>
      <div class="row">${navigator.mediaDevices&&navigator.mediaDevices.getUserMedia?'<button data-scan>Scan QR code</button>':''}<button class="pri" data-go>${goText}</button></div><p data-msg></p>`;
    const connected=()=>{done=true;stopScan();ov.remove();window.onAppBack=prevBack;link.open=true;opts.onOpen(link)};
    const fail=(msg)=>{const m=box.querySelector('[data-msg]');if(m){m.className='err';m.textContent=msg}};

    // Before making a code, make sure this device's Wi-Fi address can go in it (see addressHidden).
    async function prep(then){show(`<h2>Getting ready</h2><p>Checking this device's network…</p><div class="row"><button data-cancel>Cancel</button></div>`);
      if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)||!(await addressHidden())){then();return}
      show(`<h2>Let the other device find this one</h2><p>This browser keeps its Wi-Fi address private unless the page is allowed to use the camera, and without it a phone on the same Wi-Fi usually can't connect.</p>
        <p>Tap Allow, then allow camera access when the browser asks. The camera switches on for a moment and nothing is recorded. The browser remembers it, so this is a one-time step.</p>
        <div class="row"><button class="pri" data-allow>Allow</button><button data-skip>Skip</button></div><p data-msg></p><div class="row"><button data-cancel>Cancel</button></div>`);
      box.querySelector('[data-skip]').onclick=then;
      box.querySelector('[data-allow]').onclick=async()=>{const b=box.querySelector('[data-allow]');b.disabled=true;
        const ok=await unhide();if(ok&&!(await addressHidden())){then();return}
        b.disabled=false;fail(ok?'The address is still hidden in this browser. Tap Skip to try anyway; connecting over the internet may still work.':'Camera access wasn\'t allowed. You can allow it in the browser\'s site settings, or tap Skip to try anyway.')}}
    const failHelp=(mine,theirs)=>{const a=routes(mine),b=routes(theirs);let tip='';
      if(a.hidden&&!a.wifi||b.hidden&&!b.wifi)tip=' A Wi-Fi address is hidden: on that device start again and tap Allow when asked about the camera.';
      else if(!a.wifi||!b.wifi)tip=' One device has no Wi-Fi address in its code: check it is on Wi-Fi, not mobile data.';
      else tip=' Both devices shared their Wi-Fi address, so the network may be blocking devices from talking to each other (common on guest, hotel and office Wi-Fi), or a firewall on the computer is blocking the browser.';
      return `Couldn't connect.${tip} (This device: ${routeText(a)}. Other device: ${routeText(b)}.)`};

    function start(){show(`<h2>Play ${esc(opts.game)} online</h2><p>Connect two devices directly: no account and no game server. It works best when both are on the same Wi-Fi, and usually works over mobile data too.</p>
      <div class="row"><button class="pri" data-host>Host a game</button><button data-join>Join a game</button></div><div class="row"><button data-cancel>Cancel</button></div>`);
      box.querySelector('[data-host]').onclick=()=>prep(asHost);box.querySelector('[data-join]').onclick=()=>prep(asGuest);box.querySelector('[data-host]').focus()}
    async function asHost(){show(`<h2>Hosting</h2><p>Making your invite code…</p><div class="row"><button data-cancel>Cancel</button></div>`);
      link=makeLink('host');let code;try{code=await hostOffer(link)}catch(e){show(`<h2>Can't host</h2><p class="err">${esc(e.message)}</p><div class="row"><button data-cancel>Close</button></div>`);return}
      show(`<span class="step">Step 1 of 2</span><h2>Send this invite</h2><p>On your friend's device, open ${esc(opts.game)}, choose Online, then Join, and scan or paste this code.</p>${codeBlock(code,'Invite code')}<p style="font-size:12px">${routeText(routes(code))}</p>
        <span class="step">Step 2 of 2</span><p>Now scan or paste the reply code from your friend's screen.</p>${pasteBlock('Reply code','Connect')}<div class="row"><button data-cancel>Cancel</button></div>`);
      wireCode(code);const ta=box.querySelector('[data-in]');
      const go=async()=>{const v=ta.value.trim();if(!v){fail('First send the invite above to your friend. Their device then shows a reply code: scan it or paste it here, then tap Connect.');ta.focus();return}let d;try{d=expand(v);if(d.type!=='answer')throw new Error('That\'s an invite code. Paste the reply from the other device.')}catch(e){fail(e.message);return}
        const m=box.querySelector('[data-msg]');m.className='';m.textContent='Connecting…';
        try{await link.pc.setRemoteDescription(d);await opened(link,20000);connected()}catch(e){fail(e.message==='timeout'?failHelp(code,v):e.message)}};
      box.querySelector('[data-go]').onclick=go;const sc=box.querySelector('[data-scan]');if(sc)sc.onclick=()=>{sc.disabled=true;scanInto(ta,go)}}
    async function asGuest(){show(`<span class="step">Step 1 of 2</span><h2>Join a game</h2><p>Scan or paste the invite code shown on the host's screen.</p>${pasteBlock('Invite code','Next')}<div class="row"><button data-cancel>Cancel</button></div>`);
      const ta=box.querySelector('[data-in]');
      const go=async()=>{const v=ta.value.trim();if(!v){fail('Scan the QR code on the host\'s screen, or paste their invite code here first.');ta.focus();return}let d;try{d=expand(v);if(d.type!=='offer')throw new Error('That\'s a reply code. Paste the invite from the host.')}catch(e){fail(e.message);return}
        box.querySelector('[data-go]').disabled=true;const m=box.querySelector('[data-msg]');m.className='';m.textContent='Making your reply…';
        link=makeLink('guest');let code;try{code=await guestAnswer(link,v)}catch(e){fail('That code didn\'t work: '+e.message);box.querySelector('[data-go]').disabled=false;return}
        show(`<span class="step">Step 2 of 2</span><h2>Send this reply</h2><p>Show this to the host to scan, or copy it and send it to them.</p>${codeBlock(code,'Reply code')}<p style="font-size:12px">${routeText(routes(code))}</p><p data-msg>Waiting for the host to connect…</p><div class="row"><button data-cancel>Cancel</button></div>`);
        wireCode(code);
        // the guest can tell early that the connection attempt failed, instead of waiting for the timeout
        link.pc.addEventListener('iceconnectionstatechange',()=>{if(link.pc.iceConnectionState==='failed')fail(failHelp(code,v))});
        try{await opened(link,10*60*1000);connected()}catch(e){fail('The host didn\'t connect in time. Start again with a new invite.')}};
      box.querySelector('[data-go]').onclick=go;const sc=box.querySelector('[data-scan]');if(sc)sc.onclick=()=>{sc.disabled=true;scanInto(ta,go)};ta.focus()}

    function quickStart(){show(`<h2>Play ${esc(opts.game)} online</h2><p>Host a game to get a game code and send it to your friend. They tap <b>Join a game</b>, type the code, and you're playing.</p>
      <div class="row"><button class="pri" data-host>Host a game</button><button data-join>Join a game</button></div>
      <details><summary>Other way: swap two codes</summary><p>Connect the two devices by swapping an invite and a reply code, with no game-code server involved. Best on the same Wi-Fi.</p><div class="row"><button data-direct>Use two codes</button></div></details>
      <div class="row"><button data-cancel>Cancel</button></div>`);
      box.querySelector('[data-host]').onclick=quickHost;box.querySelector('[data-join]').onclick=()=>quickGuest('');box.querySelector('[data-direct]').onclick=start;box.querySelector('[data-host]').focus()}
    const quickFail=(title,msg)=>{if(qpeer){try{qpeer.destroy()}catch(e){}qpeer=null}clearTimeout(qT);
      show(`<h2>${esc(title)}</h2><p class="err">${esc(msg)}</p><div class="row"><button class="pri" data-again>Try again</button><button data-direct>Use two codes</button></div><div class="row"><button data-cancel>Cancel</button></div>`);
      box.querySelector('[data-again]').onclick=quickStart;box.querySelector('[data-direct]').onclick=start};
    async function quickHost(){show(`<h2>Hosting</h2><p class="wait">Getting a game code…</p><div class="row"><button data-cancel>Cancel</button></div>`);
      try{await loadPeerJS()}catch(e){quickFail('Can\'t host',e.message);return}
      let tries=0,paired=false;
      const attempt=()=>{const code=newCode(),peer=new Peer(peerId(opts.game,code),peerOpts());qpeer=peer;
        clearTimeout(qT);qT=setTimeout(()=>{if(!peer.open)quickFail('Can\'t host','Couldn\'t reach the game-code server. Check the internet connection, or use the two-code way.')},15000);
        peer.on('open',()=>{clearTimeout(qT);if(done||qpeer!==peer)return;
          const pretty=code.slice(0,3)+' '+code.slice(3),url=/^https?:$/.test(location.protocol)&&!/^(localhost|127\.|10\.|192\.168\.|\[?::1)/.test(location.hostname)?location.href.split('#')[0]+'#join='+code:'';
          show(`<span class="step">Your game code</span><div class="bigcode" aria-label="Game code ${[...code].join(' ')}">${pretty}</div>
            <p>Send this code to your friend. On their device they open ${esc(opts.game)}, choose <b>Online</b>, tap <b>Join a game</b> and type it in.</p>
            <div class="row"><button data-copy>Copy code</button>${navigator.share?'<button data-share>Share</button>':''}</div>
            <p class="wait" data-msg>Waiting for your friend to join…</p><div class="row"><button data-cancel>Cancel</button></div>`);
          const cp=box.querySelector('[data-copy]'),sh=box.querySelector('[data-share]'),text=`Join my ${opts.game} game in Game Parlor. Code: ${code}`+(url?`\n${url}`:'');
          cp.onclick=async()=>{try{await navigator.clipboard.writeText(code)}catch(e){const r=document.createRange();r.selectNodeContents(box.querySelector('.bigcode'));getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand('copy')}cp.textContent='Copied!';setTimeout(()=>cp.textContent='Copy code',1500)};
          if(sh)sh.onclick=()=>navigator.share({title:`${opts.game} game code`,text}).catch(()=>{})});
        peer.on('connection',c=>{if(paired||done){c.close();return}paired=true;const m=box.querySelector('[data-msg]');if(m)m.textContent='Your friend is joining…';
          const t=setTimeout(()=>{if(!done){paired=false;try{c.close()}catch(e){}if(m)m.textContent='A friend tried to join but the connection failed. Waiting for them to try again…'}},20000);
          c.on('open',()=>{clearTimeout(t);if(done)return;link=peerLink('host',peer,c);connected()})});
        peer.on('disconnected',()=>{if(!done&&!peer.destroyed)try{peer.reconnect()}catch(e){}});
        peer.on('error',e=>{if(done)return;if(e.type==='unavailable-id'&&tries++<4){peer.destroy();attempt();return}if(e.type==='peer-unavailable')return;quickFail('Can\'t host',peerErr(e))})};
      attempt()}
    async function quickGuest(pre){show(`<h2>Join a game</h2><p>Type the game code from your friend's screen.</p>
      <input class="code" data-code maxlength="8" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" placeholder="ABC 234" aria-label="Game code" value="${esc(pre)}">
      <div class="row"><button class="pri" data-go>Join</button></div><p data-msg></p><div class="row"><button data-cancel>Cancel</button></div>`);
      const inp=box.querySelector('[data-code]'),btn=box.querySelector('[data-go]'),msg=box.querySelector('[data-msg]');
      const say=(t,cls)=>{msg.className=cls||'';msg.textContent=t};
      const reset=t=>{if(qpeer){try{qpeer.destroy()}catch(e){}qpeer=null}clearTimeout(qT);btn.disabled=false;inp.disabled=false;say(t,'err')};
      const go=async()=>{const code=cleanCode(inp.value);if(!goodCode(code)){say('A game code is 6 letters and numbers, like ABC 234.','err');inp.focus();return}
        btn.disabled=true;inp.disabled=true;say('Connecting…','wait');
        try{await loadPeerJS()}catch(e){reset(e.message);return}
        const peer=new Peer(peerOpts());qpeer=peer;
        qT=setTimeout(()=>{if(!done)reset(peer.open?'Couldn\'t connect to your friend\'s device. Check the code and try again; if it keeps failing, try the two-code way.':'Couldn\'t reach the game-code server. Check the internet connection.')},20000);
        peer.on('open',()=>{if(done||qpeer!==peer)return;const c=peer.connect(peerId(opts.game,code),{serialization:'json',reliable:true});
          c.on('open',()=>{clearTimeout(qT);if(done)return;link=peerLink('guest',peer,c);connected()})});
        peer.on('error',e=>{if(done||qpeer!==peer)return;reset(e.type==='peer-unavailable'?'No game is waiting with that code. Check the code, and that your friend\'s screen still shows it.':peerErr(e))})};
      btn.onclick=go;inp.onkeydown=e=>{if(e.key==='Enter')go()};inp.oninput=()=>{const p=inp.selectionStart;inp.value=inp.value.toUpperCase();try{inp.setSelectionRange(p,p)}catch(e){}};
      if(pre&&goodCode(cleanCode(pre)))go();else inp.focus()}
    if(opts.quick&&window.Promise){opts.join!=null?quickGuest(String(opts.join)):quickStart()}else start();
    // lets the page close this window itself (for example when the player picks another way to connect)
    return{close(){opts.onCancel=null;cancel()}}}

  /* ---------- shared online plumbing for a game page ----------
   * const net=P2P.net({game:'Checkers', bar:el, conn:selectEl, active:()=>cfg.mode==='net',
   *   onOpen(role){...}, onMessage(m){...}, onLeave(){...switch back to an offline mode...}, onDrop(){...}})
   * net.online(), net.role, net.send(obj), net.start() opens pairing, net.render() refreshes the bar and menu,
   * net.join holds a code from a chess.html#join=CODE style link (the page should switch to online play when set),
   * net.note(text) shows a short message. The connection choice (game code or two codes) is shared by every game. */
  const PREF='parlor-p2p-conn';
  const connPref=()=>{try{return localStorage.getItem(PREF)==='direct'?'direct':'code'}catch(e){return'code'}};
  const setConnPref=v=>{try{localStorage.setItem(PREF,v==='direct'?'direct':'code')}catch(e){}};
  function takeJoin(){const m=location.hash.match(/join=([A-Za-z0-9 -]{6,9})/);if(!m)return null;try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}return m[1]}
  function addStyle(){if(!styleAdded){const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);styleAdded=true}}
  let toastEl=null,toastT=0;
  function note(t,ms=3200){addStyle();if(!toastEl){toastEl=document.createElement('div');toastEl.className='p2p-toast';toastEl.setAttribute('role','status');document.body.appendChild(toastEl)}
    toastEl.textContent=t;toastEl.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>toastEl.hidden=true,ms)}
  function net(o){addStyle();
    const N={link:null,role:null,ui:null,join:takeJoin(),note,
      online(){return!!(N.link&&N.link.open)},
      send(m){if(N.online())N.link.send(m)},
      start(){if(N.ui||N.online())return;if(!window.RTCPeerConnection){note('This browser can\'t play online.');if(o.onLeave)o.onLeave();return}
        const join=N.join;N.join=null;
        N.ui=open({game:o.game,quick:connPref()!=='direct',join,
          onOpen(link){N.ui=null;N.link=link;N.role=link.role;
            link.onmessage=m=>{if(!m)return;if(m.t==='__bye'){note('Your friend left the game.');drop();return}o.onMessage(m)};
            link.onclose=()=>{note('Your friend disconnected. Tap Connect to carry on.',4000);drop()};
            N.render();o.onOpen(link.role)},
          onCancel(){N.ui=null;if(!N.online()&&o.onLeave)o.onLeave()}})},
      leave(){if(N.link){N.link.send({t:'__bye'});N.link.close()}N.link=null;N.render()},
      render(){const on=o.active(),live=N.online();
        if(o.conn)o.conn.hidden=!on||live;
        if(!o.bar)return;o.bar.hidden=!on;if(!on)return;o.bar.className='p2p-bar'+(live?'':' off');
        o.bar.innerHTML=`<i></i><span>${live?(N.role==='host'?'Connected · you are hosting':'Connected to the host'):'Not connected'}</span>`+(live?'<button data-leave>Leave</button>':'<button class="pri" data-connect>Connect</button>');
        const l=o.bar.querySelector('[data-leave]'),c=o.bar.querySelector('[data-connect]');
        if(l)l.onclick=()=>{N.leave();if(o.onLeave)o.onLeave()};if(c)c.onclick=()=>N.start()}};
    const drop=()=>{if(N.link)N.link.close();N.link=null;N.render();if(o.onDrop)o.onDrop()};
    if(o.conn){o.conn.innerHTML='<option value="code">Connect with a game code</option><option value="direct">Connect with two codes</option>';o.conn.value=connPref();o.conn.setAttribute('aria-label','How to connect');
      o.conn.onchange=()=>{setConnPref(o.conn.value);if(o.active()&&!N.online()){if(N.ui){N.ui.close();N.ui=null}N.start()}}}
    return N}
  window.P2P={net,connPref,setConnPref,takeJoin,note,open,_compact:compact,_expand:expand};
})();
