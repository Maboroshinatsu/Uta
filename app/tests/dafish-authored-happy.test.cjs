const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./support/settings-loader.cjs')()
const authored=load('renderer/services/live2d/dafish-authored-happy')
const common=load('renderer/services/live2d/dafish-happy-performance')
function parameters(){return ['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','Movement1','Movement2','Movement3','Param59','Param60','Param61','Param62','Param36','Param39','Param41','Param42','Param43','Param56','Param57','ParamMouthForm','ParamMouthOpenY','ParamEyeLOpen','ParamEyeROpen','ParamEyeBallX','ParamEyeBallY','ParamBrowLY','ParamBrowRY','key4','key7','JawOpen'].map(id=>({id,min:id.startsWith('Movement')?0:-30,max:id.startsWith('Movement')?1:30,default:0}))}
test('authored happy works with rig parameters and zero source motion assets',()=>{
 const motion=authored.buildDafishAuthoredHappyMotion(parameters())
 assert.ok(motion);assert.equal(motion.Meta.Duration,17.6)
 const tracks=new Map(motion.Curves.map(c=>[c.Id,common.compileMotionTrack(c.Segments)]))
 assert.equal(tracks.get('Movement1').sample(5),0,'no copied dogtail gesture')
 assert.ok(tracks.get('Movement2').sample(4)>0.99,'own chest gesture is visible')
 assert.equal(tracks.get('Movement2').sample(15),0,'hand releases')
 assert.ok(tracks.get('AngleY').sample(1.9)>4)
 assert.ok(tracks.get('AngleY').sample(5.35)<-3,'authored nod has its own timing')
 assert.ok(tracks.get('PositionX').sample(8)>0,'does not alternate sides every half cycle')
 for(const c of motion.Curves){assert.equal(c.Segments[1],c.Segments.at(-1),c.Id+' loop seam');assert.ok(c.Segments.every(Number.isFinite))}
})
test('independent joint curves stay bounded and join with continuous velocity',()=>{
 const track=authored.authoredTrack([[0,0],[1,1],[2,0],[4,0]])
 for(let t=0;t<=4;t+=.01)assert.ok(track(t)>=-1e-8&&track(t)<=1+1e-8)
 assert.ok(Math.abs(track(1-.00001)-track(1+.00001))<.00001)
 const a=authored.buildDafishAuthoredHappyMotion(parameters().filter(p=>p.id!=='AngleY'))
 assert.equal(a,null)
 const b=authored.buildDafishAuthoredHappyMotion(parameters(),['key7'])
 assert.ok(!b.Curves.some(c=>c.Id==='key7'))
})
test('both versions coexist and their ownership follows the live version',()=>{
 const manager={definitions:{},motionGroups:{},state:{},createMotion:data=>({data})}
 const model={internalModel:{motionManager:manager}}
 const data=authored.buildDafishAuthoredHappyMotion(parameters())
 assert.ok(common.registerDafishGeneratedMotion(model,common.DAFISH_HAPPY_MOTION,data))
 assert.ok(authored.installDafishAuthoredHappyMotion(model,parameters()))
 assert.ok(manager.definitions[common.DAFISH_HAPPY_MOTION])
 assert.ok(manager.definitions[authored.DAFISH_AUTHORED_HAPPY_MOTION])
 manager.state.currentGroup=authored.DAFISH_AUTHORED_HAPPY_MOTION
 assert.ok(common.getDafishHappyOwnedParameters(model).has('Movement2'))
 manager.state.currentGroup='IDLE';assert.equal(common.getDafishHappyOwnedParameters(model).size,0)
 assert.notEqual(authored.createDafishAuthoredHappyPreset().id,common.createDafishHappyPreset().id)
})
