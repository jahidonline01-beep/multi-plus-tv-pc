const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

let mainWindow = null;
let remoteServer = null;
let remoteInfo = {
  port: 8088,
  pin: String(Math.floor(1000 + Math.random() * 9000)),
  url: '',
  qrDataUrl: ''
};


function isExternalLink(url) {
  return typeof url === 'string' && /^(https?:\/\/t\.me\/|https?:\/\/telegram\.me\/|tg:\/\/|telegram:\/\/)/i.test(url);
}

function openExternalLink(url) {
  try {
    if (url && /^(https?:|tg:|telegram:)/i.test(url)) {
      shell.openExternal(url);
      return true;
    }
  } catch (e) {}
  return false;
}

const DEFAULT_WINDOW_BOUNDS = { width: 1180, height: 760 };
const MIN_WINDOW_BOUNDS = { width: 420, height: 360 };
let windowStateSaveTimer = null;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function clampWindowBounds(bounds) {
  const primary = screen.getPrimaryDisplay().workArea;
  let width = Math.max(MIN_WINDOW_BOUNDS.width, Math.min(Number(bounds.width) || DEFAULT_WINDOW_BOUNDS.width, primary.width));
  let height = Math.max(MIN_WINDOW_BOUNDS.height, Math.min(Number(bounds.height) || DEFAULT_WINDOW_BOUNDS.height, primary.height));
  let x = Number.isFinite(bounds.x) ? bounds.x : Math.round(primary.x + (primary.width - width) / 2);
  let y = Number.isFinite(bounds.y) ? bounds.y : Math.round(primary.y + (primary.height - height) / 2);

  const displays = screen.getAllDisplays().map(display => display.workArea);
  const visibleOnScreen = displays.some(area => (
    x < area.x + area.width - 80 &&
    x + width > area.x + 80 &&
    y < area.y + area.height - 80 &&
    y + height > area.y + 80
  ));

  if (!visibleOnScreen) {
    x = Math.round(primary.x + (primary.width - width) / 2);
    y = Math.round(primary.y + (primary.height - height) / 2);
  }
  return { x, y, width, height };
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8'));
    if (!state || !state.bounds) return null;
    return {
      bounds: clampWindowBounds(state.bounds),
      isMaximized: !!state.isMaximized
    };
  } catch (e) {
    return null;
  }
}

function saveWindowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(getWindowStatePath(), JSON.stringify({
      bounds,
      isMaximized: mainWindow.isMaximized(),
      savedAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {}
}

function queueWindowStateSave() {
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(saveWindowState, 350);
}


function getStableDeviceId() {
  const raw = [os.hostname(), os.platform(), os.arch(), os.userInfo().username].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function updateRemoteQR() {
  try {
    if (remoteInfo.url) {
      remoteInfo.qrDataUrl = await QRCode.toDataURL(remoteInfo.url, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 260,
        color: { dark: '#06122b', light: '#ffffff' }
      });
    }
  } catch (e) { remoteInfo.qrDataUrl = ''; }
}

function remotePage() {
  const pin = escapeHtml(remoteInfo.pin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Multi Plus TV Remote</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden}
body{margin:0;background:radial-gradient(circle at 16% 0%,#34b6ff55,transparent 34%),radial-gradient(circle at 90% 12%,#8c5cff40,transparent 32%),linear-gradient(180deg,#061b42,#020713 72%);color:#fff;font-family:Arial,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:10px}
.card{width:min(470px,100%);max-height:98vh;overflow:auto;border-radius:30px;padding:16px;background:linear-gradient(180deg,rgba(9,39,101,.98),rgba(4,14,38,.98));border:1px solid #8bd5ff55;box-shadow:0 22px 46px #0009,0 0 30px #238fff38;position:relative}
.card:before{content:"";position:absolute;inset:0;border-radius:30px;background:linear-gradient(135deg,#ffffff16,transparent 36%,#2aaeff13);pointer-events:none}
.head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
h1{margin:0;font-size:22px;line-height:1.05;background:linear-gradient(90deg,#87e2ff,#9d9bff,#ff7ae6);-webkit-background-clip:text;color:transparent}
.status{font-size:12px;color:#83ffa2;min-height:18px;text-align:right;max-width:150px;word-break:break-word}
.pin,.channelJump{position:relative;display:flex;gap:8px;margin:8px 0}
.pin input,.channelJump input{flex:1;border:1px solid #8bd5ff55;background:#04142f;color:#fff;border-radius:16px;padding:13px 15px;font-size:18px;text-align:center;font-weight:900;box-shadow:inset 0 1px 0 #ffffff10;min-width:0}
.pin input{letter-spacing:5px}.channelJump input{letter-spacing:1px;font-size:16px}
.touchpad{position:relative;margin:12px 0;border-radius:26px;height:250px;background:linear-gradient(135deg,#0a327d,#061735);border:1px solid #82d7ff55;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:inset 0 1px 0 #ffffff1b,0 10px 22px #0007;touch-action:none;user-select:none}
.touchpad:before{content:"";position:absolute;inset:-25%;background:radial-gradient(circle,#53c9ff2c,transparent 36%);transform:translate(var(--x,0),var(--y,0))}
.touchText{position:relative;text-align:center;color:#e4f4ff;font-weight:900;line-height:1.35;font-size:20px}
.touchText small{display:block;color:#93ceff;font-size:11px;margin-top:6px;font-weight:800}
.grid{position:relative;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
button{border:0;border-radius:18px;padding:15px 11px;background:linear-gradient(135deg,#2ea7ff,#073ea8);color:#fff;font-size:14px;font-weight:900;box-shadow:0 8px 18px #0006,inset 0 1px 0 #ffffff28}
button:active{transform:scale(.97);filter:brightness(1.14)}
.big{grid-column:span 3}.small{font-size:13px;padding:13px 10px}.closeApp{background:linear-gradient(135deg,#ff4d6d,#9c062a)}
.mini{position:relative;font-size:11px;color:#9fd6ff;text-align:center;margin-top:8px;line-height:1.35}
</style></head>
<body><div class="card">
  <div class="head"><h1>Premium<br>Remote</h1><div class="status" id="status">Ready</div></div>
  <div class="pin"><input id="pin" maxlength="4" inputmode="numeric" value="${pin}" placeholder="PIN"></div>
  <div class="channelJump"><input id="channelNo" inputmode="numeric" placeholder="Channel No"><button onclick="openChannel()">Open</button></div>
  <div class="touchpad" id="touchpad"><div class="touchText">Touch Mouse<small>1 finger move • tap click • double tap open/play<br>2 fingers scroll anywhere</small></div></div>
  <div class="grid">
    <button onclick="send('prev')">◀ Prev</button><button onclick="send('play')">⏯ Play</button><button onclick="send('next')">Next ▶</button>
    <button onclick="send('volDown')" class="small">Vol -</button><button onclick="send('mute')" class="small">Mute</button><button onclick="send('volUp')" class="small">Vol +</button>
    <button onclick="send('fullscreen')" class="big">Fullscreen / Restore</button>
    <button onclick="send('closeApp')" class="big closeApp">Close PC App</button>
  </div>
  <div class="mini">Same Wi‑Fi / hotspot. Control PC cursor from this touchpad.</div>
</div>
<script>
let sx=0,sy=0,lastX=0,lastY=0,lastTap=0,twoFinger=false;
const pad=document.getElementById('touchpad');const status=document.getElementById('status');
async function send(cmd,extra=''){const pin=document.getElementById('pin').value.trim();try{const r=await fetch('/api/action?pin='+encodeURIComponent(pin)+'&cmd='+encodeURIComponent(cmd)+extra);const t=await r.text();status.textContent=r.ok?'Sent: '+cmd:t;status.style.color=r.ok?'#83ffa2':'#ff8a8a'}catch(e){status.textContent='Connection failed';status.style.color='#ff8a8a'}}
function openChannel(){const n=document.getElementById('channelNo').value.trim();if(n)send('openChannel','&num='+encodeURIComponent(n))}
pad.addEventListener('touchstart',e=>{const t=e.changedTouches[0];sx=lastX=t.clientX;sy=lastY=t.clientY;twoFinger=e.touches.length>=2;const now=Date.now();if(!twoFinger&&now-lastTap<320){e.preventDefault();send('remoteDoubleClick');lastTap=0;return}lastTap=now},{passive:false});
pad.addEventListener('touchmove',e=>{const t=e.touches[0]||e.changedTouches[0];const dx=t.clientX-lastX,dy=t.clientY-lastY;lastX=t.clientX;lastY=t.clientY;pad.style.setProperty('--x',(t.clientX-sx)+'px');pad.style.setProperty('--y',(t.clientY-sy)+'px');if(e.touches.length>=2||twoFinger){const wx=Math.round(dx*1.9), wy=Math.round(dy*1.9);send('remoteWheel','&dx='+wx+'&dy='+wy); if(Math.abs(wy)>Math.abs(wx)) send('remoteHomeScroll','&dy='+wy)}else{send('remoteMove','&dx='+Math.round(dx*1.35)+'&dy='+Math.round(dy*1.35))}e.preventDefault()},{passive:false});
pad.addEventListener('touchend',e=>{if(twoFinger){twoFinger=false;return}const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.max(Math.abs(dx),Math.abs(dy))<20){send('remoteClick');return}},{passive:false});
</script></body></html>`;
}

function startRemoteServer() {
  if (remoteServer) return;
  remoteServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      res.end(remotePage());
      return;
    }
    if (url.pathname === '/api/info') {
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify(remoteInfo));
      return;
    }
    if (url.pathname === '/api/action') {
      const pin = url.searchParams.get('pin') || '';
      const cmd = url.searchParams.get('cmd') || '';
      const num = url.searchParams.get('num') || '';
      const dx = url.searchParams.get('dx') || '';
      const dy = url.searchParams.get('dy') || '';
      const x = url.searchParams.get('x') || '';
      const y = url.searchParams.get('y') || '';
      if (pin !== remoteInfo.pin) {
        res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'});
        res.end('Wrong PIN');
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (cmd === 'closeApp') {
          setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); }, 150);
        } else {
          mainWindow.webContents.send('remote-command', cmd, { num, dx, dy, x, y });
        }
      }
      res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store'});
      res.end('OK');
      return;
    }
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Not found');
  });

  remoteServer.on('error', () => {
    remoteInfo.port = 0;
    remoteServer.listen(0, '0.0.0.0', async () => {
      remoteInfo.port = remoteServer.address().port;
      remoteInfo.url = `http://${getLocalIP()}:${remoteInfo.port}`;
      await updateRemoteQR();
    });
  });

  remoteServer.listen(remoteInfo.port, '0.0.0.0', async () => {
    remoteInfo.url = `http://${getLocalIP()}:${remoteInfo.port}`;
    await updateRemoteQR();
  });
}

function createWindow() {
  startRemoteServer();

  const savedWindowState = readWindowState();
  const initialBounds = savedWindowState ? savedWindowState.bounds : DEFAULT_WINDOW_BOUNDS;

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WINDOW_BOUNDS.width,
    minHeight: MIN_WINDOW_BOUNDS.height,
    title: 'Multi Plus TV Premium PC',
    icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#05030b',
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  if (savedWindowState && savedWindowState.isMaximized) {
    mainWindow.once('ready-to-show', () => mainWindow.maximize());
  }

  mainWindow.on('resize', queueWindowStateSave);
  mainWindow.on('move', queueWindowStateSave);
  mainWindow.on('maximize', queueWindowStateSave);
  mainWindow.on('unmaximize', queueWindowStateSave);
  mainWindow.on('close', saveWindowState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url && !url.startsWith('file://')) {
      event.preventDefault();
      openExternalLink(url);
    }
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (isExternalLink(url)) {
      event.preventDefault();
      openExternalLink(url);
    }
  });
  mainWindow.loadFile('index.html');
}

ipcMain.handle('get-remote-info', () => remoteInfo);
ipcMain.handle('get-device-id', () => getStableDeviceId());
ipcMain.handle('open-external-url', async (_event, url) => {
  return openExternalLink(url);
});
ipcMain.on('window-control', (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (action === 'restore') mainWindow.unmaximize();
  if (action === 'close') mainWindow.close();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (remoteServer) {
    try { remoteServer.close(); } catch(e) {}
    remoteServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
