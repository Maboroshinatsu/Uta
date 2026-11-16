const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const sample = load('renderer/services/live2d/dafish-happy-performance')
const { compileMotionTrack, buildDafishHappyMotion, installDafishHappyMotion, getDafishHappyOwnedParameters, createDafishHappyPreset, DAFISH_HAPPY_MOTION, DAFISH_HAPPY_DURATION } = sample

function fixture() {
  const bodyIds=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ']
  const handIds=['Movement1','Movement3','Param56','Param57','Param36','Param39','Param41','Param42','Param43']
  const faceIds=['ParamMouthForm','ParamMouthOpenY','ParamEyeLOpen','ParamEyeROpen','ParamEyeLSmile','ParamEyeRSmile','ParamEyeBallX','ParamEyeBallY','key4','key7','JawOpen','Movement2']
  const curve=(Id,Segments)=>({Target:'Parameter',Id,Segments})
  const body={Meta:{Duration:12},Curves:bodyIds.map((id,i)=>curve(id,[0,0,0,4,8-i,0,8,-6+i,0,12,0]))}
  const hand=(close)=>({Meta:{Duration:1},Curves:handIds.map((id,i)=>curve(id,[0,close?(i===0?1:0.2):0,0,1,close?0:(i===0?1:0.2)]))})
  const parameters=[...bodyIds,...handIds,...faceIds].map(id=>({id,min:-30,max:30,default:0}))
  const assets={modelSignature:'fixture',metadata:{motions:[{group:'脱捕',index:0,json:body},{group:'狗尾巴草打开',index:0,json:hand(false)},{group:'狗尾巴草关闭',index:0,json:hand(true)}],expressions:[],physics:null,cdi:null}}
  return {assets,parameters}
}

test('native Bezier sampling solves its nonuniform time axis and rejects malformed curves',()=>{
  const track=compileMotionTrack([0,0,1,0.05,0,0.2,1,1,1])
  assert.ok(track.sample(0.5)>0.7, 't=.5 is not the cubic parameter .5')
  assert.equal(track.sample(-1),0); assert.equal(track.sample(2),1)
  assert.equal(compileMotionTrack([0,0,1,1]),null)
  assert.equal(compileMotionTrack([0,0,5,1,1]),null)
  assert.equal(compileMotionTrack([0,0,0,-1,1]),null)
  assert.equal(compileMotionTrack([0,NaN]),null)
})

test('body moves continuously while native hand enters, gestures and returns on independent tracks',()=>{
  const {assets,parameters}=fixture()
  const before=JSON.stringify(assets)
  const motion=buildDafishHappyMotion(assets,parameters)
  assert.equal(JSON.stringify(assets),before,'original model assets are read-only')
  assert.equal(motion.Meta.Duration,DAFISH_HAPPY_DURATION)
  const tracks=new Map(motion.Curves.map(c=>[c.Id,compileMotionTrack(c.Segments)]))
  const at=(id,t)=>tracks.get(id).sample(t)
  assert.equal(at('Movement1',0),0)
  assert.ok(at('Movement1',2)>0 && at('Movement1',2)<1)
  assert.equal(at('Movement1',4),1)
  assert.equal(at('Movement1',17),0)
  assert.notEqual(at('AngleX',4),at('AngleX',7),'body must not freeze while holding the prop')
  assert.notEqual(at('Param42',5),at('Param42',7),'wrist continues to articulate')
  assert.equal(at('key4',0),0); assert.equal(at('key4',8.2),1); assert.equal(at('key4',12),0)
  assert.ok(at('ParamMouthOpenY',5.5)>at('ParamMouthOpenY',3))
  for(const c of motion.Curves) {
    assert.ok(Math.abs(c.Segments[1]-c.Segments.at(-1))<1e-5,`${c.Id}: loop has a discontinuity`)
    assert.ok(c.Segments.every(Number.isFinite))
  }
})

test('missing model clips fail closed; absent/physics parameters are never synthesized',()=>{
  const {assets,parameters}=fixture()
  assert.equal(buildDafishHappyMotion(null,parameters),null)
  assert.equal(buildDafishHappyMotion(assets,parameters.filter(p=>p.id!=='Movement1')),null)
  const motion=buildDafishHappyMotion(assets,parameters.filter(p=>p.id!=='key4'),['Param42'])
  assert.ok(!motion.Curves.some(c=>['key4','Param42','Param55','Param58','Clothes1'].includes(c.Id)))
})

test('sample ownership is scoped to the installed live model and released immediately on another motion',()=>{
  const {assets,parameters}=fixture()
  const manager={definitions:{},motionGroups:{},state:{},createMotion:data=>({data})}
  const model={internalModel:{motionManager:manager}}
  assert.equal(installDafishHappyMotion(model,assets,parameters),true)
  assert.equal(getDafishHappyOwnedParameters(model).size,0)
  manager.state.currentGroup=DAFISH_HAPPY_MOTION
  assert.ok(getDafishHappyOwnedParameters(model).has('Param56'))
  assert.equal(getDafishHappyOwnedParameters({internalModel:{motionManager:{state:{currentGroup:DAFISH_HAPPY_MOTION}}}}).size,0)
  manager.state.currentGroup='IDLE'
  assert.equal(getDafishHappyOwnedParameters(model).size,0)
  const preset=createDafishHappyPreset()
  assert.equal(preset.steps.reduce((sum,s)=>sum+s.durationMs+s.holdMs,0),DAFISH_HAPPY_DURATION*1000)
  assert.ok(preset.steps.every(s=>Object.keys(s.parameters).length===0 && s.controls.length===0),'score must not pin native hand curves with static control poses')
})

test('background idle behavior yields to the happy score and resumes after its ownership ends',()=>{
  const {assets,parameters}=fixture()
  const manager={definitions:{},motionGroups:{},state:{},createMotion:data=>({data})}
  const model={internalModel:{motionManager:manager}}
  installDafishHappyMotion(model,assets,parameters)
  const store={focusActive:false,modelLoaded:true,live2dModel:model,idleActionsEnabled:true,agentWorkingState:'idle',isSpeaking:false,isThinking:false,pendingApprovals:[],presetEditingLocked:false,presetPreviewActive:false}
  const directorLoad=require('./support/settings-loader.cjs')({
    '@/stores/deskpet':{useDeskpetStore:()=>store},
    '@/services/live2d/loader':{hasPresetMotionOwnership:()=>false},
    '@/services/live2d/dafish-happy-performance':sample,
    './useMotionPriority':{MotionLayer:{Idle:1}},
  })
  const director=directorLoad('renderer/composables/useCompanionDirector').useCompanionDirector({isTtsSpeaking:()=>false,isDragging:()=>false,isPanelOpen:()=>false,isInputOpen:()=>false})
  assert.equal(director.canRunIdleAction(),true)
  manager.state.currentGroup=DAFISH_HAPPY_MOTION
  assert.equal(director.canRunIdleAction(),false)
  manager.state.currentGroup='IDLE'
  assert.equal(director.canRunIdleAction(),true)
})
