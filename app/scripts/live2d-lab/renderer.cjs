module.exports = function installLive2DLab() {
  if (window.live2dLab) return { installed: true }
  const vue = document.querySelector('#app').__vue_app__
  const store = vue.config.globalProperties.$pinia._s.get('deskpet')
  const model = store.live2dModel, internal = model.internalModel, core = internal.coreModel
  const caps = store.modelCapabilities
  const physicsOutputs = new Set(caps.parameters.filter(p => p.isPhysicsOutput).map(p => p.id))
  const base = { ...window.deskpetInspectStack().base }
  const defaults = Object.fromEntries(caps.parameters.map(p => [p.id, p.default]))
  const home = { ...defaults, ...base }
  const style = document.createElement('style')
  style.textContent = '.speech-bubbles-anchor { display: none !important; }'
  document.head.appendChild(style)
  const natural = internal.updateNaturalMovements.bind(internal)
  let values = {}, mode = 'input', animation = null, rendered = {}
  let frame = 0, request = 0, renderedRequest = -1
  internal.motionManager.stopAllMotions()
  internal.motionManager.update = () => false
  internal.updateFocus = () => {}
  const apply = (params) => { for (const [id, value] of Object.entries(params)) core.setParameterValueById(id, value) }
  internal.updateNaturalMovements = (dt, now) => {
    natural(dt, now)
    // Freeze unrelated inputs each frame; physics outputs continue to be evaluated normally.
    for (const [id, value] of Object.entries(home)) if (!physicsOutputs.has(id)) core.setParameterValueById(id, value)
    if (animation) values = animation((performance.now() - animation.started) / 1000)
    if (mode === 'input') apply(values)
  }
  internal.on('beforeModelUpdate', () => {
    // Ambient gaze/mouth/breath may run after physics. Keep all other inputs fixed here too.
    for (const [id, value] of Object.entries(home)) {
      if (!physicsOutputs.has(id) && !(id in values)) core.setParameterValueById(id, value)
    }
    if (mode === 'output') apply(values)
    // Cubism restores saved parameters after drawing; sample the values actually rendered.
    rendered = Object.fromEntries(caps.parameters.map(p => [p.id, core.getParameterValueById(p.id)]))
    renderedRequest = request
    frame++
  })
  const before = internal.physics?.evaluate?.bind(internal.physics)
  const inputValues = {}
  if (before) internal.physics.evaluate = (...args) => {
    for (const id of Object.keys(inputValues)) delete inputValues[id]
    for (const id of Object.keys(values)) inputValues[id] = core.getParameterValueById(id)
    return before(...args)
  }
  const ids = new Set(caps.parameters.map(p => p.id))
  window.live2dLab = {
    set(parameters, nextMode = 'input') {
      for (const [id, value] of Object.entries(parameters)) {
        const p = caps.parameters.find(p => p.id === id)
        if (!ids.has(id) || !Number.isFinite(value) || value < p.min || value > p.max) throw new Error('Invalid rig value: ' + id)
      }
      animation = null; values = parameters; mode = nextMode
      return { request: ++request, frame }
    },
    animate(fn) { animation = fn; fn.started = performance.now(); mode = 'input' },
    snapshot() {
      return { frame, request: renderedRequest, requested: { ...values }, beforePhysics: { ...inputValues },
        actual: Object.fromEntries(Object.keys(values).map(id => [id, rendered[id]])),
        outputs: Object.fromEntries([...physicsOutputs].map(id => [id, rendered[id]])) }
    },
    info: { parameters: caps.parameters, signature: window.deskpetInspectModelFacts()?.modelSignature ?? null, base,
      physics: !!internal.physics, internalKeys: Object.keys(internal) },
  }
  return window.live2dLab.info
}
