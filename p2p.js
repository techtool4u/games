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
 * The page needs qrcode.js loaded first (for drawing codes). jsqr.js is loaded on demand for scanning.
 */
(function(){
  const ICE=[{urls:'stun:stun.l.google.com:19302'}];
  const VERSION='GP1';

  /* ---------- codes: a WebRTC offer or answer squeezed into one short line ---------- */
  // Only the parts that differ between devices are kept: ICE username and password, the DTLS fingerprint,
  // and the network candidates. The rest of the session description is the same every time and is rebuilt.
  const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const unb64=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return[...atob(s)].map(c=>c.charCodeAt(0))};
  function compact(desc){const sdp=desc.sdp,get=k=>{const m=sdp.match(new RegExp('a='+k+':(.+)'));return m?m[1].trim():''};
    const fp=get('fingerprint').split(' ')[1]||'',setup=get('setup'),cands=[];
    for(const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx|relay)/gi))cands.push(`${m[3][0]},${m[1]},${m[2]}`);
    if(!cands.length)throw new Error('no network route found');
    return[VERSION,desc.type==='offer'?'o':'a',setup==='active'?'A':setup==='passive'?'P':'X',get('ice-ufrag'),get('ice-pwd'),b64(fp.split(':').map(h=>parseInt(h,16))),[...new Set(cands)].join(';')].join('~')}
  function expand(code){const parts=String(code).trim().replace(/\s+/g,'').split('~');
    if(parts.length!==7||parts[0]!==VERSION)throw new Error('That doesn\'t look like a Game Parlor code.');
    const[,t,su,ufrag,pwd,fp,cl]=parts,fpHex=unb64(fp).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(':');
    const prio={h:2130706431,s:1694498815,r:16777215},kind={h:'host',s:'srflx',r:'relay'};
    const cands=cl.split(';').filter(Boolean).map((c,i)=>{const[k,ip,port]=c.split(',');return `a=candidate:${i+1} 1 udp ${prio[k]-i} ${ip} ${port} typ ${kind[k]}${k==='h'?'':' raddr 0.0.0.0 rport 0'}`});
    const setup=su==='A'?'active':su==='P'?'passive':'actpass';
    const sdp=['v=0','o=- 1 2 IN IP4 127.0.0.1','s=-','t=0 0','a=group:BUNDLE 0','a=msid-semantic: WMS','m=application 9 UDP/DTLS/SCTP webrtc-datachannel','c=IN IP4 0.0.0.0',
      ...cands,'a=end-of-candidates',`a=ice-ufrag:${ufrag}`,`a=ice-pwd:${pwd}`,`a=fingerprint:sha-256 ${fpHex}`,`a=setup:${setup}`,'a=mid:0','a=sctp-port:5000','a=max-message-size:262144',''].join('\r\n');
    return{type:t==='o'?'offer':'answer',sdp}}
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
  async function hostOffer(link){const o=await link.pc.createOffer();await link.pc.setLocalDescription(o);await gathered(link.pc);return compact(link.pc.localDescription)}
  async function guestAnswer(link,code){await link.pc.setRemoteDescription(expand(code));const a=await link.pc.createAnswer();await link.pc.setLocalDescription(a);await gathered(link.pc);return compact(link.pc.localDescription)}
  const opened=(link,ms)=>new Promise((res,rej)=>{if(link.dc.readyState==='open')return res();const t=setTimeout(()=>rej(new Error('timeout')),ms);link.dc.addEventListener('open',()=>{clearTimeout(t);res()})});

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
.p2p .qr{display:grid;place-items:center;background:#fff;border-radius:12px;padding:10px}
.p2p .qr svg{width:min(240px,70vw);height:auto;display:block}
.p2p video{width:100%;border-radius:12px;background:#000;max-height:46vh;object-fit:cover}
.p2p .step{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#666)}
.p2p .err{color:#c62b2b;font-weight:700}
.p2p .ok{color:#1f8a4c;font-weight:700}`;
  let styleAdded=false;
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function qrSVG(text){if(typeof qrcode!=='function')return'';const q=qrcode(0,'L');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true})}
  let jsqrLoading=null;
  const loadJsQR=()=>jsqrLoading||(jsqrLoading=new Promise((res,rej)=>{if(window.jsQR)return res();const s=document.createElement('script');s.src='jsqr.js';s.onload=res;s.onerror=()=>rej(new Error('scanner unavailable'));document.head.appendChild(s)}));

  function open(opts){
    if(!styleAdded){const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);styleAdded=true}
    if(!window.RTCPeerConnection){alert('This browser can\'t make direct connections (WebRTC is missing).');return}
    const ov=document.createElement('div');ov.className='p2p-ov';ov.innerHTML='<div class="p2p" role="dialog" aria-modal="true"></div>';document.body.appendChild(ov);
    const box=ov.firstChild;let link=null,stream=null,done=false,scanT=0;
    const stopScan=()=>{clearTimeout(scanT);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}};
    const cancel=()=>{stopScan();if(link&&!done)link.close();ov.remove();window.onAppBack=prevBack;if(!done&&opts.onCancel)opts.onCancel()};
    const prevBack=window.onAppBack;window.onAppBack=()=>{cancel();return true};
    const show=h=>{box.innerHTML=h;const c=box.querySelector('[data-cancel]');if(c)c.onclick=cancel};
    const codeBlock=(code,label)=>`<div class="qr" aria-label="${label} as a QR code">${qrSVG(code)}</div><textarea rows="3" readonly aria-label="${label}">${esc(code)}</textarea>
      <div class="row"><button data-copy>Copy</button>${navigator.share?'<button data-share>Share</button>':''}</div>`;
    const wireCode=(code)=>{const cp=box.querySelector('[data-copy]'),sh=box.querySelector('[data-share]'),ta=box.querySelector('textarea[readonly]');
      ta.onclick=()=>ta.select();
      cp.onclick=async()=>{try{await navigator.clipboard.writeText(code);cp.textContent='Copied!'}catch(e){ta.select();document.execCommand('copy');cp.textContent='Copied!'}setTimeout(()=>cp.textContent='Copy',1500)};
      if(sh)sh.onclick=()=>navigator.share({text:code,title:`${opts.game} code`}).catch(()=>{})};
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
        if(txt&&txt.startsWith(VERSION)){stopScan();wrap.innerHTML='';ta.value=txt;after();return}scanT=setTimeout(tick,180)};tick()}
    const pasteBlock=(label)=>`<textarea rows="3" data-in placeholder="Paste the code here" aria-label="${label}"></textarea><div data-scanner></div>
      <div class="row">${navigator.mediaDevices&&navigator.mediaDevices.getUserMedia?'<button data-scan>Scan QR code</button>':''}<button class="pri" data-go>Connect</button></div><p data-msg></p>`;
    const connected=()=>{done=true;stopScan();ov.remove();window.onAppBack=prevBack;link.open=true;opts.onOpen(link)};
    const fail=(msg)=>{const m=box.querySelector('[data-msg]');if(m){m.className='err';m.textContent=msg}};

    function start(){show(`<h2>Play ${esc(opts.game)} online</h2><p>Connect two devices directly: no account and no game server. It works best when both are on the same Wi-Fi, and usually works over mobile data too.</p>
      <div class="row"><button class="pri" data-host>Host a game</button><button data-join>Join a game</button></div><div class="row"><button data-cancel>Cancel</button></div>`);
      box.querySelector('[data-host]').onclick=asHost;box.querySelector('[data-join]').onclick=asGuest;box.querySelector('[data-host]').focus()}
    async function asHost(){show(`<h2>Hosting</h2><p>Making your invite code…</p><div class="row"><button data-cancel>Cancel</button></div>`);
      link=makeLink('host');let code;try{code=await hostOffer(link)}catch(e){show(`<h2>Can't host</h2><p class="err">${esc(e.message)}</p><div class="row"><button data-cancel>Close</button></div>`);return}
      show(`<span class="step">Step 1 of 2</span><h2>Send this invite</h2><p>On your friend's device, open ${esc(opts.game)}, choose Online, then Join, and scan or paste this code.</p>${codeBlock(code,'Invite code')}
        <span class="step">Step 2 of 2</span><p>Now scan or paste the reply code from your friend's screen.</p>${pasteBlock('Reply code')}<div class="row"><button data-cancel>Cancel</button></div>`);
      wireCode(code);const ta=box.querySelector('[data-in]');
      const go=async()=>{const v=ta.value.trim();if(!v)return;let d;try{d=expand(v);if(d.type!=='answer')throw new Error('That\'s an invite code. Paste the reply from the other device.')}catch(e){fail(e.message);return}
        const m=box.querySelector('[data-msg]');m.className='';m.textContent='Connecting…';
        try{await link.pc.setRemoteDescription(d);await opened(link,20000);connected()}catch(e){fail(e.message==='timeout'?'Couldn\'t connect. Check that both devices are online (the same Wi-Fi is most reliable) and try again.':e.message)}};
      box.querySelector('[data-go]').onclick=go;const sc=box.querySelector('[data-scan]');if(sc)sc.onclick=()=>{sc.disabled=true;scanInto(ta,go)}}
    async function asGuest(){show(`<span class="step">Step 1 of 2</span><h2>Join a game</h2><p>Scan or paste the invite code shown on the host's screen.</p>${pasteBlock('Invite code')}<div class="row"><button data-cancel>Cancel</button></div>`);
      const ta=box.querySelector('[data-in]');
      const go=async()=>{const v=ta.value.trim();if(!v)return;let d;try{d=expand(v);if(d.type!=='offer')throw new Error('That\'s a reply code. Paste the invite from the host.')}catch(e){fail(e.message);return}
        box.querySelector('[data-go]').disabled=true;const m=box.querySelector('[data-msg]');m.className='';m.textContent='Making your reply…';
        link=makeLink('guest');let code;try{code=await guestAnswer(link,v)}catch(e){fail('That code didn\'t work: '+e.message);box.querySelector('[data-go]').disabled=false;return}
        show(`<span class="step">Step 2 of 2</span><h2>Send this reply</h2><p>Show this to the host to scan, or copy it and send it to them.</p>${codeBlock(code,'Reply code')}<p data-msg>Waiting for the host to connect…</p><div class="row"><button data-cancel>Cancel</button></div>`);
        wireCode(code);try{await opened(link,10*60*1000);connected()}catch(e){fail('The host didn\'t connect in time. Start again with a new invite.')}};
      box.querySelector('[data-go]').onclick=go;const sc=box.querySelector('[data-scan]');if(sc)sc.onclick=()=>{sc.disabled=true;scanInto(ta,go)};ta.focus()}
    start()}

  window.P2P={open,_compact:compact,_expand:expand};
})();
