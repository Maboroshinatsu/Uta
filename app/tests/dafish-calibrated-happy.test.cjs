const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const subject = load('renderer/services/live2d/dafish-calibrated-happy')
const common = load('renderer/services/live2d/dafish-happy-performance')
const previous = load('renderer/services/live2d/dafish-authored-happy')
function rig() {
  const angles = ['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput']
  const signed = ['Param62','Param59','Param60','Param61','Param36','Param39','Param41','Param42','Param43','ParamMouthForm','EyeSmile','ParamEyeBallX','ParamEyeBallY','ParamBrowLY','ParamBrowRY']
  const switches = ['Movement1','Movement2','Movement3','ParamMouthOpenY','key7','key4','JawOpen']
  return [...angles.map(id => ({id,min:-30,max:30,default:0})),
    ...signed.map(id=>({id,min:-1,max:1,default:0})), ...switches.map(id=>({id,min:0,max:1,default:0})),
    ...['ParamEyeLOpen','ParamEyeROpen'].map(id=>({id,min:0,max:1.5,default:1}))]
}
test('calibrated motion changes hand visibility only after every arm joint has returned home', () => {
  const motion = subject.buildDafishCalibratedHappyMotion(rig())
  assert.ok(motion)
  const tracks = new Map(motion.Curves.map(c=>[c.Id,common.compileMotionTrack(c.Segments)]))
  for(let t=0;t<=12.8;t+=1/120) {
    if(tracks.get('Movement2').sample(t)<.999)
      for(const id of ['Param62','Param59','Param60','Param61']) assert.ok(Math.abs(tracks.get(id).sample(t))<.001,`${id} at visibility change ${t}`)
  }
  assert.ok(tracks.get('Param60').sample(4)<-.6)
  assert.equal(tracks.get('Param60').sample(11),0)
})
test('calibrated sample is finite, bounded, closed and filters physics outputs', () => {
  const parameters=rig(), motion=subject.buildDafishCalibratedHappyMotion(parameters,['key7'])
  assert.ok(motion)
  assert.ok(!motion.Curves.some(c=>c.Id==='key7'))
  assert.ok(!motion.Curves.some(c=>c.Id==='ParamEyeLSmile'))
  for(const curve of motion.Curves) {
    const p=parameters.find(p=>p.id===curve.Id)
    assert.equal(curve.Segments[1],curve.Segments.at(-1),curve.Id)
    assert.ok(curve.Segments.every(Number.isFinite))
    const track=common.compileMotionTrack(curve.Segments)
    for(let t=0;t<=12.8;t+=.017)assert.ok(track.sample(t)>=p.min-1e-6&&track.sample(t)<=p.max+1e-6)
  }
  assert.equal(subject.buildDafishCalibratedHappyMotion(parameters,['LeanInput']),null)
  assert.equal(subject.buildDafishCalibratedHappyMotion(parameters.filter(p=>p.id!=='Movement2')),null)
  assert.equal(new Set([common.createDafishHappyPreset(),previous.createDafishAuthoredHappyPreset(),subject.createDafishCalibratedHappyPreset()].map(p=>p.id)).size,3)
})
