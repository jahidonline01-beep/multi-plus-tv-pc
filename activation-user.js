(function(){
  const APP_NAME = 'Multi Plus TV Premium';
  const APP_BUILD_VERSION = 'PC v56';
  const LOCAL_KEY = 'mptv_device_activation_v3_monthly';
  const OLD_LOCAL_KEYS = ['mptv_device_activation_v2'];
  const DEVICE_KEY = 'mptv_device_id_v2';
  const INSTALL_KEY = 'mptv_install_id_v4';
  const SETTINGS = window.MPTV_FIREBASE_SETTINGS || {};
  const COLLECTION = SETTINGS.deviceActivationCollection || 'deviceActivations';
  const ADMIN_URL = SETTINGS.adminTelegram || 'https://t.me/JAHID_1';
  const MONTHLY_SYNC_MS = Number(SETTINGS.monthlyOnlineCheckMs || (30 * 24 * 60 * 60 * 1000));
  const DAILY_LOCAL_MS = 24 * 60 * 60 * 1000;
  const LIVE_ADMIN_PERMISSION = SETTINGS.liveAdminPermission !== false;
  const platform = (window.AndroidBridge && typeof AndroidBridge.getDeviceId === 'function') ? 'android' : 'desktop';
  let db = null;
  let approvalUnsubscribe = null;
  let permissionUnsubscribe = null;
  let livePermissionCode = '';
  let currentInfo = null;
  let unlocked = false;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function now(){ return Date.now(); }
  function toMillis(v){
    if(!v) return 0;
    if(typeof v === 'number') return v;
    if(typeof v === 'string'){ const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
    if(v.toMillis) return v.toMillis();
    if(typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }
  function fmt(ms){
    if(!ms) return 'N/A';
    try { return new Date(ms).toLocaleDateString('en-US', {day:'2-digit', month:'short', year:'numeric'}); } catch(e){ return String(ms); }
  }
  function saveLocal(data){ localStorage.setItem(LOCAL_KEY, JSON.stringify(data || {})); }
  function readLocal(){
    try {
      const current = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if(current) return current;
      for(const k of OLD_LOCAL_KEYS){
        const old = JSON.parse(localStorage.getItem(k) || 'null');
        if(old){ saveLocal(old); return old; }
      }
    } catch(e){}
    return null;
  }
  function clearLocal(){
    localStorage.removeItem(LOCAL_KEY);
    OLD_LOCAL_KEYS.forEach(k => localStorage.removeItem(k));
  }
  function setMsg(text, type){ const el=$('mptvDeviceMsg'); if(el){ el.textContent=text||''; el.className='mptv-msg '+(type||''); } }
  function configMissing(){ const c=window.MPTV_FIREBASE_CONFIG||{}; return !c.apiKey || !c.projectId || !c.appId; }
  function initFirebase(silent){
    if(configMissing()){ if(!silent) setMsg('Send this code to admin for activation.', 'wait'); return false; }
    if(!window.firebase || !firebase.apps){ if(!silent) setMsg('Send this code to admin for activation.', 'wait'); return false; }
    try {
      if(!firebase.apps.length) firebase.initializeApp(window.MPTV_FIREBASE_CONFIG);
      db = firebase.firestore();
      return true;
    } catch(e){
      if(!silent) setMsg('Send this code to admin for activation.', 'wait');
      return false;
    }
  }
  async function sha256(text){
    try {
      if(window.crypto && crypto.subtle){
        const data = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
      }
    } catch(e){}
    let h1=0x811c9dc5, h2=0x45d9f3b;
    for(let i=0;i<text.length;i++){ h1 ^= text.charCodeAt(i); h1 = Math.imul(h1, 16777619); h2 = Math.imul(h2 ^ text.charCodeAt(i), 2654435761); }
    return ((h1>>>0).toString(16)+(h2>>>0).toString(16)).toUpperCase().padEnd(64,'0');
  }
  function getInstallId(){
    let id = localStorage.getItem(INSTALL_KEY);
    if(!id){
      id = 'inst-' + (crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random()).replace(/\./g,''));
      localStorage.setItem(INSTALL_KEY, id);
    }
    return id;
  }
  async function getRawDeviceId(){
    try {
      if(window.AndroidBridge && typeof AndroidBridge.getDeviceId === 'function'){
        const id = AndroidBridge.getDeviceId();
        if(id && id !== 'unknown') return 'android-' + id;
      }
    } catch(e){}
    try { if(window.pcDevice && typeof window.pcDevice.getId === 'function'){ const id = await window.pcDevice.getId(); if(id) return 'pc-' + id; } } catch(e){}
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){ id = 'web-' + (crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random()).replace(/\./g,'')); localStorage.setItem(DEVICE_KEY,id); }
    return id;
  }
  async function getDeviceInfo(){
    const existing = readLocal();
    if(existing && existing.requestCode && existing.deviceHash){
      return { rawDeviceId: '', deviceHash: existing.deviceHash, requestCode: existing.requestCode, deviceType: existing.deviceType || platform, legacyLocal: true };
    }
    const raw = await getRawDeviceId();
    const installId = getInstallId();
    const hash = await sha256(raw + '|' + installId + '|' + platform + '|MultiPlusTV|v4');
    const code = 'MP-' + hash.slice(0,4) + '-' + hash.slice(4,8) + '-' + hash.slice(8,12);
    return { rawDeviceId: raw, installId: installId, deviceHash: hash, requestCode: code, deviceType: platform };
  }
  function isActiveStatus(v){
    v = String(v || '').toLowerCase();
    return v === 'active' || v === 'approved' || v === 'allow';
  }
  function isBlockedStatus(v){
    v = String(v || '').toLowerCase();
    return v === 'blocked' || v === 'deny' || v === 'disabled' || v === 'banned';
  }
  function localValid(local, info){
    return local && local.requestCode === info.requestCode && local.deviceHash === info.deviceHash && local.expiryAt && now() < Number(local.expiryAt) && isActiveStatus(local.status || 'active') && !isBlockedStatus(local.permission);
  }
  function markDailyLocalCheck(local){
    const updated = Object.assign({}, local, { lastLocalCheckAt: now() });
    if(!local.lastLocalCheckAt || now() - Number(local.lastLocalCheckAt) >= DAILY_LOCAL_MS){
      updated.localCheckCount = Number(local.localCheckCount || 0) + 1;
    }
    saveLocal(updated);
    return updated;
  }
  function monthlyCheckDue(local){
    const last = Number(local.lastOnlineCheckAt || local.activatedAt || 0);
    return !last || (now() - last) >= MONTHLY_SYNC_MS;
  }
  function daysUntilMonthlyCheck(local){
    const last = Number(local.lastOnlineCheckAt || local.activatedAt || 0);
    if(!last) return 0;
    return Math.max(0, Math.ceil((MONTHLY_SYNC_MS - (now() - last)) / 86400000));
  }
  function lock(reason){
    unlocked = false;
    const ov=$('mptvDeviceOverlay'); if(ov) ov.classList.remove('mptv-hidden');
    document.body.classList.add('mptv-locked');
    const refresh=$('mptvRefreshPermission'); if(refresh) refresh.classList.toggle('mptv-hidden', !reason);
    try { const v=document.querySelector('video'); if(v){ v.pause(); } } catch(e){}
    if(reason) setMsg(reason, 'err');
  }
  let chipHideTimer = null;
  function hideActiveChip(){
    const chip=$('mptvActiveChip');
    if(chip) chip.classList.add('mptv-hidden');
    if(chipHideTimer){ clearTimeout(chipHideTimer); chipHideTimer=null; }
  }
  function renderActiveChip(local){
    const chip=$('mptvActiveChip');
    if(!chip) return;
    const nextSync = monthlyCheckDue(local) ? 'Today' : (daysUntilMonthlyCheck(local) + ' days left');
    const liveText = LIVE_ADMIN_PERMISSION ? ' • Live block permission' : '';
    chip.innerHTML = '<button class="mptv-chip-close" id="mptvChipClose" aria-label="Close">×</button><b>Active</b><span>'+esc(local.requestCode)+'</span><small>Expiry: '+esc(fmt(local.expiryAt))+' • Monthly check: '+esc(nextSync)+esc(liveText)+'</small>';
    chip.classList.remove('mptv-hidden');
    const close=$('mptvChipClose'); if(close) close.onclick=hideActiveChip;
    if(chipHideTimer) clearTimeout(chipHideTimer);
    chipHideTimer = setTimeout(hideActiveChip, 6000);
  }
  function unlock(local){
    const refresh=$('mptvRefreshPermission'); if(refresh) refresh.classList.add('mptv-hidden');
    if(unlocked){
      renderActiveChip(local);
      if(LIVE_ADMIN_PERMISSION && currentInfo) startLiveAdminPermission(currentInfo, local);
      return;
    }
    unlocked = true;
    const ov=$('mptvDeviceOverlay'); if(ov) ov.classList.add('mptv-hidden');
    document.body.classList.remove('mptv-locked');
    renderActiveChip(local);
    if(LIVE_ADMIN_PERMISSION && currentInfo) startLiveAdminPermission(currentInfo, local);
    if(typeof window.startPremiumApp === 'function') window.startPremiumApp();
  }
  function isDocActive(data, info){
    const status = String(data.status || data.permission || '').toLowerCase();
    const permission = String(data.permission || data.adminPermission || '').toLowerCase();
    const exp = toMillis(data.expiryAt || data.expiryDate);
    if(isBlockedStatus(status) || isBlockedStatus(permission)) return { ok:false, reason:'This device has been blocked from the admin panel.' };
    if(!isActiveStatus(status)) return { ok:false, reason:'Waiting for admin approval.' };
    if(exp && now() > exp) return { ok:false, reason:'Activation has expired. Ask the admin to renew it.' };
    if(data.deviceHash && data.deviceHash !== info.deviceHash) return { ok:false, reason:'This code is already bound to another device.' };
    return { ok:true, expiryAt: exp || (now() + 86400000) };
  }
  async function updateOnline(code, mode, info){
    // Default: the user app does not write to Firestore; it only reads and refreshes the local license.
    // Enable allowUserStatusWrite:true in firebase-config.js only if limited heartbeat writes are needed.
    if(SETTINGS.allowUserStatusWrite !== true) return;
    try {
      if(db && firebase.firestore){
        const payload = {
          lastOnlineCheckAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastCheckMode: mode || 'monthly',
          deviceType: platform
        };
        if(info && info.deviceHash){
          payload.deviceHash = info.deviceHash;
          payload.boundDeviceType = info.deviceType || platform;
        }
        await db.collection(COLLECTION).doc(code).set(payload, { merge:true });
      }
    } catch(e){}
  }
  function buildLocal(data, info, res, oldLocal, mode){
    const t = now();
    return {
      requestCode: info.requestCode,
      deviceHash: info.deviceHash,
      deviceType: info.deviceType,
      expiryAt: res.expiryAt,
      status: 'active',
      permission: 'active',
      customerName: data.customerName || (oldLocal && oldLocal.customerName) || '',
      activatedAt: (oldLocal && oldLocal.activatedAt) || t,
      lastLocalCheckAt: t,
      lastOnlineCheckAt: t,
      lastOnlineMode: mode || 'monthly',
      lastPermissionCheckAt: t,
      localCheckCount: Number((oldLocal && oldLocal.localCheckCount) || 0)
    };
  }
  async function checkServerOnce(info, options){
    options = options || {};
    const silent = !!options.silent;
    const mode = options.mode || 'manual';
    if(!initFirebase(silent)) return false;
    try {
      const doc = await db.collection(COLLECTION).doc(info.requestCode).get();
      if(!doc.exists){ if(!silent) setMsg('Send this code to admin for activation.', 'wait'); return false; }
      const data = doc.data() || {};
      const res = isDocActive(data, info);
      if(!res.ok){ clearLocal(); lock(res.reason); return false; }
      const local = buildLocal(data, info, res, readLocal(), mode);
      saveLocal(local);
      await updateOnline(info.requestCode, mode, info);
      unlock(local);
      if(!silent) setMsg('Activation active.', 'ok');
      return true;
    } catch(e){
      if(!silent) setMsg('Send this code to admin for activation.', 'wait');
      return false;
    }
  }
  async function monthlyServerCheck(info, currentLocal){
    const lastFail = Number(currentLocal.lastOnlineCheckFailedAt || 0);
    if(lastFail && now() - lastFail < DAILY_LOCAL_MS){
      unlock(currentLocal);
      return false;
    }
    const ok = await checkServerOnce(info, { silent:true, mode:'monthly' });
    if(!ok){
      const latest = Object.assign({}, currentLocal, { lastOnlineCheckFailedAt: now() });
      saveLocal(latest);
      unlock(latest);
    }
    return ok;
  }
  function stopLiveAdminPermission(){
    try { if(permissionUnsubscribe) permissionUnsubscribe(); } catch(e){}
    permissionUnsubscribe = null;
    livePermissionCode = '';
  }
  function startLiveAdminPermission(info, currentLocal){
    if(!LIVE_ADMIN_PERMISSION || !localValid(currentLocal, info)) return;
    if(livePermissionCode === info.requestCode && permissionUnsubscribe) return;
    if(!initFirebase(true)) return;
    stopLiveAdminPermission();
    livePermissionCode = info.requestCode;
    try {
      permissionUnsubscribe = db.collection(COLLECTION).doc(info.requestCode).onSnapshot(doc => {
        if(!doc.exists){
          clearLocal();
          stopLiveAdminPermission();
          lock('Device approval was deleted from the admin panel.');
          return;
        }
        const data = doc.data() || {};
        const res = isDocActive(data, info);
        if(!res.ok){
          clearLocal();
          stopLiveAdminPermission();
          lock(res.reason);
          return;
        }
        const refreshed = buildLocal(data, info, res, readLocal() || currentLocal, 'live_permission');
        saveLocal(refreshed);
        if(unlocked){
          renderActiveChip(refreshed);
        }
      }, () => {
        // If Internet/Firebase is temporarily unavailable, the app will not lock. The listener will receive permission again when the connection returns.
        livePermissionCode = '';
        permissionUnsubscribe = null;
      });
    } catch(e){ livePermissionCode=''; permissionUnsubscribe=null; }
  }
  function listenForApproval(info){
    if(!initFirebase(false)) return;
    try { if(approvalUnsubscribe) approvalUnsubscribe(); } catch(e){}
    setMsg('Send this code to admin for activation.', 'wait');
    approvalUnsubscribe = db.collection(COLLECTION).doc(info.requestCode).onSnapshot(async doc => {
      if(!doc.exists){ setMsg('Send this code to admin for activation.', 'wait'); return; }
      const data = doc.data() || {};
      const res = isDocActive(data, info);
      if(!res.ok){ clearLocal(); lock(res.reason); return; }
      const local = buildLocal(data, info, res, readLocal(), 'first_activation');
      saveLocal(local);
      await updateOnline(info.requestCode, 'first_activation', info);
      try { if(approvalUnsubscribe) approvalUnsubscribe(); } catch(e){}
      approvalUnsubscribe = null;
      unlock(local);
    }, () => setMsg('Send this code to admin for activation.', 'wait'));
  }
  async function refreshPermission(){
    if(!currentInfo) return;
    setMsg('Checking permission...', 'wait');
    const ok = await checkServerOnce(currentInfo, { silent:false, mode:'manual_refresh' });
    if(!ok){
      if(!readLocal()) setMsg('Still waiting for admin permission.', 'wait');
    }
  }
  async function copyCode(){
    const code = $('mptvRequestCode') ? $('mptvRequestCode').textContent.trim() : '';
    try { await navigator.clipboard.writeText(code); setMsg('Code copied.', 'ok'); } catch(e){ setMsg(code, 'ok'); }
  }
  function messageAdmin(){
    const code = $('mptvRequestCode') ? $('mptvRequestCode').textContent.trim() : '';
    const text = encodeURIComponent('Multi Plus TV activation code: ' + code);
    const url = ADMIN_URL + '?text=' + text;
    try {
      if(window.AndroidBridge && typeof AndroidBridge.openExternal === 'function'){ AndroidBridge.openExternal(url); return; }
    } catch(e){}
    try {
      if(window.pcExternal && typeof window.pcExternal.open === 'function'){ window.pcExternal.open(url); return; }
    } catch(e){}
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch(e){ location.href = url; }
  }
  function buildOverlay(){
    const style=document.createElement('style');
    style.textContent = `
      body.mptv-locked > *:not(#mptvDeviceOverlay):not(#mptvActiveChip){filter:blur(7px);pointer-events:none;user-select:none}
      *{box-sizing:border-box}.mptv-hidden{display:none!important}.mptv-device-overlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto;-webkit-overflow-scrolling:touch;background:radial-gradient(circle at 12% 0%,rgba(43,190,255,.28),transparent 34%),radial-gradient(circle at 88% 12%,rgba(255,85,222,.18),transparent 36%),linear-gradient(180deg,#05030b,#020713 76%);color:#fff;font-family:Arial,Segoe UI,sans-serif}.mptv-device-card{width:min(460px,100%);max-height:calc(100vh - 28px);overflow-y:auto;border-radius:30px;padding:22px;background:linear-gradient(180deg,rgba(13,36,92,.96),rgba(4,14,38,.98));border:1px solid rgba(139,215,255,.34);box-shadow:0 28px 70px rgba(0,0,0,.68),0 0 32px rgba(38,185,255,.20);position:relative;overflow:hidden}.mptv-device-card:before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.12),transparent 44%,rgba(42,186,255,.09));pointer-events:none}.mptv-head{position:relative;display:flex;gap:12px;align-items:center;margin-bottom:16px}.mptv-head img{width:56px;height:56px;border-radius:18px;background:#fff;padding:5px}.mptv-head h1{margin:0;font-size:22px;line-height:1.05;background:linear-gradient(90deg,#8fe7ff,#a29bff,#ff75e7);-webkit-background-clip:text;color:transparent}.mptv-head small{display:block;color:#a9d9ff;font-size:12px;font-weight:900;margin-top:4px}.mptv-label{position:relative;color:#d8efff;font-size:12px;font-weight:1000;margin:6px 0}.mptv-code{position:relative;border-radius:22px;padding:18px 12px;text-align:center;letter-spacing:2.5px;font-size:25px;font-weight:1000;background:linear-gradient(135deg,#061a45,#0a2c6f);border:1px solid rgba(139,215,255,.38);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);user-select:all}.mptv-sub{position:relative;margin-top:10px;color:#c7dcff;font-size:13px;line-height:1.45}.mptv-row{position:relative;display:flex;gap:10px;margin-top:14px}.mptv-btn{flex:1;border:0;border-radius:17px;padding:14px 10px;background:linear-gradient(135deg,#29bdff,#1264ff);color:#fff;font-weight:1000;font-size:13px;box-shadow:0 12px 26px rgba(0,0,0,.4)}.mptv-btn.secondary{background:linear-gradient(135deg,#1d2744,#0b1024);border:1px solid rgba(255,255,255,.12)}.mptv-btn.telegram{background:linear-gradient(135deg,#35d989,#0b9657)}.mptv-msg{position:relative;min-height:19px;margin-top:12px;font-size:12px;font-weight:900;color:#a9d9ff;line-height:1.4}.mptv-msg.err{color:#ff9d9d}.mptv-msg.ok{color:#85ffae}.mptv-msg.wait{color:#ffd978}.mptv-active-chip{position:fixed;right:12px;bottom:12px;z-index:999990;display:flex;flex-direction:column;gap:2px;border-radius:18px;padding:10px 12px;background:linear-gradient(135deg,rgba(5,20,55,.92),rgba(3,8,23,.92));border:1px solid rgba(125,255,169,.28);color:#fff;font-family:Arial,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.42);backdrop-filter:blur(14px)}.mptv-active-chip b{font-size:11px;color:#80ffa8}.mptv-active-chip span{font-size:12px;font-weight:1000}.mptv-active-chip small{font-size:10px;color:#b8d6ff;padding-right:18px}.mptv-chip-close{position:absolute;right:7px;top:6px;width:22px;height:22px;border:0;border-radius:99px;background:rgba(255,255,255,.12);color:#fff;font-size:16px;font-weight:1000;line-height:20px}.mptv-chip-close:active{transform:scale(.94)}
      @media (max-height:560px),(max-width:420px){.mptv-device-overlay{align-items:flex-start;padding:10px 8px}.mptv-device-card{width:100%;max-height:none;border-radius:22px;padding:14px}.mptv-head{gap:9px;margin-bottom:10px}.mptv-head img{width:42px;height:42px;border-radius:13px}.mptv-head h1{font-size:18px}.mptv-head small{font-size:10px}.mptv-code{font-size:19px;letter-spacing:1.2px;padding:13px 8px;border-radius:17px}.mptv-sub{font-size:12px;margin-top:8px}.mptv-row{gap:8px;margin-top:10px;flex-wrap:wrap}.mptv-btn{min-width:130px;padding:12px 8px;border-radius:14px;font-size:12px}.mptv-msg{font-size:11px;margin-top:8px}.mptv-active-chip{left:8px;right:8px;bottom:8px;border-radius:16px}}
    `;
    document.head.appendChild(style);
    const overlay=document.createElement('div');
    overlay.id='mptvDeviceOverlay'; overlay.className='mptv-device-overlay';
    overlay.innerHTML = `<div class="mptv-device-card">
      <div class="mptv-head"><img src="logo.png" onerror="this.style.display='none'" alt=""><div><h1>${APP_NAME}</h1><small>Device Activation</small></div></div>
      <div class="mptv-label">Your Device Code</div>
      <div id="mptvRequestCode" class="mptv-code">Loading...</div>
      <div class="mptv-sub">Send this code to admin for activation.</div>
      <div class="mptv-row"><button id="mptvCopyCode" class="mptv-btn">Copy Code</button><button id="mptvMsgAdmin" class="mptv-btn telegram">Message Admin</button></div><div class="mptv-row"><button id="mptvRefreshPermission" class="mptv-btn secondary mptv-hidden">Refresh Permission</button></div>
      <div id="mptvDeviceMsg" class="mptv-msg">Send this code to admin for activation.</div>
    </div>`;
    document.body.appendChild(overlay);
    const chip=document.createElement('div'); chip.id='mptvActiveChip'; chip.className='mptv-active-chip mptv-hidden'; document.body.appendChild(chip);
  }
  async function boot(){
    buildOverlay();
    lock('');
    const info = await getDeviceInfo();
    currentInfo = info;
    $('mptvRequestCode').textContent = info.requestCode;
    $('mptvCopyCode').onclick = copyCode;
    $('mptvMsgAdmin').onclick = messageAdmin;
    $('mptvRefreshPermission').onclick = refreshPermission;
    const local = readLocal();
    if(localValid(local, info)){
      const checked = markDailyLocalCheck(local);
      unlock(checked);
      if(monthlyCheckDue(checked)){
        setTimeout(() => monthlyServerCheck(info, checked), 1500);
      }
    } else {
      setMsg('Send this code to admin for activation.', 'wait');
      listenForApproval(info);
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
