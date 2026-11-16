'use strict'
// DS 鼠控版专用适配表：35 个显式控件、正确分类和干净标签的内容回归。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const adapter = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../docs/models/ds-adapter.json'), 'utf8'),
)

const EXPECTED = {
  face_effect: [
    '爱心眼', '悲伤', '生气', '流汗', '撤回', '呆呆眼', 'MoeMoeQ~',
    '情绪花花', '吐魂', '吐舌', '心跳', '冒爱心动画',
    '开心兴奋', '星星眼', '脸红', '哭', '闭眼口水', '问号', '感叹号',
  ],
  pose_prop: [
    '使巴菲消失', '蛋包饭', '点菜按下', '画笔', '喵喵手~喵~动画',
    '魔爪', '魔爪换色', '手机换色', '双手比耶', '橡皮', '手机手',
  ],
  hair: ['单边马尾'],
  outfit: [
    '方眼镜', '蝴蝶结贴纸', '鲸鱼', '鲸鱼放桌上', '猫猫贴纸', '墨镜',
    '深色桌布', '头箍', '兔兔贴纸', '椭圆眼镜', '圆眼镜',
  ],
}

test('DS adapter explicitly classifies all 42 controls', () => {
  const controls = adapter.controls || {}
  assert.equal(Object.keys(controls).length, 42)
  for (const [category, ids] of Object.entries(EXPECTED)) {
    const actual = Object.entries(controls)
      .filter(([, value]) => value.category === category)
      .map(([id]) => id)
      .sort()
    assert.equal(actual.join(','), [...ids].sort().join(','), category)
  }
})

test('every DS control resolves through an expression or explicit parameters', () => {
  for (const [id, control] of Object.entries(adapter.controls || {})) {
    assert.ok(control.label && control.label.trim(), `${id} needs a label`)
    assert.ok(
      (typeof control.expression === 'string' && control.expression) ||
        (control.parameters && Object.keys(control.parameters).length > 0),
      `${id} needs an expression or parameters`,
    )
    assert.notEqual(control.category, 'toggle', `${id} should not fall back to toggle`)
  }
  assert.equal(new Set(Object.values(adapter.controls).map((control) => control.label)).size, 42)
})

test('DS adapter uses clean labels and the idle motion group', () => {
  assert.deepEqual(adapter.idleMotions, ['idle'])
  const labels = Object.fromEntries(
    Object.entries(adapter.controls).map(([id, control]) => [id, control.label]),
  )
  assert.equal(labels['使巴菲消失'], '巴菲')
  assert.equal(labels['MoeMoeQ~'], '挤压')
  assert.equal(labels['喵喵手~喵~动画'], '喵喵手')
  assert.equal(labels['猫猫贴纸'], '猫猫耳')
  assert.equal(labels['兔兔贴纸'], '兔兔耳')
  assert.equal(labels['冒爱心动画'], '爱心动画')
  assert.equal(adapter.controls['冒爱心动画'].expression, 'love')
  assert.deepEqual(adapter.controls['手机手'].parameters, { phone: 1 })
})
