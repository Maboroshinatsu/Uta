const {test}=require('node:test');
const assert=require('node:assert/strict');
const createLoader=require('./support/settings-loader.cjs');
function fixture(isActive){
 const deadlines=[];
 const load=createLoader({}, {setInterval:()=>1,clearInterval(){},setTimeout:fn=>{deadlines.push(fn);return deadlines.length},clearTimeout(){}});
 return {adapter:load('renderer/services/adapters/hook-host').createHookHostAdapter({id:'codex',isActive}),deadlines};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
test('hook probe times out offline and ignores a result that arrives after timeout',async()=>{
 let resolve;
 const {adapter,deadlines}=fixture(()=>new Promise(r=>{resolve=r}));
 adapter.connect();await flush();
 assert.equal(adapter.getConnectionState(),'connecting');
 deadlines[0]();await flush();
 assert.equal(adapter.getConnectionState(),'disconnected');
 resolve(true);await flush();
 assert.equal(adapter.getConnectionState(),'disconnected');adapter.dispose();
});
test('old hook probes cannot reconnect a disconnected or superseded adapter',async()=>{
 const resolves=[];const {adapter}=fixture(()=>new Promise(r=>resolves.push(r)));
 adapter.connect();await flush();adapter.disconnect();adapter.connect();await flush();
 resolves[1](false);await flush();resolves[0](true);await flush();
 assert.equal(adapter.getConnectionState(),'disconnected');adapter.dispose();
});
