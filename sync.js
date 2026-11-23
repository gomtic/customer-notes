/* 고객 상담 노트 - 클라우드 동기화 (Supabase)
   - 고객 목록은 지금처럼 기기 안(localStorage)에 먼저 저장하고, 인터넷이 되면 클라우드와 주고받습니다.
   - 고객 한 명 단위로 "나중에 고친 쪽"이 남습니다. 삭제도 다른 기기에 전달됩니다.
   - 통신하는 곳은 sync-config.js에 적힌 Supabase 주소 한 곳뿐입니다.
   - sync-config.js가 비어 있으면 아무 일도 하지 않습니다(기기 안에만 저장). */
(function () {
  'use strict';
  var CFG = window.SYNC_CONFIG || {};
  if (!CFG.url || !CFG.key) return;
  var BASE = CFG.url.replace(/\/+$/, '');

  var KEY = 'crm_customers_v1';
  var K_SESSION = 'crm_sync_session';
  var K_CURSOR = 'crm_sync_cursor';
  var K_KNOWN = 'crm_sync_known';
  var K_USER = 'crm_sync_user';
  var K_LAST = 'crm_sync_last';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function jget(k, d) { try { var v = lsGet(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var internal = false;
  function lsSet(k, v) { internal = true; try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } internal = false; }
  function jset(k, v) { lsSet(k, JSON.stringify(v)); }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  /* ---------- 화면: 동기화 상태 줄 ---------- */
  var bar = document.getElementById('bkInfo') && document.getElementById('bkInfo').parentNode;
  var info = document.createElement('span');
  info.className = 'bk-info';
  var act = document.createElement('button');
  act.type = 'button';
  act.className = 'link';
  if (bar) { bar.appendChild(info); bar.appendChild(act); }

  function hhmm(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function showStatus(text, warn) {
    var s = session();
    info.textContent = text;
    info.className = 'bk-info' + (warn ? ' warn' : '');
    act.textContent = s ? '로그아웃' : '동기화 로그인';
  }
  act.onclick = function () {
    if (session()) {
      if (window.confirm('로그아웃할까요?\n\n이 기기의 고객 목록은 그대로 남지만, 다시 로그인할 때까지 다른 기기와 맞춰지지 않습니다.')) logout();
    } else openLogin();
  };

  /* ---------- 로그인 창 ---------- */
  var dlg = null;
  function openLogin(msg) {
    if (dlg) { dlg.style.display = 'flex'; return; }
    dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45)';
    dlg.innerHTML =
      '<form style="width:100%;max-width:360px;background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:14px;padding:20px;display:grid;gap:10px">' +
      '<h2 style="margin:0;font-size:17px">동기화 로그인</h2>' +
      '<p style="margin:0;color:var(--muted);font-size:13px">아이폰과 PC에서 같은 이메일로 로그인하면 고객 목록이 자동으로 맞춰집니다.</p>' +
      '<label style="display:grid;gap:4px;font-size:13px;color:var(--muted)">이메일<input name="email" type="email" autocomplete="username" required style="padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);font-size:16px"></label>' +
      '<label style="display:grid;gap:4px;font-size:13px;color:var(--muted)">비밀번호 (6자 이상)<input name="pw" type="password" autocomplete="current-password" minlength="6" required style="padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);font-size:16px"></label>' +
      '<p class="msg" role="status" style="margin:0;min-height:1.2em;font-size:13px;color:var(--danger)"></p>' +
      '<button class="btn" type="submit" value="in">로그인</button>' +
      '<button class="mini-btn" type="button" data-a="up">처음 사용 (가입하기)</button>' +
      '<button class="link" type="button" data-a="later" style="justify-self:center">나중에 (이 기기에만 저장)</button>' +
      '</form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector('form'), m = dlg.querySelector('.msg');
    if (msg) m.textContent = msg;
    function go(kind) {
      var email = form.email.value.trim(), pw = form.pw.value;
      if (!email || pw.length < 6) { m.textContent = '이메일과 6자 이상의 비밀번호를 넣어 주세요.'; return; }
      m.style.color = 'var(--muted)'; m.textContent = kind === 'up' ? '가입하는 중…' : '로그인하는 중…';
      (kind === 'up' ? signUp(email, pw) : signIn(email, pw)).then(function () {
        form.pw.value = '';
        dlg.style.display = 'none';
        syncNow();
      }, function (e) {
        m.style.color = 'var(--danger)'; m.textContent = e.message;
      });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); go('in'); });
    dlg.querySelector('[data-a="up"]').onclick = function () { go('up'); };
    dlg.querySelector('[data-a="later"]').onclick = function () {
      dlg.style.display = 'none';
      try { sessionStorage.setItem('crm_sync_later', '1'); } catch (e) { /* 무시 */ }
    };
  }

  /* ---------- 로그인 정보 ---------- */
  function session() { return jget(K_SESSION, null); }
  function keepSession(r) {
    var s = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in || 3600) * 1000, email: r.user && r.user.email, uid: r.user && r.user.id };
    if (!s.access_token) throw new Error('로그인 정보를 받지 못했습니다.');
    // 다른 계정으로 로그인하면 동기화 기록을 새로 시작
    if (s.uid && lsGet(K_USER) !== s.uid) { lsDel(K_CURSOR); lsDel(K_KNOWN); lsSet(K_USER, s.uid); }
    jset(K_SESSION, s);
    return s;
  }
  function authFetch(path, body) {
    return fetch(BASE + '/auth/v1/' + path, {
      method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(koError(j));
        return j;
      });
    }, function () { throw new Error('인터넷에 연결되어 있지 않습니다.'); });
  }
  function koError(j) {
    var t = String(j.error_code || j.code || '') + ' ' + String(j.msg || j.message || j.error_description || j.error || '');
    if (/invalid_credentials|Invalid login/i.test(t)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/user_already_exists|already registered/i.test(t)) return '이미 가입된 이메일입니다. "로그인"을 눌러 주세요.';
    if (/signup_disabled|Signups not allowed/i.test(t)) return '새 가입이 막혀 있습니다. 기존 이메일로 로그인해 주세요.';
    if (/email_not_confirmed/i.test(t)) return '이메일 인증이 필요합니다. 메일함을 확인해 주세요.';
    if (/weak_password|at least/i.test(t)) return '비밀번호가 너무 짧거나 쉽습니다.';
    return '로그인하지 못했습니다. (' + t.trim() + ')';
  }
  function signIn(email, pw) { return authFetch('token?grant_type=password', { email: email, password: pw }).then(keepSession); }
  function signUp(email, pw) {
    return authFetch('signup', { email: email, password: pw }).then(function (r) {
      if (!r.access_token) throw new Error('가입은 되었지만 이메일 인증이 필요합니다. 메일함을 확인한 뒤 "로그인"을 눌러 주세요.');
      return keepSession(r);
    });
  }
  function token() {
    var s = session();
    if (!s) return Promise.reject(new Error('nologin'));
    if (s.expires_at - Date.now() > 60000) return Promise.resolve(s.access_token);
    return authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(function (r) {
      return keepSession(r).access_token;
    }, function (e) {
      if (/인터넷/.test(e.message)) throw e;
      lsDel(K_SESSION); // 로그인이 만료됨
      throw new Error('nologin');
    });
  }
  function logout() {
    var s = session();
    lsDel(K_SESSION);
    if (s) fetch(BASE + '/auth/v1/logout', { method: 'POST', headers: { apikey: CFG.key, Authorization: 'Bearer ' + s.access_token } }).catch(function () {});
    showStatus('동기화 꺼짐', false);
  }

  /* ---------- 클라우드와 주고받기 ---------- */
  function api(method, query, body, tok, prefer) {
    var h = { apikey: CFG.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    if (prefer) h.Prefer = prefer;
    return fetch(BASE + '/rest/v1/customers' + query, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        if (res.status === 401) { lsDel(K_SESSION); throw new Error('nologin'); }
        if (!res.ok) return res.text().then(function (t) { throw new Error('서버 오류 ' + res.status + ' ' + t.slice(0, 120)); });
        return res.status === 204 || method !== 'GET' ? null : res.json();
      }, function () { throw new Error('offline'); });
  }
  function pullAll(tok, cursor, acc) {
    var q = '?select=id,data,updated_at,deleted,server_ts&order=server_ts.asc&limit=1000' + (cursor ? '&server_ts=gt.' + encodeURIComponent(cursor) : '');
    return api('GET', q, null, tok).then(function (rows) {
      acc = acc.concat(rows);
      if (rows.length === 1000) return pullAll(tok, rows[rows.length - 1].server_ts, acc);
      return acc;
    });
  }
  function upd(c) { return Number(c && (c.updatedAt || c.createdAt)) || 0; }

  var running = false, again = false, timer = null;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(syncNow, ms == null ? 1500 : ms); }

  function syncNow() {
    if (!session()) { showStatus('동기화 꺼짐', false); return; }
    if (running) { again = true; return; }
    running = true;
    showStatus('동기화 중…', false);
    var tok;
    token().then(function (t) {
      tok = t;
      return pullAll(tok, lsGet(K_CURSOR), []);
    }).then(function (remote) {
      // 여기부터는 한 번에(중간에 입력이 끼어들지 않게) 합친다
      if (window.CRMApp) window.CRMApp.flush();
      var local = jget(KEY, {}), known = jget(K_KNOWN, {}), changed = false, cursor = lsGet(K_CURSOR);
      remote.forEach(function (r) {
        var l = local[r.id], lu = l ? upd(l) : -1, ru = Number(r.updated_at) || 0;
        if (r.deleted) {
          if (l && lu <= ru) { delete local[r.id]; changed = true; }
          if (!l || lu <= ru) delete known[r.id];
        } else if (!l) {
          // 이 기기에서 지운 고객인데, 다른 기기에서 그 뒤에 고쳤다면 되살린다
          if (known[r.id] == null || ru > known[r.id]) { local[r.id] = r.data; known[r.id] = ru; changed = true; }
        } else if (ru > lu) { local[r.id] = r.data; known[r.id] = ru; changed = true; }
        else if (ru === lu) known[r.id] = ru;
        if (!cursor || r.server_ts > cursor) cursor = r.server_ts;
      });
      var push = [];
      Object.keys(local).forEach(function (id) {
        var c = local[id];
        if (!c || typeof c !== 'object') return;
        if (!upd(c)) { c.updatedAt = Date.now(); changed = true; }
        if (known[id] !== upd(c)) push.push({ id: id, data: c, updated_at: upd(c), deleted: false });
      });
      Object.keys(known).forEach(function (id) {
        if (!local[id]) push.push({ id: id, data: {}, updated_at: Date.now(), deleted: true });
      });
      if (changed) { jset(KEY, local); if (window.CRMApp) window.CRMApp.reload(); }
      jset(K_KNOWN, known);
      if (cursor) lsSet(K_CURSOR, cursor);
      return pushBatches(tok, push, 0, known);
    }).then(function () {
      lsSet(K_LAST, String(Date.now()));
      var s = session();
      showStatus('동기화됨 ' + hhmm(Date.now()) + (s && s.email ? ' · ' + s.email : ''), false);
    }, function (e) {
      if (e.message === 'nologin') { showStatus('동기화: 다시 로그인해 주세요', true); openLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
      else if (e.message === 'offline' || /인터넷/.test(e.message)) {
        var last = Number(lsGet(K_LAST));
        showStatus('인터넷 연결 안 됨 · 이 기기에 저장됨' + (last ? ' (마지막 동기화 ' + hhmm(last) + ')' : ''), false);
      } else showStatus('동기화 실패: ' + e.message, true);
    }).then(function () {
      running = false;
      if (again) { again = false; schedule(500); }
    });
  }
  function pushBatches(tok, list, i, known) {
    if (i >= list.length) return Promise.resolve();
    var part = list.slice(i, i + 200);
    return api('POST', '?on_conflict=user_id,id', part, tok, 'resolution=merge-duplicates,return=minimal').then(function () {
      var k = jget(K_KNOWN, {});
      part.forEach(function (p) { if (p.deleted) delete k[p.id]; else k[p.id] = p.updated_at; });
      jset(K_KNOWN, k);
      return pushBatches(tok, list, i + 200, known);
    });
  }

  /* ---------- 언제 동기화하나 ---------- */
  // 1) 고객 목록이 바뀌어 저장될 때(1.5초 뒤)  2) 앱을 다시 볼 때  3) 인터넷이 다시 될 때  4) 켜져 있는 동안 30초마다
  var origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (!internal && k === KEY && this === window.localStorage) schedule();
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(0); });
  window.addEventListener('online', function () { schedule(0); });
  setInterval(function () { if (!document.hidden) syncNow(); }, 30000);

  if (session()) syncNow();
  else {
    showStatus('동기화 꺼짐', false);
    var later = false;
    try { later = sessionStorage.getItem('crm_sync_later') === '1'; } catch (e) { /* 무시 */ }
    if (!later) openLogin();
  }
})();
