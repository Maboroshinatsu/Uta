'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const load=require('./support/settings-loader.cjs')()
const {describeEnvironment,loadEnvironmentLabel}=load('renderer/services/environment-label')
test('stable identifies daily data without claiming a release was accepted',()=>{
  const result=describeEnvironment({profile:'stable',packaged:true,isStable:true})
  assert.equal(result.label,'日常数据 · stable');assert.equal(result.identifier,'stable')
})
test('source and packaged isolated profiles remain distinguishable',()=>{
  assert.equal(describeEnvironment({profile:'dev-a1b2',packaged:false}).label,'开发实例 · dev-a1b2')
  assert.equal(describeEnvironment({profile:'candidate-02',packaged:true}).label,'独立实例 · candidate-02')
  assert.equal(describeEnvironment({profile:'stable',packaged:true,isStable:false}).label,'独立实例 · stable')
})
test('unknown, path-shaped and oversized identifiers do not masquerade as a known instance',()=>{
  for(const raw of [undefined,{}, {profile:'D:/private/path'},{profile:'x'.repeat(129)},{profile:'bad\nprofile'},{profile:'<script>'}]){
    assert.equal(describeEnvironment(raw).identifier,null);assert.equal(describeEnvironment(raw).label,'环境未确认')
  }
})
test('labels project only the profile and packaged fields without paths or credentials',()=>{
  const result=describeEnvironment({profile:'dev-test',packaged:false,userData:'private-dir',token:'private-token'})
  assert.equal(JSON.stringify(result).includes('private'),false)
})
test('environment bridge failure is explicit and does not expose the raw error',async()=>{
  const result=await loadEnvironmentLabel({getEnvironmentInfo:async()=>{throw Error('private error')}})
  assert.equal(result.label,'环境未确认');assert.equal(result.identifier,null)
  assert.equal((await loadEnvironmentLabel()).label,'环境未确认')
})
