/* 고객 상담 노트 - 앱 연결 파일
   일반 브라우저에서 열면 아무 일도 하지 않습니다(예전처럼 다운로드).
   안드로이드 앱(Capacitor)과 윈도우 프로그램(Electron)에서만
   - 백업 저장 / 엑셀로 저장: 실제 파일로 저장하고 저장 위치를 알려줌
   - 안드로이드 뒤로가기 버튼, 앱이 꺼지기 전 저장
   을 처리합니다. 외부 인터넷 통신은 전혀 하지 않습니다. */
(function () {
  'use strict';
  var FOLDER = '고객 상담 노트';
  var Cap = window.Capacitor;
  var isAndroid = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.getPlatform() === 'android');

  /* ---------- 윈도우 (Electron) ---------- */
  if (window.desktopBridge) {
    window.AppFiles = {
      save: function (name, text) {
        // 저장 창을 띄우고, 저장한 파일의 전체 경로를 돌려받는다(취소하면 null)
        return window.desktopBridge.saveFile(name, text);
      }
    };
    return;
  }

  if (!isAndroid) { setupWeb(); return; }

  /* ---------- 안드로이드 (Capacitor) ---------- */
  var P = Cap.Plugins;
  var FS = P.Filesystem, Share = P.Share, App = P.App;

  // 백업 불러오기: 카카오톡 등으로 받은 파일도 고를 수 있게 파일 종류 제한을 푼다(내용은 앱이 검사함)
  var fileEl = document.getElementById('file');
  if (fileEl) fileEl.removeAttribute('accept');

  function ensurePermission() {
    // 안드로이드 9 이하에서만 저장 권한을 묻는다. 10 이상은 권한 없이 '문서' 폴더에 저장된다.
    return FS.checkPermissions().then(function (st) {
      if (st.publicStorage === 'granted') return;
      return FS.requestPermissions().then(function (st2) {
        if (st2.publicStorage !== 'granted') throw new Error('파일 저장 권한을 허용해 주세요.');
      });
    });
  }

  function writeWithName(name, text, n) {
    var fname = n > 1 ? name.replace(/(\.[^.]+)$/, ' (' + n + ')$1') : name;
    return FS.writeFile({ path: FOLDER + '/' + fname, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true })
      .then(function (r) { return { uri: r.uri, fname: fname }; }, function (e) {
        // 같은 이름 파일을 앱을 다시 설치하기 전에 만들었다면 덮어쓸 수 없으므로 이름에 번호를 붙인다
        if (n >= 20) throw e;
        return writeWithName(name, text, n + 1);
      });
  }

  window.AppFiles = {
    save: function (name, text) {
      return ensurePermission().then(function () {
        return writeWithName(name, text, 1);
      }).then(function (r) {
        var where = '내 파일 > 문서(Documents) > ' + FOLDER + ' > ' + r.fname;
        var go = window.confirm('파일을 저장했습니다.\n\n저장 위치:\n' + where +
          '\n\n카카오톡이나 메일 등으로 PC에 보내려면 [확인]을 누르세요.\n보내지 않으려면 [취소]를 누르세요.');
        if (!go) return where;
        return Share.share({ title: r.fname, dialogTitle: '파일 보내기', files: [r.uri] })
          .then(function () { return where; }, function () { return where; });
      });
    }
  };

  // 뒤로가기 버튼: 입력 중이면 키보드 닫기 → 날짜별 연락이면 전체 고객으로 → 아니면 앱을 뒤로 보냄(종료 대신)
  App.addListener('backButton', function () {
    var a = document.activeElement;
    if (a && a !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.blur(); return; }
    if (window.CRMApp && window.CRMApp.view() === 'date') { window.CRMApp.showAll(); return; }
    if (window.CRMApp) window.CRMApp.flush();
    App.minimizeApp();
  });

  // 앱이 뒤로 가거나 꺼지기 전에 입력 중인 내용을 바로 저장
  App.addListener('pause', function () { if (window.CRMApp) window.CRMApp.flush(); });

  /* ---------- 웹 (아이폰 "홈 화면에 추가", 일반 브라우저) ---------- */
  function setupWeb() {
    // 인터넷 주소(https)로 열었을 때만: 화면 파일을 폰에 보관해 인터넷 없이도 열리게 함
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 무시: 없어도 화면은 동작 */ });
    }

    var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return; // PC·안드로이드 브라우저는 예전처럼 다운로드

    // 백업 불러오기: 카카오톡 등으로 받은 파일도 고를 수 있게 파일 종류 제한을 푼다
    var f = document.getElementById('file');
    if (f) f.removeAttribute('accept');

    // 아이폰 홈 화면 앱에서는 다운로드가 잘 안 되므로 "공유" 화면으로 저장한다
    // (공유 화면에서 "파일에 저장" → 나의 iPhone, 또는 카카오톡으로 보내기)
    if (!navigator.share || !window.File) return;
    window.AppFiles = {
      save: function (name, text, type) {
        var file = new File([text], name, { type: (type || 'text/plain').split(';')[0] });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          file = new File([text], name, { type: 'text/plain' });
        }
        return navigator.share({ files: [file] }).then(function () {
          return '공유 화면에서 고른 곳 (파일 앱에 저장했다면: 파일 → 나의 iPhone)';
        }, function (e) {
          if (e && e.name === 'AbortError') return null; // 사용자가 취소함
          throw new Error('공유 화면을 열지 못했습니다.');
        });
      }
    };
  }
})();
