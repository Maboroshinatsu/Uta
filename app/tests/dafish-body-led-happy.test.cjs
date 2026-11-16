const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./support/settings-loader.cjs')()
const subject=load('renderer/services/live2d/dafish-body-led-happy')
const common=load('renderer/services/live2d/dafish-happy-performance')
function rig(){
 const angles=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput']
 const signed=['Param62','Param59','Param60','Param61','Param36','Param39','Param41','Param42','Param43','ParamMouthForm','EyeSmile','ParamEyeBallX','ParamEyeBallY','ParamBrowLY','ParamBrowRY']
 const gates=['Movement1','Movement2','Movement3','ParamMouthOpenY','key7','key4','JawOpen','Param56','Param57']
 return [...angles.map(id=>({id,min:-30,max:30,default:0})),...signed.map(id=>({id,min:-1,max:1,default:0})),
  ...gates.map(id=>({id,min:0,max:1,default:0})),...['ParamEyeLOpen','ParamEyeROpen'].map(id=>({id,min:0,max:1.5,default:1}))]
}
test('body-only diagnostic leaves head stationary and hand changes remain at home',()=>{
 const motion=subject.buildDafishBodyLedHappyMotion(rig(),[],true)
 assert.equal(motion.Meta.Duration,6.4)
 const tracks=new Map(motion.Curves.map(c=>[c.Id,common.compileMotionTrack(c.Segments)]))
 for(let t=0;t<=6.4;t+=1/120){
  for(const id of ['AngleX','AngleY','AngleZ'])assert.equal(tracks.get(id).sample(t),0)
  if(tracks.get('Movement2').sample(t)<.999)
   for(const id of ['Param62','Param59','Param60','Param61'])assert.ok(Math.abs(tracks.get(id).sample(t))<.001,`${id} during hand switch`)
 }
 assert.ok(tracks.get('Param60').sample(1)<-.6)
 assert.equal(tracks.get('Param60').sample(3.2),0)
 const timing=load('renderer/services/preset-sequence')
 const steps=subject.createDafishBodyLedHappyPreset().steps
 assert.ok(timing.resolvePresetStepTiming(steps[0]).transitionMs<=250,'gaze takeover must precede the main body accent')
 assert.equal(steps.reduce((sum,step)=>sum+timing.resolvePresetStepTiming(step).delayMs,0),6400)
})
test('laugh begins with the hand lift and stays open until after the hand returns',()=>{
 const motion=subject.buildDafishBodyLedHappyMotion(rig())
 const tracks=new Map(motion.Curves.map(c=>[c.Id,common.compileMotionTrack(c.Segments)]))
 const mouth=tracks.get('ParamMouthOpenY'),form=tracks.get('ParamMouthForm'),smile=tracks.get('EyeSmile')
 // .24 is between baked 60 Hz samples; interpolation may lead by less than one frame.
 for(const t of [0,.1,.24])assert.ok(Math.abs(mouth.sample(t)-.025)<.001)
 assert.ok(mouth.sample(.35)>.06,'mouth begins opening during the start of the hand lift')
 for(let t=.56;t<=3.12;t+=.01){
  assert.ok(mouth.sample(t)>.26,'open smile persists through hand return')
  assert.ok(form.sample(t)>.79)
  assert.ok(smile.sample(t)>.84)
 }
 assert.ok(Math.abs(tracks.get('Param60').sample(3.12))<.001)
 assert.ok(mouth.sample(3.3)>.1,'expression releases only after the hand is home')
 assert.ok(mouth.sample(3.45)>.025,'smile survives the hand-type switch')
 for(const t of [3.55,4,6.4])assert.equal(mouth.sample(t),.025)
 assert.equal(form.sample(3.55),.25)
 assert.equal(smile.sample(3.55),.1)
})

test('body-led sample keeps model ranges, loop endpoints and physics exclusion',()=>{
 const params=rig(),motion=subject.buildDafishBodyLedHappyMotion(params,['key7'])
 assert.ok(motion);assert.ok(!motion.Curves.some(c=>c.Id==='key7'))
 for(const c of motion.Curves){
  const p=params.find(p=>p.id===c.Id)
  assert.equal(c.Segments[1],c.Segments.at(-1),c.Id)
  const track=common.compileMotionTrack(c.Segments)
  assert.ok(c.Segments.every(Number.isFinite))
  for(let t=0;t<=6.4;t+=.017)assert.ok(track.sample(t)>=p.min-1e-6&&track.sample(t)<=p.max+1e-6)
 }
 assert.equal(subject.buildDafishBodyLedHappyMotion(params,['PositionZ']),null)
 assert.equal(subject.buildDafishBodyLedHappyMotion(params.filter(p=>p.id!=='Param60')),null)
})

test('抚胸手通道全程留在身前，不会把手画到本体后面', () => {
  const motion = subject.buildDafishBodyLedHappyMotion(rig())
  const tracks = new Map(motion.Curves.map((c) => [c.Id, common.compileMotionTrack(c.Segments)]))
  assert.ok(tracks.has('Param56'), '动作必须带 Param56 轨道，否则手会留在身体后面')
  assert.ok(tracks.has('Param57'), '动作必须带 Param57 轨道')
  for (let t = 0; t <= 6.4; t += 1 / 60) {
    assert.equal(tracks.get('Param56').sample(t), 1, 'Param56 at ' + t.toFixed(2))
    assert.equal(tracks.get('Param57').sample(t), 0, 'Param57 at ' + t.toFixed(2))
  }
})

test('模型没有这两条通道时仍然出片，不能因为补轨道而构建失败', () => {
  const bare = rig().filter((p) => p.id !== 'Param56' && p.id !== 'Param57')
  const motion = subject.buildDafishBodyLedHappyMotion(bare)
  assert.ok(motion, '缺通道时必须仍然构建成功')
  const ids = motion.Curves.map((c) => c.Id)
  assert.equal(ids.includes('Param56'), false)
  assert.equal(ids.includes('Param57'), false)
})
