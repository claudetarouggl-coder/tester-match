// テスターマッチ SPA — vanilla JS, no framework, no build step.
(function(){
"use strict";

var supa = null;
var configOK = false;
var authUser = null;    // supabase auth user object, or null
var authProfile = null; // {id, handle, credits}, or null

// ---- dom helpers ----
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }
function ce(tag, opts){
  var el = document.createElement(tag);
  if(opts){
    if(opts.cls) el.className = opts.cls;
    if(opts.text !== undefined) el.textContent = opts.text;
    if(opts.attrs) for(var k in opts.attrs){ if(opts.attrs.hasOwnProperty(k)) el.setAttribute(k, opts.attrs[k]); }
    if(opts.on) for(var ev in opts.on){ if(opts.on.hasOwnProperty(ev)) el.addEventListener(ev, opts.on[ev]); }
  }
  return el;
}
function viewRoot(){ return document.getElementById("view"); }
function toast(msg, isErr){
  var t = ce("div", {cls: "toast" + (isErr ? " err" : ""), text: msg});
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 3500);
}
function pad2(n){ return n < 10 ? "0" + n : "" + n; }
function formatDate(iso){
  if(!iso) return "";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return iso;
  return d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate());
}
function statusLabel(s){
  var m = {joined: "参加中", confirmed: "確認済み", dropped: "辞退"};
  return m[s] || s;
}
function loginRequired(){
  var box = ce("div", {cls: "card"});
  box.appendChild(ce("p", {text: "この機能を使うにはログインが必要です"}));
  box.appendChild(ce("a", {cls: "btn", text: "ログインする", attrs: {href: "#/login"}}));
  return box;
}
function setupBanner(){
  return ce("div", {cls: "setup-banner", text: "準備中です。Supabaseの設定が完了するまでお待ちください。"});
}
function emptyState(msg, ctaText, ctaHref){
  var box = ce("div", {cls: "empty-state"});
  box.appendChild(ce("p", {text: msg}));
  if(ctaText && ctaHref) box.appendChild(ce("a", {cls: "btn", text: ctaText, attrs: {href: ctaHref}}));
  return box;
}

// ---- router ----
function currentRoute(){
  var hash = location.hash.replace(/^#/, "") || "/";
  var m;
  if(hash === "/") return {name: "home"};
  if((m = hash.match(/^\/app\/([^\/]+)$/))) return {name: "app", id: decodeURIComponent(m[1])};
  if(hash === "/post") return {name: "post"};
  if(hash === "/me") return {name: "me"};
  if(hash === "/login") return {name: "login"};
  return {name: "home"};
}
function render(){
  var root = viewRoot();
  if(!root) return;
  clear(root);
  if(!configOK){ root.appendChild(setupBanner()); return; }
  var route = currentRoute();
  document.body.classList.toggle("route-sub", route.name !== "home");
  if(route.name === "home") renderHome(root);
  else if(route.name === "app") renderAppDetail(root, route.id);
  else if(route.name === "post") renderPost(root);
  else if(route.name === "me") renderMe(root);
  else if(route.name === "login") renderLogin(root);
}

// ---- home: list ----
var APP_COLUMNS = "id,owner,name,package_id,description,testers_needed,joined_count,status,created_at";

function appCard(a){
  var card = ce("div", {cls: "card"});
  var head = ce("div", {cls: "card-head"});
  head.appendChild(ce("h3", {text: a.name}));
  head.appendChild(ce("span", {cls: "badge " + a.status, text: a.status === "recruiting" ? "募集中" : "終了"}));
  card.appendChild(head);
  card.appendChild(ce("div", {cls: "pkg", text: a.package_id}));
  var desc = a.description || "";
  var truncated = desc.length > 120 ? desc.slice(0, 120) + "…" : desc;
  card.appendChild(ce("div", {cls: "card-desc", text: truncated}));
  var pct = a.testers_needed > 0 ? Math.min(100, Math.round(a.joined_count / a.testers_needed * 100)) : 0;
  var prog = ce("div", {cls: "progress"});
  prog.appendChild(ce("div", {cls: "progress-bar", attrs: {style: "width:" + pct + "%"}}));
  card.appendChild(prog);
  card.appendChild(ce("div", {cls: "meta", text: a.joined_count + " / " + a.testers_needed + " 人"}));
  var wrap = ce("div", {attrs: {style: "margin-top:.9rem"}});
  wrap.appendChild(ce("a", {cls: "btn", text: "詳細を見る", attrs: {href: "#/app/" + encodeURIComponent(a.id)}}));
  card.appendChild(wrap);
  return card;
}

function renderHome(root){
  var hero = ce("div", {cls: "hero"});
  hero.appendChild(ce("h1", {text: "Google Playのクローズドテスト、テスターをお互いに集め合う"}));
  hero.appendChild(ce("p", {cls: "lead", text: "「12人のテスターが14日間オプトインを継続」というクローズドテストの条件を、同じ課題を抱える開発者同士でテスターを出し合ってクリアしましょう。"}));
  var heroActions = ce("div", {cls: "hero-actions"});
  heroActions.appendChild(ce("a", {cls: "btn", text: "無料で始める", attrs: {href: "#/login"}}));
  heroActions.appendChild(ce("a", {cls: "btn secondary", text: "仕組みを見る", attrs: {href: "guide/"}}));
  hero.appendChild(heroActions);
  root.appendChild(hero);

  root.appendChild(ce("h2", {text: "募集中のアプリ"}));
  var list = ce("div", {cls: "app-grid"});
  list.appendChild(ce("p", {cls: "small", text: "読み込み中…"}));
  root.appendChild(list);
  supa.from("apps").select(APP_COLUMNS).eq("status", "recruiting").order("created_at", {ascending: false})
    .then(function(res){
      clear(list);
      if(res.error){
        list.appendChild(ce("p", {cls: "small", text: "読み込みに失敗しました"}));
        toast("読み込みエラー: " + res.error.message, true);
        return;
      }
      var rows = res.data || [];
      if(rows.length === 0){
        list.appendChild(emptyState("まだ掲載がありません。最初のアプリを掲載してみましょう", "アプリを掲載する", "#/post"));
        return;
      }
      for(var i = 0; i < rows.length; i++) list.appendChild(appCard(rows[i]));
    });
}

// ---- app detail ----
function renderAppDetail(root, id){
  root.appendChild(ce("p", {cls: "small", text: "読み込み中…"}));
  supa.from("apps").select(APP_COLUMNS).eq("id", id).single().then(function(res){
    clear(root);
    if(res.error || !res.data){
      root.appendChild(ce("p", {text: "アプリが見つかりません"}));
      return;
    }
    var a = res.data;
    var overview = ce("div", {cls: "card"});
    var head = ce("div", {cls: "card-head"});
    head.appendChild(ce("h1", {text: a.name}));
    head.appendChild(ce("span", {cls: "badge " + a.status, text: a.status === "recruiting" ? "募集中" : "終了"}));
    overview.appendChild(head);
    overview.appendChild(ce("div", {cls: "pkg", text: a.package_id}));
    overview.appendChild(ce("p", {cls: "desc", text: a.description}));
    var pct = a.testers_needed > 0 ? Math.min(100, Math.round(a.joined_count / a.testers_needed * 100)) : 0;
    var prog = ce("div", {cls: "progress"});
    prog.appendChild(ce("div", {cls: "progress-bar", attrs: {style: "width:" + pct + "%"}}));
    overview.appendChild(prog);
    overview.appendChild(ce("div", {cls: "meta", text: a.joined_count + " / " + a.testers_needed + " 人"}));
    root.appendChild(overview);

    var actions = ce("div", {cls: "section"});
    root.appendChild(actions);

    if(!authUser){
      actions.appendChild(ce("p", {cls: "small", text: "参加するにはログインが必要です"}));
      actions.appendChild(ce("a", {cls: "btn", text: "ログインする", attrs: {href: "#/login"}}));
      return;
    }
    var uid = authUser.id;
    if(a.owner === uid){
      showSecrets(actions, a.id);
      return;
    }
    supa.from("joins").select("id,status").eq("app_id", a.id).eq("tester", uid).then(function(jres){
      if(jres.error){ toast("確認エラー: " + jres.error.message, true); return; }
      var joined = jres.data && jres.data.length > 0;
      if(joined){
        showSecrets(actions, a.id);
      } else if(a.status !== "recruiting"){
        actions.appendChild(ce("p", {cls: "small", text: "このアプリは募集を終了しています"}));
      } else {
        renderJoinForm(actions, a.id);
      }
    });
  });
}

function showSecrets(box, appId){
  clear(box);
  box.appendChild(ce("p", {cls: "small", text: "参加情報を読み込み中…"}));
  supa.rpc("get_app_secrets", {p_app: appId}).then(function(res){
    clear(box);
    var row = res.data && res.data.length ? res.data[0] : (res.data && !Array.isArray(res.data) ? res.data : null);
    if(res.error || !row){
      box.appendChild(ce("p", {cls: "small", text: "参加情報を取得できませんでした"}));
      return;
    }
    var card = ce("div", {cls: "card"});
    card.appendChild(ce("h2", {text: "参加方法"}));
    var ol = ce("ol");
    ol.appendChild(ce("li", {text: "①グループに参加する（下記の参加手順を参照）"}));
    var li2 = ce("li");
    li2.appendChild(document.createTextNode("②opt-inリンクでテスターになる: "));
    li2.appendChild(ce("a", {text: row.opt_in_url, attrs: {href: row.opt_in_url, target: "_blank", rel: "noopener"}}));
    ol.appendChild(li2);
    ol.appendChild(ce("li", {text: "③Playストアからインストールして指定の日数使う"}));
    card.appendChild(ol);
    card.appendChild(ce("h3", {text: "グループ参加情報"}));
    card.appendChild(ce("p", {cls: "desc", text: row.group_join_info || ""}));
    box.appendChild(card);
  });
}

function renderJoinForm(box, appId){
  clear(box);
  var card = ce("div", {cls: "card"});
  var startBtn = ce("button", {text: "テスターとして参加する"});
  card.appendChild(startBtn);
  box.appendChild(card);
  startBtn.addEventListener("click", function(){
    clear(card);
    var form = ce("form");
    form.appendChild(ce("label", {text: "Googleメールアドレス（Playで使うアカウント）"}));
    var input = ce("input", {attrs: {type: "email", required: "required", placeholder: "you@gmail.com"}});
    form.appendChild(input);
    form.appendChild(ce("p", {cls: "hint", text: "このメールは開発者にのみ開示されます"}));
    var submit = ce("button", {attrs: {type: "submit"}, text: "参加する"});
    form.appendChild(submit);
    card.appendChild(form);
    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      submit.disabled = true;
      supa.from("joins").insert({app_id: appId, tester: authUser.id, google_email: input.value}).then(function(res){
        if(res.error){
          toast("参加に失敗しました: " + res.error.message, true);
          submit.disabled = false;
          return;
        }
        toast("参加しました");
        showSecrets(box, appId);
      });
    });
  });
}

// ---- post ----
function renderPost(root){
  if(!authUser){ root.appendChild(loginRequired()); return; }
  root.appendChild(ce("h1", {text: "アプリを掲載する"}));
  root.appendChild(ce("p", {cls: "small", text: "オープンβ期間中は掲載無料です"}));
  var card = ce("div", {cls: "card"});
  var form = ce("form");
  function field(labelText, tag, attrs, hint){
    form.appendChild(ce("label", {text: labelText}));
    var input = ce(tag, {attrs: attrs});
    form.appendChild(input);
    if(hint) form.appendChild(ce("p", {cls: "hint", text: hint}));
    return input;
  }
  var nameInput = field("アプリ名", "input", {type: "text", required: "required", maxlength: "80", placeholder: "例: マイタスク管理"});
  var pkgInput = field("パッケージID", "input", {type: "text", required: "required", placeholder: "com.example.app"}, "例: com.example.app");
  var optInInput = field("opt-in URL", "input", {type: "url", required: "required", placeholder: "https://play.google.com/apps/testing/..."}, "Play Consoleのクローズドテストopt-inリンク");
  var groupInput = field("グループ参加手順", "textarea", {required: "required", rows: "4", placeholder: "例: 下記のGoogleグループに参加申請してください → https://groups.google.com/..."}, "Googleグループの参加手順やURLを記載してください");
  var descInput = field("アプリの説明", "textarea", {required: "required", rows: "4", maxlength: "2000", placeholder: "例: シンプルなToDoアプリです。オフラインでも使えます。"});
  var needInput = field("募集人数", "input", {type: "number", min: "1", max: "100", value: "12", required: "required"});
  var submit = ce("button", {attrs: {type: "submit"}, text: "掲載する"});
  form.appendChild(submit);
  card.appendChild(form);
  root.appendChild(card);
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    submit.disabled = true;
    supa.from("apps").insert({
      owner: authUser.id,
      name: nameInput.value,
      package_id: pkgInput.value,
      opt_in_url: optInInput.value,
      group_join_info: groupInput.value,
      description: descInput.value,
      testers_needed: parseInt(needInput.value, 10) || 12
    }).then(function(res){
      if(res.error){
        toast("掲載に失敗しました: " + res.error.message, true);
        submit.disabled = false;
        return;
      }
      toast("掲載しました");
      location.hash = "#/me";
    });
  });
}

// ---- me ----
function renderMe(root){
  if(!authUser){ root.appendChild(loginRequired()); return; }
  root.appendChild(ce("h1", {text: "マイページ"}));

  var profSec = ce("div", {cls: "section"});
  profSec.appendChild(ce("h2", {text: "プロフィール"}));
  var profCard = ce("div", {cls: "card"});
  var handleRow = ce("div", {cls: "list-row"});
  handleRow.appendChild(ce("span", {text: authProfile ? authProfile.handle : "..."}));
  var editBtn = ce("button", {cls: "secondary", text: "変更"});
  handleRow.appendChild(editBtn);
  editBtn.addEventListener("click", function(){ startHandleEdit(handleRow); });
  profCard.appendChild(handleRow);

  var creditsP = ce("p", {cls: "stat"});
  creditsP.appendChild(ce("span", {cls: "n", text: authProfile ? String(authProfile.credits) : "-"}));
  creditsP.appendChild(document.createTextNode(" クレジット"));
  profCard.appendChild(creditsP);

  profCard.appendChild(ce("h3", {text: "直近のクレジット履歴"}));
  var eventsList = ce("div");
  eventsList.appendChild(ce("p", {cls: "small", text: "読み込み中…"}));
  profCard.appendChild(eventsList);
  profSec.appendChild(profCard);
  root.appendChild(profSec);

  supa.from("credit_events").select("delta,source,created_at").order("created_at", {ascending: false}).limit(10)
    .then(function(res){
      clear(eventsList);
      if(res.error){ eventsList.appendChild(ce("p", {cls: "small", text: "履歴を取得できませんでした"})); return; }
      var rows = res.data || [];
      if(rows.length === 0){ eventsList.appendChild(ce("p", {cls: "small", text: "履歴はありません"})); return; }
      for(var i = 0; i < rows.length; i++){
        var e = rows[i];
        eventsList.appendChild(ce("div", {cls: "meta", text: (e.delta >= 0 ? "+" : "") + e.delta + " " + e.source + " " + formatDate(e.created_at)}));
      }
    });

  var appsSec = ce("div", {cls: "section"});
  appsSec.appendChild(ce("h2", {text: "掲載したアプリ"}));
  var appsList = ce("div");
  appsList.appendChild(ce("p", {cls: "small", text: "読み込み中…"}));
  appsSec.appendChild(appsList);
  root.appendChild(appsSec);

  supa.from("apps").select(APP_COLUMNS).eq("owner", authUser.id).order("created_at", {ascending: false})
    .then(function(res){
      clear(appsList);
      if(res.error){ appsList.appendChild(ce("p", {cls: "small", text: "取得に失敗しました"})); return; }
      var rows = res.data || [];
      if(rows.length === 0){ appsList.appendChild(emptyState("まだ掲載したアプリはありません。最初のアプリを掲載してみましょう", "アプリを掲載する", "#/post")); return; }
      for(var i = 0; i < rows.length; i++) appsList.appendChild(myAppCard(rows[i]));
    });

  var joinsSec = ce("div", {cls: "section"});
  joinsSec.appendChild(ce("h2", {text: "参加中のテスト"}));
  var joinsList = ce("div");
  joinsList.appendChild(ce("p", {cls: "small", text: "読み込み中…"}));
  joinsSec.appendChild(joinsList);
  root.appendChild(joinsSec);

  supa.from("joins").select("id,app_id,status,joined_at").eq("tester", authUser.id).order("joined_at", {ascending: false})
    .then(function(res){
      clear(joinsList);
      if(res.error){ joinsList.appendChild(ce("p", {cls: "small", text: "取得に失敗しました"})); return; }
      var rows = res.data || [];
      if(rows.length === 0){ joinsList.appendChild(emptyState("まだ参加中のテストはありません。気になるアプリを探してみましょう", "アプリを探す", "#/")); return; }
      var ids = [];
      for(var i = 0; i < rows.length; i++){ if(ids.indexOf(rows[i].app_id) === -1) ids.push(rows[i].app_id); }
      supa.from("apps").select("id,name").in("id", ids).then(function(ares){
        var nameById = {};
        if(!ares.error && ares.data){
          for(var k = 0; k < ares.data.length; k++) nameById[ares.data[k].id] = ares.data[k].name;
        }
        for(var j = 0; j < rows.length; j++) joinsList.appendChild(myJoinRow(rows[j], nameById[rows[j].app_id] || "(不明なアプリ)"));
      });
    });

  var logoutBtn = ce("button", {cls: "secondary", text: "ログアウト"});
  logoutBtn.addEventListener("click", function(){ supa.auth.signOut(); });
  root.appendChild(logoutBtn);
}

function startHandleEdit(handleRow){
  clear(handleRow);
  var input = ce("input", {attrs: {type: "text", value: authProfile ? authProfile.handle : "", maxlength: "40"}});
  handleRow.appendChild(input);
  var saveBtn = ce("button", {text: "保存"});
  handleRow.appendChild(saveBtn);
  saveBtn.addEventListener("click", function(){
    saveBtn.disabled = true;
    supa.from("profiles").update({handle: input.value}).eq("id", authUser.id).then(function(res){
      if(res.error){
        var msg = /duplicate|unique/i.test(res.error.message || "") ? "そのハンドルは既に使われています" : "更新に失敗しました: " + res.error.message;
        toast(msg, true);
        saveBtn.disabled = false;
        return;
      }
      authProfile = authProfile || {};
      authProfile.handle = input.value;
      toast("更新しました");
      updateNav();
      render();
    });
  });
}

function myAppCard(a){
  var card = ce("div", {cls: "card"});
  var head = ce("div", {cls: "card-head"});
  head.appendChild(ce("h3", {text: a.name}));
  head.appendChild(ce("span", {cls: "badge " + a.status, text: a.status === "recruiting" ? "募集中" : "終了"}));
  card.appendChild(head);
  card.appendChild(ce("div", {cls: "pkg", text: a.package_id}));
  card.appendChild(ce("div", {cls: "meta", text: a.joined_count + " / " + a.testers_needed + " 人"}));
  if(a.status === "recruiting"){
    var closeBtn = ce("button", {cls: "secondary", text: "募集終了"});
    closeBtn.addEventListener("click", function(){
      closeBtn.disabled = true;
      supa.from("apps").update({status: "closed"}).eq("id", a.id).then(function(res){
        if(res.error){ toast("更新に失敗しました: " + res.error.message, true); closeBtn.disabled = false; return; }
        toast("募集を終了しました");
        render();
      });
    });
    card.appendChild(closeBtn);
  }
  var joinsBox = ce("div", {attrs: {style: "margin-top:.6rem"}});
  joinsBox.appendChild(ce("p", {cls: "small", text: "参加者を読み込み中…"}));
  card.appendChild(joinsBox);
  supa.from("joins").select("id,tester,google_email,status,joined_at").eq("app_id", a.id).then(function(res){
    clear(joinsBox);
    if(res.error){ joinsBox.appendChild(ce("p", {cls: "small", text: "参加者を取得できませんでした"})); return; }
    var rows = res.data || [];
    if(rows.length === 0){ joinsBox.appendChild(ce("p", {cls: "small", text: "まだ参加者はいません"})); return; }
    for(var i = 0; i < rows.length; i++) joinsBox.appendChild(joinRow(rows[i]));
  });
  return card;
}

function joinRow(j){
  var row = ce("div", {cls: "list-row"});
  row.appendChild(ce("div", {text: j.google_email}));
  row.appendChild(ce("span", {cls: "badge " + j.status, text: statusLabel(j.status)}));
  row.appendChild(ce("div", {cls: "meta", text: "参加日: " + formatDate(j.joined_at)}));
  if(j.status === "joined"){
    var joinedAt = new Date(j.joined_at);
    var readyAt = new Date(joinedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    var now = new Date();
    var confirmBtn = ce("button", {text: "確認"});
    if(now < readyAt){
      var daysLeft = Math.max(1, Math.ceil((readyAt - now) / (24 * 60 * 60 * 1000)));
      confirmBtn.disabled = true;
      var hint = "参加から14日経過後に確認できます（あと" + daysLeft + "日）";
      confirmBtn.title = hint;
      row.appendChild(confirmBtn);
      row.appendChild(ce("p", {cls: "hint", text: hint}));
    } else {
      confirmBtn.addEventListener("click", function(){
        confirmBtn.disabled = true;
        supa.rpc("confirm_tester", {p_join: j.id}).then(function(res){
          if(res.error){ toast("確認に失敗しました: " + res.error.message, true); confirmBtn.disabled = false; return; }
          if(res.data === "not_confirmed"){
            toast("まだ確認できません（14日未満、または確認済みの可能性があります）", true);
            confirmBtn.disabled = false;
            return;
          }
          toast("確認しました");
          render();
        });
      });
      row.appendChild(confirmBtn);
    }
  }
  return row;
}

function myJoinRow(j, appName){
  var row = ce("div", {cls: "card"});
  var titleRow = ce("div");
  titleRow.appendChild(ce("a", {text: appName, attrs: {href: "#/app/" + encodeURIComponent(j.app_id)}}));
  row.appendChild(titleRow);
  row.appendChild(ce("span", {cls: "badge " + j.status, text: statusLabel(j.status)}));
  row.appendChild(ce("div", {cls: "meta", text: "参加日: " + formatDate(j.joined_at)}));
  if(j.status === "joined"){
    var dropBtn = ce("button", {cls: "danger", text: "辞退する"});
    dropBtn.addEventListener("click", function(){
      dropBtn.disabled = true;
      supa.from("joins").delete().eq("id", j.id).then(function(res){
        if(res.error){ toast("辞退に失敗しました: " + res.error.message, true); dropBtn.disabled = false; return; }
        toast("辞退しました");
        render();
      });
    });
    row.appendChild(dropBtn);
  }
  return row;
}

// ---- login ----
function renderLogin(root){
  root.appendChild(ce("h1", {text: "ログイン"}));
  root.appendChild(ce("p", {cls: "small", text: "テスト参加に使うGoogleアカウントでのログインを推奨します。参加登録時にこのアカウントのメールアドレスを使うと管理が簡単です。"}));
  var authCard = ce("div", {cls: "auth-card"});

  var gBtn = ce("button", {cls: "btn-provider"});
  gBtn.appendChild(ce("span", {cls: "provider-icon", text: "G"}));
  gBtn.appendChild(document.createTextNode("Googleでログイン"));
  gBtn.addEventListener("click", function(){
    supa.auth.signInWithOAuth({provider: "google", options: {redirectTo: location.origin + location.pathname}});
  });
  authCard.appendChild(gBtn);

  var hBtn = ce("button", {cls: "btn-provider"});
  hBtn.appendChild(ce("span", {cls: "provider-icon", text: "gh"}));
  hBtn.appendChild(document.createTextNode("GitHubでログイン"));
  hBtn.addEventListener("click", function(){
    supa.auth.signInWithOAuth({provider: "github", options: {redirectTo: location.origin + location.pathname}});
  });
  authCard.appendChild(hBtn);

  root.appendChild(authCard);
}

// ---- nav / auth bootstrap ----
function updateNav(){
  var a = document.getElementById("nav-auth");
  if(!a) return;
  if(authUser){
    a.textContent = authProfile ? authProfile.handle : (authUser.email || "ログイン中");
    a.setAttribute("href", "#/me");
  } else {
    a.textContent = "ログイン";
    a.setAttribute("href", "#/login");
  }
}

function loadProfile(retry){
  supa.from("profiles").select("id,handle,credits").eq("id", authUser.id).single().then(function(res){
    if(res.error || !res.data){
      if(!retry){ setTimeout(function(){ loadProfile(true); }, 1000); return; }
      authProfile = null;
    } else {
      authProfile = res.data;
    }
    updateNav();
    render();
  });
}

function initGA(){
  var id = (window.TM_CONFIG || {}).GA_ID;
  if(!id) return;
  var s1 = document.createElement("script");
  s1.async = true;
  s1.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s1);
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", id);
}

function initSupabase(){
  var cfg = window.TM_CONFIG || {};
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL === "__FILL_ME__" || cfg.SUPABASE_ANON_KEY === "__FILL_ME__"){
    configOK = false;
    return;
  }
  configOK = true;
  supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

function init(){
  initSupabase();
  initGA();
  window.addEventListener("hashchange", render);
  if(!configOK){ render(); return; }
  supa.auth.onAuthStateChange(function(event, session){
    authUser = session ? session.user : null;
    if(authUser){ loadProfile(); } else { authProfile = null; updateNav(); render(); }
  });
  supa.auth.getSession().then(function(res){
    var session = res && res.data ? res.data.session : null;
    authUser = session ? session.user : null;
    if(authUser){ loadProfile(); } else { updateNav(); render(); }
  });
}

// test hook: lets a headless test drive the app without touching Supabase network calls.
window.TM_APP = {
  render: render,
  esc: esc,
  setState: function(s){
    if("authUser" in s) authUser = s.authUser;
    if("authProfile" in s) authProfile = s.authProfile;
    if("supa" in s){ supa = s.supa; configOK = true; }
    if("configOK" in s) configOK = s.configOK;
  },
  getState: function(){ return {authUser: authUser, authProfile: authProfile, configOK: configOK}; }
};

init();
})();
