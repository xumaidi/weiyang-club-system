/* Shared browser/Node contract layer. No UI, demo fixtures or automatic POST retries. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubAPI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  class APIError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data; }
  }
  function normalizeBase(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('请输入有效的 HTTP(S) 后端地址');
    }
    return url.href.replace(/\/$/, '').replace(/\/api\/v1$/, '');
  }
  class Client {
    constructor({base = 'http://127.0.0.1:18081', token = '', fetch: fetcher = globalThis.fetch, onUnauthorized = () => {}} = {}) {
      this.base = normalizeBase(base); this.token = token; this.fetcher = fetcher; this.onUnauthorized = onUnauthorized;
    }
    async request(path, {method = 'GET', body, auth = true, signal} = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, {once: true});
      const timeout = setTimeout(abort, 18000);
      try {
        const headers = {Accept: 'application/json'};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth && this.token) headers.Authorization = 'Bearer ' + this.token;
        const response = await this.fetcher.call(globalThis, this.base + '/api/v1' + path, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        });
        let result;
        try { result = await response.json(); } catch { throw new APIError(response.status, '服务返回了非 JSON 响应，请检查后端地址'); }
        if (!response.ok || (result.code !== undefined && result.code !== 200)) {
          const error = new APIError(response.status, result.message || '请求失败', result.data);
          if (auth && response.status === 401) this.onUnauthorized();
          throw error;
        }
        return result.data;
      } catch (error) {
        if (error instanceof APIError) throw error;
        if (signal?.aborted) throw new APIError(0, '请求已取消');
        throw new APIError(0, '连接中断或超时，请检查网络及后端地址');
      } finally {
        clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      }
    }
    login(student_id, password) { return this.request('/login', {method:'POST', body:{student_id,password}, auth:false}); }
    me() { return this.request('/login/me'); }
    changePassword(body) { return this.request('/login/change-password', {method:'POST', body}); }
    logout() { return this.request('/login/logout', {method:'POST'}); }
    assets(page=1) { return this.request('/asset/assets?page='+page+'&size=20'); }
    saveAsset(id, body) { return this.request('/asset/assets'+(id?'/'+id:''), {method:id?'PUT':'POST',body}); }
    applications(page=1) { return this.request('/asset/applications?page='+page+'&size=20'); }
    apply(body) { return this.request('/asset/applications', {method:'POST',body}); }
    review(id, body) { return this.request('/asset/applications/'+id+'/review', {method:'POST',body}); }
    contacts(page=1, q='') { return this.request('/message/contacts?'+new URLSearchParams({page,size:20,q})); }
    open(peer_id) { return this.request('/message/conversations', {method:'POST',body:{peer_id}}); }
    history(id, params, signal) { return this.request('/message/conversations/'+id+'/messages?'+new URLSearchParams(params), {signal}); }
    send(id, content) { return this.request('/message/conversations/'+id+'/messages', {method:'POST',body:{content}}); }
  }
  // A send response never advances the polling cursor: earlier incoming messages
  // may have committed before this send and must still be fetched.
  class Timeline {
    constructor() { this.items=[]; this.after=0; this.before=0; this.hasOlder=false; }
    merge(items) {
      const byID = new Map(this.items.map(item=>[item.id,item]));
      for (const item of items) byID.set(item.id,item);
      this.items = [...byID.values()].sort((a,b)=>a.id-b.id);
    }
    recent(page) { this.merge(page.items); this.after=page.next_after_id; this.before=page.next_before_id; this.hasOlder=page.has_more; }
    older(page) { this.merge(page.items); this.before=page.next_before_id; this.hasOlder=page.has_more; }
    polled(page) { this.merge(page.items); this.after=page.next_after_id; }
  }
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  return {Client, APIError, Timeline, normalizeBase, escapeHTML};
});
