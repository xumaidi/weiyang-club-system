(function() {
  'use strict';
  const {Client, Timeline, escapeHTML: esc} = ClubAPI;
  const $ = id => document.getElementById(id);
  const labels = {president:'社长',presidium:'主席团',minister:'部长',member:'成员'};
  const stored = (store,key,fallback='') => { try { return store.getItem(key)||fallback; } catch { return fallback; } };
  const remember = (store,key,value) => { try { value ? store.setItem(key,value) : store.removeItem(key); } catch {} };
  function newClient(options) {
    const instance=new Client({...options,onUnauthorized:()=>{ if(api===instance) expire(); }});
    return instance;
  }
  let api = newClient({base:stored(localStorage,'club.apiBase','http://127.0.0.1:18081'),token:stored(sessionStorage,'club.token')});
  let user=null, session=0, assetVersion=0, contactVersion=0, chatVersion=0, timer=null, chatAbort=null;
  let assets={items:[],total:0,page:1,size:20}, apps={items:[],total:0,page:1,size:20};
  const assetNames=new Map();
  let assetError='', appError='', assetLoading=false, contacts={items:[],total:0,page:1,size:20}, contactSearch='', contactError='', contactsLoading=false;
  let active=null, conversation=null, timeline=new Timeline(), chatLoading=false, chatError='', sending=false, olderLoading=false, uncertain=false, draft='', pollBusy=false;
  const fieldClass='w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30';
  const button=(label,action,extra='')=>`<button type="button" data-club="${action}" ${extra} class="px-3.5 py-2 text-sm rounded-xl border border-zinc-200 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed">${label}</button>`;
  const empty=text=>`<p class="p-8 text-center text-sm text-zinc-500">${esc(text)}</p>`;
  const errorBox=(text,action='')=>text?`<div role="alert" class="p-3 my-3 border border-red-300 rounded-xl text-sm text-red-500">${esc(text)} ${action?button('重试',action):''}</div>`:'';
  const date=value=>{ const d=new Date(value); return Number.isNaN(d.valueOf())?'—':d.toLocaleString('zh-CN',{hour12:false}); };
  const lead=()=>user && ['president','presidium'].includes(user.role);
  const status=value=>({pending:['待审批','amber'],approved:['已同意','green'],rejected:['已驳回','rose']}[value]||[value,'zinc']);
  function pager(data,action) {
    const pages=Math.max(1,Math.ceil(data.total/data.size));
    return `<div class="flex items-center justify-between gap-2 p-4 text-xs text-zinc-500"><span>共 ${data.total} 条 · 第 ${data.page} / ${pages} 页</span><div class="flex gap-2">${button('上一页',action,`data-page="${data.page-1}" ${data.page<=1?'disabled':''}`)}${button('下一页',action,`data-page="${data.page+1}" ${data.page>=pages?'disabled':''}`)}</div></div>`;
  }
  function gate() { return pageHead('连接真实后端','M7 资产与 M8 沟通需要使用真实账号登录。','')+empty('当前为界面演示，请退出演示后用学号与密码登录。'); }
  function stopChat() { chatVersion++; clearTimeout(timer); timer=null; chatAbort?.abort(); chatAbort=null; pollBusy=false; }
  function reset() {
    session++; assetVersion++; contactVersion++; stopChat();
    user=null; active=null; conversation=null; draft=''; timeline=new Timeline(); sending=false; olderLoading=false; uncertain=false;
    assets={items:[],total:0,page:1,size:20}; apps={items:[],total:0,page:1,size:20}; contacts={items:[],total:0,page:1,size:20};
    assetError=''; appError=''; contactError=''; chatError=''; contactSearch=''; assetLoading=false; contactsLoading=false;
    assetNames.clear();
  }
  function loginNotice(text) { const el=$('clubLoginError'); if(el) el.textContent=text; }
  function showLogin(text='') {
    $('appView').classList.add('is-hidden'); $('loginView').classList.remove('is-hidden');
    state.role=null; state.page=null; closeModal(); setupLogin(); loginNotice(text);
  }
  function expire() {
    api.token=''; remember(sessionStorage,'club.token',''); reset(); showLogin('登录已失效，请重新登录');
  }
  function identity() {
    const key=['president','presidium'].includes(user.role)?'president':user.role;
    ROLES[key]={...ROLES[key],user:esc(user.name),post:labels[user.role],short:labels[user.role],label:labels[user.role],dept:'',mail:esc(user.student_id)};
    return key;
  }
  const originalSidebar=renderSidebar, originalHeader=renderHeader, originalGo=go, originalLogin=login, originalRenderMain=renderMain;
  function realAvatar(container) {
    const image=container?.querySelector('img'); if(!image) return;
    const initial=document.createElement('span'); initial.className='w-9 h-9 shrink-0 rounded-xl bg-blue-50 text-blue-400 flex items-center justify-center';
    initial.textContent=user.name.slice(0,1); image.replaceWith(initial);
  }
  renderHeader=function() {
    originalHeader();
    $('bellIcon').closest('button').hidden=!!user;
    if(!user) return;
    realAvatar($('headerUser'));
  };
  login=function(role) {
    if(user) return enter();
    session++; originalLogin(role);
  };
  renderMain=function() {
    const body=$('clubChatBody'), top=body?.scrollTop, nearBottom=body && body.scrollHeight-body.scrollTop-body.clientHeight<100;
    originalRenderMain();
    const next=$('clubChatBody');
    if(next && top!==undefined) next.scrollTop=nearBottom?next.scrollHeight:top;
  };
  renderSidebar=function() {
    if (!user) return originalSidebar();
    const key=state.role, old=NAV[key];
    NAV[key]=[{group:'社团协作',items:[{key:'assets',label:'资产管理',icon:'box'},{key:'messages',label:'沟通中心',icon:'chat'}]}];
    try {
      originalSidebar(); realAvatar($('sideFoot'));
      $('nav').querySelectorAll('a').forEach(link=>link.setAttribute('aria-label',link.textContent.trim()));
    } finally { NAV[key]=old; }
  };
  go=function(page,params) {
    if (user && !['assets','messages'].includes(page)) page='assets';
    if (state.page!==page) { stopChat(); active=null; conversation=null; draft=''; }
    originalGo(page,params);
    if(user && page==='assets') loadAssets();
    if(user && page==='messages') loadContacts();
  };
  function enter() {
    if(!labels[user.role]) { expire(); loginNotice('该账号角色暂不支持'); return; }
    if(user.must_change_password) return showChangePassword();
    state.role=identity(); state.page='assets'; state.params={};
    $('loginView').classList.add('is-hidden'); $('appView').classList.remove('is-hidden');
    render(); loadAssets();
  }
  logout=async function() {
    const oldAPI=api, hadUser=!!user;
    oldAPI.onUnauthorized=()=>{};
    api=newClient({base:oldAPI.base});
    remember(sessionStorage,'club.token',''); reset(); showLogin();
    if(hadUser) { try { await oldAPI.logout(); } catch { loginNotice('本地已退出；服务端退出失败，原凭证可能仍有效至到期'); } }
  };
  function setupLogin() {
    const form=$('loginView').querySelector('form');
    form.removeAttribute('onsubmit'); form.id='clubLoginForm';
    form.innerHTML=`<div><label for="clubStudent" class="block text-sm mb-1.5">学号</label><input id="clubStudent" name="student_id" autocomplete="username" required maxlength="32" class="${fieldClass}"></div>
      <div><label for="clubPassword" class="block text-sm mb-1.5">密码</label><input id="clubPassword" name="password" type="password" autocomplete="current-password" required class="${fieldClass}"></div>
      <details><summary class="text-xs text-zinc-500 cursor-pointer">后端连接设置</summary><label for="clubBase" class="block text-xs mt-3 mb-1">后端地址</label><input id="clubBase" type="url" required value="${esc(api.base)}" class="${fieldClass}"><p class="mt-2 text-xs text-zinc-500">填写服务地址，例如 http://127.0.0.1:18081</p></details>
      <div id="clubLoginError" role="alert" class="text-sm text-red-500"></div><div id="clubUnlock"></div>
      <button type="submit" class="w-full py-2.5 rounded-xl bg-ink-900 text-white text-sm font-medium">登录</button>`;
    form.onsubmit=async event=>{
      event.preventDefault(); const submit=form.querySelector('[type=submit]'); if(submit.disabled) return;
      submit.disabled=true; submit.textContent='正在登录…'; loginNotice('');
      try {
        api=newClient({base:$('clubBase').value});
        const result=await api.login($('clubStudent').value.trim(),$('clubPassword').value);
        api.token=result.token; user=result.user; session++;
        remember(localStorage,'club.apiBase',api.base); remember(sessionStorage,'club.token',api.token);
        $('clubPassword').value=''; enter();
      } catch(error) {
        loginNotice(error.message);
        if(error.status===423 && error.data?.captcha) {
          const account=$('clubStudent').value.trim(), unlockToken=error.data.captcha.token;
          $('clubUnlock').innerHTML=`<label for="clubSlider" class="text-sm">拖动滑块至最右侧解除锁定</label><input id="clubSlider" type="range" min="0" max="100" value="0" class="w-full" aria-label="解锁滑块">${button('解除锁定','unlock')}`;
          $('clubUnlock').querySelector('button').onclick=async()=>{
            try { await api.request('/login/unlock',{method:'POST',auth:false,body:{student_id:account,token:unlockToken,value:Number($('clubSlider').value)}}); $('clubUnlock').innerHTML=''; loginNotice('已解除锁定，请重新登录'); } catch(e) { loginNotice(e.message); }
          };
        }
      } finally { submit.disabled=false; submit.textContent='登录'; }
    };
  }
  function showChangePassword() {
    $('appView').classList.add('is-hidden'); $('loginView').classList.remove('is-hidden');
    const form=$('loginView').querySelector('form');
    form.innerHTML=`<p class="text-sm text-zinc-500">首次登录，请先修改初始密码。</p>
      ${[['current_password','当前密码'],['new_password','新密码（至少 8 位）'],['confirm_password','再次输入新密码']].map(([name,label])=>`<label class="block text-sm">${label}<input name="${name}" type="password" required autocomplete="${name==='current_password'?'current-password':'new-password'}" class="${fieldClass} mt-1"></label>`).join('')}
      <div id="clubLoginError" role="alert" class="text-sm text-red-500"></div><button type="submit" class="w-full py-2.5 rounded-xl bg-ink-900 text-white">修改密码并进入</button>${button('退出登录','logout')}`;
    form.onsubmit=async event=>{
      event.preventDefault(); const submit=form.querySelector('[type=submit]'); submit.disabled=true;
      try { user=await api.changePassword(Object.fromEntries(new FormData(form))); enter(); }
      catch(error) { loginNotice(error.message); } finally { submit.disabled=false; }
    };
  }
  async function loadAssets(assetPage=assets.page,appPage=apps.page) {
    if(!user||state.page!=='assets') return;
    const version=++assetVersion, currentSession=session;
    assetLoading=true; assetError=''; appError=''; renderMain();
    const results=await Promise.allSettled([api.assets(assetPage),user.role==='member'?Promise.resolve(null):api.applications(appPage)]);
    if(version!==assetVersion||currentSession!==session||state.page!=='assets') return;
    if(results[0].status==='fulfilled') {
      assets=results[0].value; assets.items.forEach(a=>assetNames.set(a.id,a.name));
    } else { assets={...assets,items:[]}; assetError=results[0].reason.message; }
    if(results[1].status==='fulfilled') { if(results[1].value) apps=results[1].value; } else { apps={...apps,items:[]}; appError=results[1].reason.message; }
    assetLoading=false; renderMain();
  }
  function pageAssets() {
    if(!user) return gate();
    const rows=assets.items.map(a=>`<tr class="border-t border-zinc-100"><td class="px-5 py-4 font-medium">${esc(a.name)}<span class="block text-xs text-zinc-500">#${a.id}</span></td><td class="px-5 py-4">${a.quantity}</td><td class="px-5 py-4">${a.available_quantity}</td><td class="px-5 py-4">${a.quantity-a.available_quantity}</td><td class="px-5 py-4 text-right">${lead()?button('编辑','asset-edit',`data-id="${a.id}"`):user.role==='minister'?button('申请使用','asset-apply',`data-id="${a.id}"`):'<span class="text-zinc-500">仅查看</span>'}</td></tr>`).join('');
    const applicationRows=apps.items.map(a=>{
      const [label,tone]=status(a.status);
      return `<tr class="border-t border-zinc-100 align-top"><td class="p-4">#${a.id}<p class="text-xs text-zinc-500 mt-1">${esc(date(a.created_at))}</p></td><td class="p-4">${esc(assetNames.get(a.asset_id)||'资产 #'+a.asset_id)}<p class="text-xs text-zinc-500 mt-1">数量 ${a.quantity}</p></td><td class="p-4"><p class="whitespace-pre-wrap break-words max-w-xs">${esc(a.purpose)}</p><p class="text-xs text-zinc-500 mt-1">申请人 ${a.applicant_id===user.id?esc(user.name)+' ':''}#${a.applicant_id}</p></td><td class="p-4">${badge(label,tone)}${a.review_note?`<p class="text-xs text-zinc-500 max-w-xs whitespace-pre-wrap mt-2">${esc(a.review_note)}</p>`:''}${a.reviewed_at?`<p class="text-xs text-zinc-500 mt-1">审批人 #${a.reviewer_id} · ${esc(date(a.reviewed_at))}</p>`:''}</td><td class="p-4 text-right">${lead()&&a.status==='pending'?button('审批','application-review',`data-id="${a.id}"`):'—'}</td></tr>`;
    }).join('');
    return pageHead('资产管理',lead()?'维护公共资产，审批部长的使用申请。':user.role==='minister'?'查看公共资产，提交申请并跟进审批结果。':'查看社团公共资产与可用数量。',button('刷新','assets-refresh')+(lead()?button('新增资产','asset-new'):''))+
      `<div class="bg-white rounded-2xl border border-zinc-200 shadow-soft overflow-hidden">${assetLoading?empty('正在加载资产…'):errorBox(assetError,'assets-refresh')||`<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-left text-xs text-zinc-500 bg-zinc-50"><tr>${['资产名称','总数量','可用数量','已分配','操作'].map(x=>`<th class="px-5 py-3">${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${!rows?empty('暂无资产'):''}</div>${pager(assets,'assets-page')}`}</div>`+
      (user.role==='member'?'':`<section class="mt-8"><h2 class="text-lg font-semibold mb-2">${lead()?'资产申请审批':'我的资产申请'}</h2><p class="text-xs text-zinc-500 mb-4">提交申请时不扣库存，审批同意后分配数量。</p><div class="bg-white rounded-2xl border border-zinc-200 overflow-hidden">${assetLoading?empty('正在加载申请…'):errorBox(appError,'assets-refresh')||`<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-left text-xs text-zinc-500 bg-zinc-50"><tr>${['申请','资产','用途','审批结果','操作'].map(x=>`<th class="p-4">${x}</th>`).join('')}</tr></thead><tbody>${applicationRows}</tbody></table>${!applicationRows?empty('暂无申请'):''}</div>${pager(apps,'applications-page')}`}</div></section>`);
  }
  function formModal(title,body,submit,run) {
    openModal({title,body:`<form id="clubModalForm">${body}<div id="clubFormError" role="alert" class="text-sm text-red-500 my-3"></div><button type="submit" class="px-4 py-2.5 rounded-xl bg-ink-900 text-white">${submit}</button></form>`,footer:button('取消','modal-close')});
    const form=$('clubModalForm'), currentSession=session;
    form.onsubmit=async event=>{
      event.preventDefault(); const submitButton=form.querySelector('[type=submit]'); if(submitButton.disabled) return;
      submitButton.disabled=true; $('clubFormError').textContent='';
      try {
        await run(Object.fromEntries(new FormData(form)));
        if(currentSession!==session) return;
        if(form.isConnected) closeModal(); toast('已保存'); loadAssets();
      } catch(error) {
        if(form.isConnected) form.querySelector('[role=alert]').textContent=error.message+(error.status===409?'，请刷新列表后核对。':error.status===0?'，请先刷新核对是否已保存，再决定是否重试。':'');
      } finally { submitButton.disabled=false; }
    };
  }
  function editAsset(id) {
    const a=id?assets.items.find(x=>x.id===id):{name:'',quantity:0}; if(!a||!lead()) return;
    formModal(id?'编辑资产':'新增资产',`<label class="block text-sm mb-4">资产名称<input name="name" required maxlength="100" value="${esc(a.name)}" class="${fieldClass} mt-1"></label><label class="block text-sm">总数量<input name="quantity" type="number" required min="0" max="1000000000" step="1" value="${a.quantity}" class="${fieldClass} mt-1"></label><p class="text-xs text-zinc-500 mt-3">总数量不能低于已分配数量；可用数量由系统计算。</p>`,'保存',data=>api.saveAsset(id,{name:data.name.trim(),quantity:Number(data.quantity)}));
  }
  function applyAsset(id) {
    const a=assets.items.find(x=>x.id===id); if(!a||user?.role!=='minister') return;
    formModal('申请使用 · '+esc(a.name),`<p class="text-sm text-zinc-500 mb-4">当前可用 ${a.available_quantity}，最终库存以审批时为准。</p><label class="block text-sm mb-4">申请数量<input name="quantity" type="number" required min="1" max="1000000000" step="1" value="1" class="${fieldClass} mt-1"></label><label class="block text-sm">用途<textarea name="purpose" required maxlength="500" rows="3" class="${fieldClass} mt-1"></textarea></label>`,'提交申请',data=>api.apply({asset_id:id,quantity:Number(data.quantity),purpose:data.purpose.trim()}));
  }
  function reviewApplication(id) {
    if(!lead()) return;
    formModal('审批申请 #'+id,`<label class="block text-sm mb-4">审批决定<select name="decision" class="${fieldClass} mt-1"><option value="approved">同意</option><option value="rejected">驳回</option></select></label><label class="block text-sm">审批意见<textarea name="note" maxlength="500" rows="3" class="${fieldClass} mt-1"></textarea></label>`,'确认审批',data=>api.review(id,data));
  }
  async function loadContacts(page=contacts.page,q=contactSearch) {
    if(!user||state.page!=='messages') return;
    const version=++contactVersion, currentSession=session;
    contactsLoading=true; contactError=''; contactSearch=q;
    renderMain();
    try {
      const result=await api.contacts(page,q);
      if(version!==contactVersion||currentSession!==session||state.page!=='messages') return;
      contacts=result;
    } catch(error) { if(version===contactVersion&&currentSession===session) contactError=error.message; }
    finally {
      if(version===contactVersion&&currentSession===session&&state.page==='messages') { contactsLoading=false; renderMain(); }
    }
  }
  function pageMessages() {
    if(!user) return gate();
    const list=contacts.items.map(c=>`<button type="button" data-club="contact-open" data-id="${c.id}" class="w-full text-left px-4 py-4 border-b border-zinc-100 ${active?.id===c.id?'bg-zinc-100':'hover:bg-zinc-50'}"><div class="flex items-center gap-3"><span class="w-9 h-9 shrink-0 rounded-xl bg-blue-50 text-blue-400 flex items-center justify-center">${esc(c.name.slice(0,1))}</span><div class="min-w-0"><p class="text-sm font-medium truncate">${esc(c.name)}</p><p class="text-xs text-zinc-500 truncate">${esc(labels[c.role])}${c.department_name?' · '+esc(c.department_name):''}</p></div></div></button>`).join('');
    return pageHead('沟通中心','一对一沟通 · 仅显示当前允许联系的人员。',button('刷新联系人','contacts-refresh'))+
      `<div class="club-chat bg-white rounded-2xl border border-zinc-200 shadow-soft overflow-hidden"><aside class="club-contacts border-r border-zinc-100 flex flex-col min-h-0"><form id="clubContactSearch" class="flex gap-2 p-3 border-b border-zinc-100"><input name="q" aria-label="搜索联系人" placeholder="按姓名搜索" maxlength="64" value="${esc(contactSearch)}" class="${fieldClass} min-w-0">${button('搜索','contacts-search')}</form><div class="flex-1 overflow-y-auto">${contactsLoading?empty('正在加载联系人…'):errorBox(contactError,'contacts-refresh')||list||empty('暂无可联系人员')}</div>${pager(contacts,'contacts-page')}</aside><section class="flex flex-col min-h-0 min-w-0"><div class="px-5 py-4 border-b border-zinc-100"><h2 class="font-medium">${active?esc(active.name):'选择联系人'}</h2><p class="text-xs text-zinc-500 mt-1">${active?esc(labels[active.role])+(active.department_name?' · '+esc(active.department_name):''):'点击左侧人员开始或继续沟通'}</p></div><div id="clubChatStatus" role="status" class="px-4 pt-2 text-xs text-zinc-500"></div><div id="clubChatBody" class="flex-1 overflow-y-auto p-4 min-h-0" aria-live="polite">${chatBody()}</div>${active?`<form id="clubSendForm" class="p-4 border-t border-zinc-100"><label for="clubChatInput" class="sr-only">消息内容</label><textarea id="clubChatInput" rows="2" placeholder="输入消息，Enter 发送，Shift + Enter 换行" class="${fieldClass}" ${chatLoading||!conversation?'disabled':''}>${esc(draft)}</textarea><div class="flex items-center justify-between mt-2"><span id="clubCharCount" class="text-xs text-zinc-500">${Array.from(draft.trim()).length} / 2000</span><button id="clubSendButton" type="submit" class="px-5 py-2 rounded-xl bg-ink-900 text-white text-sm disabled:opacity-40" ${sending||uncertain||chatLoading||!conversation?'disabled':''}>${sending?'发送中…':'发送'}</button></div><div id="clubSendError" role="alert" class="text-sm text-red-500 mt-2">${uncertain?'发送结果未确认，请核对消息记录后再操作。'+button('已核对，允许再次发送','send-confirm'):''}</div></form>`:''}</section></div>`;
  }
  function messageMarkup() {
    return timeline.items.map(m=>`<div data-message-id="${m.id}" class="flex mb-4 ${m.sender_id===user.id?'justify-end':'justify-start'}"><div class="max-w-[85%]"><p class="whitespace-pre-wrap break-words px-4 py-3 rounded-2xl text-sm ${m.sender_id===user.id?'bg-blue-50 text-zinc-900 rounded-br-md':'bg-zinc-100 text-zinc-800 rounded-bl-md'}">${esc(m.content)}</p><p class="mt-1 text-[10px] text-zinc-500 ${m.sender_id===user.id?'text-right':''}">${esc(date(m.created_at))}</p></div></div>`).join('');
  }
  function chatBody() {
    if(!active) return empty('选择一位联系人开始沟通');
    if(chatLoading) return empty('正在打开会话…');
    if(chatError) return errorBox(chatError,'chat-retry');
    return (timeline.hasOlder?`<div class="text-center mb-4">${button(olderLoading?'正在加载…':'加载更早消息','chat-older',olderLoading?'disabled':'')}</div>`:'')+(messageMarkup()||empty('暂无消息，发送第一条消息吧'));
  }
  function scrollToLatest() {
    const version=chatVersion, body=$('clubChatBody');
    if(!body) return;
    body.scrollTop=body.scrollHeight;
    // Tailwind's CDN applies newly encountered utility classes asynchronously.
    // Scroll again after layout so the first render includes the newest message.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(version===chatVersion&&body===$('clubChatBody')) body.scrollTop=body.scrollHeight;
    }));
  }
  function paintChat(older=false) {
    const body=$('clubChatBody'); if(!body) return;
    const atBottom=body.scrollHeight-body.scrollTop-body.clientHeight<100, top=body.scrollTop, height=body.scrollHeight;
    body.innerHTML=chatBody();
    if(older) body.scrollTop=top+body.scrollHeight-height;
    else if(atBottom) scrollToLatest();
  }
  function chatStatus(text) { if($('clubChatStatus')) $('clubChatStatus').textContent=text; }
  async function openContact(id) {
    const contact=contacts.items.find(c=>c.id===id)||(active?.id===id?active:null); if(!user||!contact) return;
    if(active?.id===id&&conversation) return;
    stopChat(); const version=chatVersion;
    active=contact; conversation=null; timeline=new Timeline(); chatLoading=true; chatError=''; draft=''; uncertain=false; sending=false; olderLoading=false;
    chatAbort=new AbortController(); renderMain();
    try {
      const result=await api.open(id); if(version!==chatVersion||state.page!=='messages') return;
      const page=await api.history(result.id,{size:20},chatAbort.signal); if(version!==chatVersion) return;
      conversation=result; timeline.recent(page); chatLoading=false; renderMain();
      scrollToLatest();
      schedulePoll(version,0);
    } catch(error) { if(version===chatVersion) { chatLoading=false; chatError=error.message; renderMain(); } }
  }
  function schedulePoll(version,delay=2000) {
    clearTimeout(timer); if(version!==chatVersion||!conversation||state.page!=='messages') return;
    timer=setTimeout(()=>poll(version),delay);
  }
  async function poll(version=chatVersion) {
    if(version!==chatVersion||pollBusy||!conversation||state.page!=='messages') return;
    if(document.hidden) { schedulePoll(version); return; }
    pollBusy=true;
    try {
      let page;
      do {
        page=await api.history(conversation.id,{after_id:timeline.after,size:100},chatAbort.signal);
        if(version!==chatVersion) return;
        timeline.polled(page); if(page.items.length) paintChat();
      } while(page.has_more);
      chatStatus('消息已同步');
    } catch(error) {
      if(version!==chatVersion) return;
      chatStatus(error.message);
      if([401,403,404].includes(error.status)) {
        conversation=null; draft=''; chatError=error.message; timeline=new Timeline(); renderMain(); return;
      }
    } finally { if(version===chatVersion) { pollBusy=false; schedulePoll(version); } }
  }
  async function olderMessages() {
    if(!conversation||olderLoading||!timeline.hasOlder) return;
    const version=chatVersion; olderLoading=true; paintChat();
    try {
      const page=await api.history(conversation.id,{before_id:timeline.before,size:20},chatAbort.signal);
      if(version!==chatVersion) return;
      timeline.older(page);
    } catch(error) { if(version===chatVersion) chatStatus(error.message); }
    finally { if(version===chatVersion) { olderLoading=false; paintChat(true); } }
  }
  async function send() {
    if(!conversation||sending||uncertain) return;
    const content=draft.trim(), length=Array.from(content).length;
    if(length<1||length>2000) { $('clubSendError').textContent='消息须为 1–2000 个字符'; return; }
    const version=chatVersion, sentDraft=draft;
    sending=true; $('clubSendButton').disabled=true; $('clubSendButton').textContent='发送中…'; $('clubSendError').textContent='';
    try {
      const message=await api.send(conversation.id,content); if(version!==chatVersion) return;
      timeline.merge([message]); if(draft===sentDraft) draft='';
      $('clubChatInput').value=draft; $('clubCharCount').textContent=Array.from(draft.trim()).length+' / 2000';
      paintChat(); scrollToLatest();
    } catch(error) {
      if(version!==chatVersion||!$('clubSendError')) return;
      uncertain=error.status===0||error.status>=500;
      $('clubSendError').innerHTML=esc(error.message)+(uncertain?'。结果可能已保存，请先核对消息记录。'+button('已核对，允许再次发送','send-confirm'):'');
      if([403,404].includes(error.status)) { conversation=null; $('clubChatInput').disabled=true; }
    } finally {
      if(version===chatVersion) { sending=false; if($('clubSendButton')) { $('clubSendButton').disabled=uncertain||!conversation; $('clubSendButton').textContent='发送'; } schedulePoll(version,0); }
    }
  }
  const actions={
    'logout':()=>logout(), 'assets-refresh':()=>loadAssets(), 'assets-page':el=>loadAssets(Number(el.dataset.page),apps.page),
    'applications-page':el=>loadAssets(assets.page,Number(el.dataset.page)), 'asset-new':()=>editAsset(0),
    'asset-edit':el=>editAsset(Number(el.dataset.id)), 'asset-apply':el=>applyAsset(Number(el.dataset.id)),
    'application-review':el=>reviewApplication(Number(el.dataset.id)), 'modal-close':()=>closeModal(),
    'contacts-refresh':()=>loadContacts(), 'contacts-page':el=>loadContacts(Number(el.dataset.page)),
    'contacts-search':()=>loadContacts(1,$('clubContactSearch').elements.q.value.trim()),
    'contact-open':el=>openContact(Number(el.dataset.id)), 'chat-older':()=>olderMessages(),
    'chat-retry':()=>{ if(active) { const id=active.id; conversation=null; openContact(id); } },
    'send-confirm':()=>{ uncertain=false; $('clubSendError').textContent=''; $('clubSendButton').disabled=!conversation; },
  };
  document.addEventListener('click',event=>{ const el=event.target.closest('[data-club]'); if(el&&!el.disabled) actions[el.dataset.club]?.(el); });
  document.addEventListener('submit',event=>{
    if(event.target.id==='clubSendForm') { event.preventDefault(); send(); }
    if(event.target.id==='clubContactSearch') { event.preventDefault(); loadContacts(1,event.target.elements.q.value.trim()); }
  });
  document.addEventListener('input',event=>{ if(event.target.id==='clubChatInput') { draft=event.target.value; $('clubCharCount').textContent=Array.from(draft.trim()).length+' / 2000'; } });
  document.addEventListener('keydown',event=>{ if(event.target.id==='clubChatInput'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing) { event.preventDefault(); send(); } });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) schedulePoll(chatVersion,0); });
  window.addEventListener('pagehide',stopChat);
  window.M7M8={pageAssets,pageMessages,openContact,send};
  setupLogin();
  if(api.token) {
    const restoring=session;
    const form=$('clubLoginForm'); form.querySelector('[type=submit]').disabled=true;
    loginNotice('正在恢复登录…');
    api.me().then(result=>{ if(restoring!==session) return; user=result; session++; enter(); }).catch(error=>{
      if(restoring===session) { loginNotice(error.message); form.querySelector('[type=submit]').disabled=false; }
    });
  }
})();
