/**
 * Cubism 4.2+ Multiply & Screen Color extension for pixi-live2d-display 0.4.0.
 *
 * 背景与原理：
 * 1. Live2D Cubism 4.2+ 在核心模型数据中为每个 Drawable 增加了 multiplyColors 与 screenColors。
 * 2. 现代面向 VTube Studio 设计的模型（如大肥鱼的鼻头 ArtMesh246/ArtMesh682、脸红 ArtMesh607/608、衣服阴影等）
 *    将网格贴图底色设为黑色或高反差色，依靠着色器的 Multiply 与 Screen（滤色）向量在 GPU 动态合成出真实的肤色/高光。
 * 3. pixi-live2d-display 0.4.0 原生着色器只支持 Cubism 4.0 基础着色，未读取这两种颜色向量，导致未滤色的黑块直接绘制在脸上。
 * 4. 本模块在运行时无侵入扩展 CubismShader_WebGL 与 CubismRenderer_WebGL，将标准 GPU 混合公式注入片元着色器：
 *    c.rgb = c.rgb * u_multiplyColor.rgb;
 *    c.rgb = (c.rgb + u_screenColor.rgb * c.a) - (c.rgb * u_screenColor.rgb);
 *    实现与 VTube Studio 100% 一致的色彩与光影还原。
 */

export interface CubismColorPatchedModule {
  __utaDrawableColor?: string
  CubismShader_WebGL?: any
  CubismRenderer_WebGL?: any
}

const COLOR_HEADER = 'uniform vec4 u_multiplyColor;uniform vec4 u_screenColor;'
const COLOR_BODY = 'c.rgb=c.rgb*u_multiplyColor.rgb;c.rgb=(c.rgb+u_screenColor.rgb*c.a)-(c.rgb*u_screenColor.rgb);'

const VERTEX_SHADER_SRC =
  'attribute vec4 a_position;attribute vec2 a_texCoord;varying vec2 v_texCoord;uniform mat4 u_matrix;void main(){gl_Position=u_matrix*a_position;v_texCoord=a_texCoord;v_texCoord.y=1.0-v_texCoord.y;}'

const VERTEX_SHADER_SRC_MASKED =
  'attribute vec4 a_position;attribute vec2 a_texCoord;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform mat4 u_matrix;uniform mat4 u_clipMatrix;void main(){gl_Position=u_matrix*a_position;v_clipPos=u_clipMatrix*a_position;v_texCoord=a_texCoord;v_texCoord.y=1.0-v_texCoord.y;}'

const FRAGMENT_SHADER_SRC =
  'precision mediump float;varying vec2 v_texCoord;uniform vec4 u_baseColor;uniform sampler2D s_texture0;' +
  COLOR_HEADER +
  'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' +
  COLOR_BODY +
  'gl_FragColor=c*u_baseColor;}'

const FRAGMENT_SHADER_SRC_MASKED =
  'precision mediump float;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform vec4 u_baseColor;uniform vec4 u_channelFlag;uniform sampler2D s_texture0;uniform sampler2D s_texture1;' +
  COLOR_HEADER +
  'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' +
  COLOR_BODY +
  'c=c*u_baseColor;vec4 clipMask=(1.0-texture2D(s_texture1,v_clipPos.xy/v_clipPos.w))*u_channelFlag;float maskVal=clipMask.r+clipMask.g+clipMask.b+clipMask.a;gl_FragColor=c*maskVal;}'

const FRAGMENT_SHADER_SRC_INVERTED =
  'precision mediump float;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform vec4 u_baseColor;uniform vec4 u_channelFlag;uniform sampler2D s_texture0;uniform sampler2D s_texture1;' +
  COLOR_HEADER +
  'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' +
  COLOR_BODY +
  'c=c*u_baseColor;vec4 clipMask=(1.0-texture2D(s_texture1,v_clipPos.xy/v_clipPos.w))*u_channelFlag;float maskVal=clipMask.r+clipMask.g+clipMask.b+clipMask.a;gl_FragColor=c*(1.0-maskVal);}'

const patchedModules = new WeakSet<object>()
let globalInstalled = false

/**
 * 将 VTube Studio / Cubism 4.2+ Multiply & Screen 颜色支持安装到 Live2D WebGL 渲染管线。
 * 该操作是幂等的，已安装则自动跳过。
 * 注意：ES Module namespace 对象（如 import * as cubism4）属于非扩展对象（Object.isExtensible === false），
 * 绝不能直接在其上挂载属性，必须记录在 WeakSet 或原型对象上。
 */
export function installCubismDrawableColor(target: CubismColorPatchedModule): boolean {
  if (!target) return false
  if (globalInstalled && typeof target === 'object' && patchedModules.has(target)) return true

  const Shader = target.CubismShader_WebGL
  const Renderer = target.CubismRenderer_WebGL
  if (!Shader?.prototype || !Renderer?.prototype) {
    return false
  }

  if (Shader.prototype.__utaDrawableColor) {
    return true
  }

  // 1. 拦截 Shader.prototype.generateShaders，编译包含 u_multiplyColor / u_screenColor 的着色器程序
  const originalGenerate = Shader.prototype.generateShaders
  Shader.prototype.generateShaders = function generateShadersWithDrawableColor(this: any) {
    originalGenerate.call(this)

    const previous = [1, 2, 3].map((index) => this._shaderSets?.[index]?.shaderProgram)
    this._shaderSets[1].shaderProgram = this.loadShaderProgram(VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC)
    this._shaderSets[2].shaderProgram = this.loadShaderProgram(VERTEX_SHADER_SRC_MASKED, FRAGMENT_SHADER_SRC_MASKED)
    this._shaderSets[3].shaderProgram = this.loadShaderProgram(VERTEX_SHADER_SRC_MASKED, FRAGMENT_SHADER_SRC_INVERTED)

    // 复制复用对应着色器程序至变体槽位 (Add/Mult blend modes)
    this._shaderSets[4].shaderProgram = this._shaderSets[7].shaderProgram = this._shaderSets[1].shaderProgram
    this._shaderSets[5].shaderProgram = this._shaderSets[8].shaderProgram = this._shaderSets[2].shaderProgram
    this._shaderSets[6].shaderProgram = this._shaderSets[9].shaderProgram = this._shaderSets[3].shaderProgram

    // 释放旧 program 避免 WebGL 显存泄漏
    for (const program of previous) {
      if (program) this.gl.deleteProgram(program)
    }

    const bind = (index: number, masked: boolean) => {
      const set = this._shaderSets[index]
      const program = set.shaderProgram
      set.attributePositionLocation = this.gl.getAttribLocation(program, 'a_position')
      set.attributeTexCoordLocation = this.gl.getAttribLocation(program, 'a_texCoord')
      set.samplerTexture0Location = this.gl.getUniformLocation(program, 's_texture0')
      set.uniformMatrixLocation = this.gl.getUniformLocation(program, 'u_matrix')
      set.uniformBaseColorLocation = this.gl.getUniformLocation(program, 'u_baseColor')
      set.uniformMultiplyColorLocation = this.gl.getUniformLocation(program, 'u_multiplyColor')
      set.uniformScreenColorLocation = this.gl.getUniformLocation(program, 'u_screenColor')
      if (masked) {
        set.samplerTexture1Location = this.gl.getUniformLocation(program, 's_texture1')
        set.uniformClipMatrixLocation = this.gl.getUniformLocation(program, 'u_clipMatrix')
        set.uniformChannelFlagLocation = this.gl.getUniformLocation(program, 'u_channelFlag')
      }
    }

    for (const index of [1, 4, 7]) bind(index, false)
    for (const index of [2, 3, 5, 6, 8, 9]) bind(index, true)
  }

  // 2. 拦截 Shader.prototype.setupShaderProgram，在每一次 drawMesh 激活着色器时向 GPU 提交颜色 Uniform
  const originalSetup = Shader.prototype.setupShaderProgram
  Shader.prototype.setupShaderProgram = function setupShaderProgramWithDrawableColor(
    this: any,
    renderer: any,
    textureId: any,
    vertexCount: any,
    vertexArray: any,
    indexArray: any,
    uvArray: any,
    bufferData: any,
    opacity: any,
    colorBlendMode: any,
    baseColor: any,
    isPremultipliedAlpha: any,
    matrix4x4: any,
    invertedMask: any,
  ) {
    originalSetup.call(
      this,
      renderer,
      textureId,
      vertexCount,
      vertexArray,
      indexArray,
      uvArray,
      bufferData,
      opacity,
      colorBlendMode,
      baseColor,
      isPremultipliedAlpha,
      matrix4x4,
      invertedMask,
    )

    if (renderer.getClippingContextBufferForMask()) return

    const clipping = renderer.getClippingContextBufferForDraw()
    const shaderIndex =
      (clipping ? (invertedMask ? 2 : 1) : 0) + (colorBlendMode === 1 ? 3 : colorBlendMode === 2 ? 6 : 0) + 1
    const set = this._shaderSets?.[shaderIndex]
    if (!set || set.uniformMultiplyColorLocation == null) return

    const index = renderer._drawableIndex
    const cubismModel = renderer.getModel()
    const coreModel = cubismModel?.getModel ? cubismModel.getModel() : cubismModel?._model
    const drawables = coreModel?.drawables
    const multiply = drawables?.multiplyColors
    const screen = drawables?.screenColors

    const offset = index * 4
    const hasMult = Boolean(multiply && index >= 0 && offset + 3 < multiply.length)
    const hasScreen = Boolean(screen && index >= 0 && offset + 3 < screen.length)

    this.gl.uniform4f(
      set.uniformMultiplyColorLocation,
      hasMult ? multiply[offset] : 1,
      hasMult ? multiply[offset + 1] : 1,
      hasMult ? multiply[offset + 2] : 1,
      hasMult ? multiply[offset + 3] : 1,
    )
    this.gl.uniform4f(
      set.uniformScreenColorLocation,
      hasScreen ? screen[offset] : 0,
      hasScreen ? screen[offset + 1] : 0,
      hasScreen ? screen[offset + 2] : 0,
      hasScreen ? screen[offset + 3] : 1,
    )
  }

  // 3. 拦截 Renderer.prototype.doDrawModel，在循环遍历各网格时记录当前绘制的 _drawableIndex
  Renderer.prototype.doDrawModel = function doDrawModelWithDrawableIndex(this: any) {
    this.preDraw()
    if (this._clippingManager != null) {
      this._clippingManager.setupClippingContext(this.getModel(), this)
    }
    const drawableCount = this.getModel().getDrawableCount()
    const renderOrder = this.getModel().getDrawableRenderOrders()
    for (let i = 0; i < drawableCount; ++i) {
      this._sortedDrawableIndexList[renderOrder[i]] = i
    }
    try {
      for (let i = 0; i < drawableCount; ++i) {
        const drawableIndex = this._sortedDrawableIndexList[i]
        if (!this.getModel().getDrawableDynamicFlagIsVisible(drawableIndex)) {
          continue
        }
        this._drawableIndex = drawableIndex
        this.setClippingContextBufferForDraw(
          this._clippingManager != null ? this._clippingManager.getClippingContextListForDraw()[drawableIndex] : null,
        )
        this.setIsCulling(this.getModel().getDrawableCulling(drawableIndex))
        this.drawMesh(
          this.getModel().getDrawableTextureIndices(drawableIndex),
          this.getModel().getDrawableVertexIndexCount(drawableIndex),
          this.getModel().getDrawableVertexCount(drawableIndex),
          this.getModel().getDrawableVertexIndices(drawableIndex),
          this.getModel().getDrawableVertices(drawableIndex),
          this.getModel().getDrawableVertexUvs(drawableIndex),
          this.getModel().getDrawableOpacity(drawableIndex),
          this.getModel().getDrawableBlendMode(drawableIndex),
          this.getModel().getDrawableInvertedMaskBit(drawableIndex),
        )
      }
    } finally {
      this._drawableIndex = -1
    }
  }

  Shader.prototype.__utaDrawableColor = 'vts-cubism42-color-v1'
  if (typeof target === 'object' && target !== null) {
    try {
      patchedModules.add(target)
      if (Object.isExtensible(target)) {
        target.__utaDrawableColor = 'vts-cubism42-color-v1'
      }
    } catch {
      // 安全忽略对只读对象的属性赋值
    }
  }
  globalInstalled = true
  return true
}
