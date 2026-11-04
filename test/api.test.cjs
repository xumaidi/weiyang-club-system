const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client,Timeline,normalizeBase,escapeHTML}=require('../scripts/club-api.js');

test('API transport sends real authorization and exact M7/M8 payloads',async()=>{
  const calls=[];
  const client=new Client({base:'http://localhost:18081/api/v1/',token:'test-token',fetch:async(url,options)=>{
    calls.push({url,...options});return {ok:true,status:200,json:async()=>({code:200,data:{id:1}})};
  }});
  await client.login('20260001','password'); await client.saveAsset(4,{name:'相机',quantity:5});
  await client.apply({asset_id:4,quantity:2,purpose:'拍摄'});await client.review(8,{decision:'approved',note:'同意'});
  await client.contacts(2,'张 三'); await client.open(6);await client.history(9,{after_id:0,size:20});await client.send(9,'<script>文本</script>');
  assert.equal(calls[0].headers.Authorization,undefined);
  assert.equal(calls[1].url,'http://localhost:18081/api/v1/asset/assets/4');assert.equal(calls[1].method,'PUT');
  assert.deepEqual(JSON.parse(calls[2].body),{asset_id:4,quantity:2,purpose:'拍摄'});
  assert.equal(calls[3].url,'http://localhost:18081/api/v1/asset/applications/8/review');
  assert.equal(new URL(calls[4].url).searchParams.get('q'),'张 三');
  assert.equal(calls[5].headers.Authorization,'Bearer test-token');
  assert.equal(new URL(calls[6].url).searchParams.get('after_id'),'0');
  assert.deepEqual(JSON.parse(calls[7].body),{content:'<script>文本</script>'});
});
test('401 expires authenticated sessions; bad login does not; POST is never retried',async()=>{
  let count=0,expired=0;
  const client=new Client({onUnauthorized:()=>expired++,fetch:async()=>{count++;return {ok:false,status:401,json:async()=>({message:'失效'})};}});
  await assert.rejects(client.login('a','b'),{status:401});assert.equal(expired,0);
  await assert.rejects(client.send(1,'hello'),{status:401});assert.equal(expired,1);assert.equal(count,2);
});
test('native browser fetch receives the global receiver',async()=>{
  const client=new Client({fetch:async function(){
    assert.equal(this,globalThis);
    return {ok:true,status:200,json:async()=>({code:200,data:{id:1}})};
  }});
  assert.equal((await client.me()).id,1);
});
test('conflict, dependency and network errors preserve status without optimistic success',async()=>{
  for(const status of [403,409,503]) {
    const client=new Client({fetch:async()=>({ok:false,status,json:async()=>({code:status,message:'失败',data:{reason:'test'}})})});
    await assert.rejects(client.review(1,{decision:'approved'}),{status,message:'失败'});
  }
  let calls=0;const client=new Client({fetch:async()=>{calls++;throw new TypeError('network')}});
  await assert.rejects(client.send(1,'hi'),{status:0});assert.equal(calls,1);
});
test('timeline merges history, reverse duplicates and catch-up without losing intervening messages',()=>{
  const timeline=new Timeline();
  timeline.recent({items:[{id:10},{id:11}],next_after_id:11,next_before_id:10,has_more:true});
  timeline.merge([{id:15,content:'my new send'}]);assert.equal(timeline.after,11);
  timeline.polled({items:[{id:12},{id:13}],next_after_id:13,has_more:true});
  timeline.polled({items:[{id:14},{id:15,content:'my new send'}],next_after_id:15,has_more:false});
  timeline.older({items:[{id:8},{id:9},{id:10}],next_before_id:8,has_more:false});
  assert.deepEqual(timeline.items.map(x=>x.id),[8,9,10,11,12,13,14,15]);assert.equal(timeline.after,15);assert.equal(timeline.before,8);assert.equal(timeline.hasOlder,false);
  timeline.polled({items:[],next_after_id:15});assert.equal(timeline.after,15);
});
test('empty conversation polls from zero; user content is escaped',()=>{
  const timeline=new Timeline();timeline.recent({items:[],next_after_id:0,next_before_id:0,has_more:false});assert.equal(timeline.after,0);
  assert.equal(escapeHTML('<img onerror="alert(1)">&\''),'&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  for(const base of ['javascript:alert(1)','https://name:secret@example.com','https://example.com/?token=x'])assert.throws(()=>normalizeBase(base));
});
