'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/renderer/services/live2d/cubism-color.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const mod = { exports: {} }
Function('module', 'exports', transpiled)(mod, mod.exports)
const { installCubismDrawableColor } = mod.exports

function createMockWebGL() {
  const uniforms = new Map()
  let nextId = 1
  return {
    uniforms,
    getAttribLocation: (prog, name) => 10,
    getUniformLocation: (prog, name) => {
      const id = `${prog.id || 'p'}_${name}`
      uniforms.set(id, null)
      return id
    },
    uniform4f: (loc, r, g, b, a) => {
      uniforms.set(loc, [r, g, b, a])
    },
    deleteProgram: () => {},
  }
}

function createMockCubism4() {
  const gl = createMockWebGL()

  class MockShader {
    constructor() {
      this.gl = gl
      this._shaderSets = []
    }
    loadShaderProgram(v, f) {
      return { id: Math.random().toString(36), v, f }
    }
    generateShaders() {
      for (let i = 0; i < 10; i++) this._shaderSets.push({})
      this._shaderSets[0].shaderProgram = this.loadShaderProgram('v0', 'f0')
      this._shaderSets[1].shaderProgram = this.loadShaderProgram('v1', 'f1')
      this._shaderSets[2].shaderProgram = this.loadShaderProgram('v2', 'f2')
      this._shaderSets[3].shaderProgram = this.loadShaderProgram('v3', 'f3')
    }
    setupShaderProgram() {}
  }

  class MockRenderer {
    constructor(model) {
      this.gl = gl
      this._model = model
      this._sortedDrawableIndexList = []
      this._drawableIndex = -1
      this.drawnMeshes = []
    }
    preDraw() {}
    getModel() {
      return this._model
    }
    getClippingContextBufferForMask() {
      return null
    }
    getClippingContextBufferForDraw() {
      return null
    }
    setIsCulling() {}
    setClippingContextBufferForDraw() {}
    drawMesh(...args) {
      this.drawnMeshes.push({ drawableIndex: this._drawableIndex, args })
    }
    doDrawModel() {}
  }

  return {
    CubismShader_WebGL: MockShader,
    CubismRenderer_WebGL: MockRenderer,
  }
}

test('installCubismDrawableColor: patches Shader and Renderer and sets idempotent flag', () => {
  const target = createMockCubism4()
  const ok1 = installCubismDrawableColor(target)
  assert.equal(ok1, true)
  assert.equal(target.__utaDrawableColor, 'vts-cubism42-color-v1')

  // Idempotent
  const ok2 = installCubismDrawableColor(target)
  assert.equal(ok2, true)
})

test('installCubismDrawableColor: generateShaders injects u_multiplyColor & u_screenColor', () => {
  const target = createMockCubism4()
  installCubismDrawableColor(target)

  const shader = new target.CubismShader_WebGL()
  shader.generateShaders()

  assert.equal(shader._shaderSets.length, 10)
  for (let i = 1; i < 10; i++) {
    assert.ok(shader._shaderSets[i].uniformMultiplyColorLocation, `Shader set ${i} has multiply uniform`)
    assert.ok(shader._shaderSets[i].uniformScreenColorLocation, `Shader set ${i} has screen uniform`)
  }
})

test('installCubismDrawableColor: doDrawModel tracks _drawableIndex during drawMesh', () => {
  const target = createMockCubism4()
  installCubismDrawableColor(target)

  const mockCoreModel = {
    drawables: {
      multiplyColors: new Float32Array([0, 0, 0, 1]),
      screenColors: new Float32Array([1, 0.965, 0.961, 1]),
    },
  }
  const mockCubismModel = {
    getDrawableCount: () => 1,
    getDrawableRenderOrders: () => [0],
    getDrawableDynamicFlagIsVisible: () => true,
    getDrawableCulling: () => false,
    getDrawableTextureIndices: () => 0,
    getDrawableVertexIndexCount: () => 3,
    getDrawableVertexCount: () => 3,
    getDrawableVertexIndices: () => null,
    getDrawableVertices: () => null,
    getDrawableVertexUvs: () => null,
    getDrawableOpacity: () => 1,
    getDrawableBlendMode: () => 0,
    getDrawableInvertedMaskBit: () => false,
    getModel: () => mockCoreModel,
  }

  const renderer = new target.CubismRenderer_WebGL(mockCubismModel)
  renderer.doDrawModel()

  assert.equal(renderer.drawnMeshes.length, 1)
  assert.equal(renderer.drawnMeshes[0].drawableIndex, 0)
  assert.equal(renderer._drawableIndex, -1, 'resets to -1 after drawing')
})

test('installCubismDrawableColor: setupShaderProgram uploads multiply and screen colors to WebGL', () => {
  const target = createMockCubism4()
  installCubismDrawableColor(target)

  const shader = new target.CubismShader_WebGL()
  shader.generateShaders()

  // Nose drawable: black multiply, skin screen
  const mockCoreModel = {
    drawables: {
      multiplyColors: new Float32Array([0, 0, 0, 1]),
      screenColors: new Float32Array([1, 0.9647, 0.9608, 1]),
    },
  }
  const mockCubismModel = {
    getModel: () => mockCoreModel,
  }

  const renderer = new target.CubismRenderer_WebGL(mockCubismModel)
  renderer._drawableIndex = 0

  shader.setupShaderProgram(
    renderer,
    1, // textureId
    3, [], [], [], {},
    1.0, // opacity
    0, // normal blend mode
    [1, 1, 1, 1],
    false,
    null,
    false,
  )

  const multiplyLoc = shader._shaderSets[1].uniformMultiplyColorLocation
  const screenLoc = shader._shaderSets[1].uniformScreenColorLocation

  const multVal = shader.gl.uniforms.get(multiplyLoc)
  const screenVal = shader.gl.uniforms.get(screenLoc)

  assert.deepEqual(multVal, [0, 0, 0, 1], 'Multiply color uploaded correctly')
  assert.ok(Math.abs(screenVal[0] - 1.0) < 1e-4)
  assert.ok(Math.abs(screenVal[1] - 0.9647) < 1e-4)
  assert.ok(Math.abs(screenVal[2] - 0.9608) < 1e-4)
  assert.equal(screenVal[3], 1.0)
})

test('installCubismDrawableColor: handles frozen and non-extensible objects without throwing', () => {
  const target = createMockCubism4()
  Object.freeze(target)
  assert.equal(Object.isExtensible(target), false)

  assert.doesNotThrow(() => {
    const ok = installCubismDrawableColor(target)
    assert.equal(ok, true)
  })
})

test('setupShaderProgram: boundary protection defaults safely when color array is truncated or missing', () => {
  const target = createMockCubism4()
  installCubismDrawableColor(target)

  const shader = new target.CubismShader_WebGL()
  shader.generateShaders()

  // Core model has NO color buffers (e.g. legacy model)
  const mockCoreModel = { drawables: {} }
  const mockCubismModel = { getModel: () => mockCoreModel }
  const renderer = new target.CubismRenderer_WebGL(mockCubismModel)
  renderer._drawableIndex = 5 // Out of bounds

  shader.setupShaderProgram(
    renderer, 1, 3, [], [], [], {}, 1.0, 0, [1, 1, 1, 1], false, null, false,
  )

  const multiplyLoc = shader._shaderSets[1].uniformMultiplyColorLocation
  const screenLoc = shader._shaderSets[1].uniformScreenColorLocation

  assert.deepEqual(shader.gl.uniforms.get(multiplyLoc), [1, 1, 1, 1], 'Defaults to identity multiply')
  assert.deepEqual(shader.gl.uniforms.get(screenLoc), [0, 0, 0, 1], 'Defaults to neutral screen')
})

test('doDrawModel: guarantees _drawableIndex resets to -1 even if drawMesh throws an exception', () => {
  const target = createMockCubism4()
  installCubismDrawableColor(target)

  const mockCubismModel = {
    getDrawableCount: () => 1,
    getDrawableRenderOrders: () => [0],
    getDrawableDynamicFlagIsVisible: () => true,
    getDrawableCulling: () => false,
    getDrawableTextureIndices: () => 0,
    getDrawableVertexIndexCount: () => 3,
    getDrawableVertexCount: () => 3,
    getDrawableVertexIndices: () => null,
    getDrawableVertices: () => null,
    getDrawableVertexUvs: () => null,
    getDrawableOpacity: () => 1,
    getDrawableBlendMode: () => 0,
    getDrawableInvertedMaskBit: () => false,
    getModel: () => ({ drawables: {} }),
  }

  const renderer = new target.CubismRenderer_WebGL(mockCubismModel)
  renderer.drawMesh = () => {
    throw new Error('Simulated WebGL draw error')
  }

  assert.throws(() => renderer.doDrawModel(), /Simulated WebGL draw error/)
  assert.equal(renderer._drawableIndex, -1, 'Safely reset to -1 despite throw')
})
