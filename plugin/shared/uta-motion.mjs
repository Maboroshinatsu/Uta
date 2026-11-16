import { randomUUID } from 'node:crypto'
import { callRuntime } from './uta-runtime-client.mjs'

export const motionSkill = [
  'Use deskpet_motion when the user asks Uta to choreograph a Live2D performance in natural language.',
  '\n## Read the rig and choose its resources',
  'Read capabilities first. Use the returned revision and only the current model’s nativeMotions, controls and input parameter IDs, ranges and defaults. Labels and group names are model data. Do not transfer another model’s parameter values, control meanings or body/head ratios; an available channel is not proof of a visible gesture.',
  'Preview a plausible native clip before rebuilding an authored gesture from scratch. Use nativeMotion with its exact group (even when empty) and zero-based index; a label alone does not establish its appearance. Use parameter tracks for custom gestures or details that the resources do not cover. Explain missing rig support rather than inventing movement.',
  'When combining a native clip with controls or tracks, check its writes and avoid every overlapping parameter or part, including default-valued tracks. If writes are unknown, use the native clip alone. Omit unused parameter tracks: writing defaults still occupies those channels and can suppress automatic blinking or other natural motion.',
  '\n## Choreograph a performance, not a list of poses',
  'Choose a readable action and its main movement first: anticipation, accent, response and settling where appropriate. Use the model’s available body/shoulder/arm inputs for weight and gesture; head rotation and facial changes alone do not establish a whole-body action. Check visible effect before increasing amplitude. A subtle idle and an expressive celebration need different timing and intensity.',
  'Give the lead movement and its followers different peaks and recovery times where the rig supports them. For example, a weight shift can lead the head, with the face reacting and the arms settling later. Small offsets around 80–200 ms are a trial starting point, not a universal recipe. Avoid moving every channel to its extreme together, rigid left/right symmetry, identical duration for every emotion, or returning every channel home on the same beat.',
  'Use a readable accent with a brief living recovery instead of a long frozen endpoint. Judge anticipation, lift and return as paths, not just attractive endpoint poses. Keep blinks brief rather than easing eyelids shut over a long body movement. Leave eye openness untracked when no intentional eye expression is needed; retain physics-driven follow-through instead of scripting its output channels.',
  'Current playback limitation: all parameter keyframe times and control switch times become shared beats, and each resulting segment uses ease-in-out for every tracked parameter. Separate tracks therefore do not have independent easing or continuous velocity through unrelated beats. Keep a small set of intentional beats. Adding dense intermediate keys or many staggered timestamps can create repeated stop/start motion; it is not a smooth-curve fix. Prefer a suitable native clip for fluid motion this player cannot reproduce, and disclose the remaining limitation.',
  '\n## Controls and timeline contract',
  'A clothing/hand/prop control may switch a drawing or an alternate pose rather than animate a joint. Preview its on/off state before using it. Copy the full control ID, including its stage suffix. Place drawing switches where the poses align; do not describe a hand-pose toggle as a continuous arm lift. Avoid cross-fading visibly separated arm drawings.',
  'A controlKeyframes entry is the complete set of temporary controls from its atMs until the next control keyframe. Use [] to release them. Keep held user controls in place. Retain the existing outfit unless changing it is part of the request.',
  'Use a version 1 plan, then validate before play. A native or controls-only plan has tracks: []. Parameter values are model units, times are milliseconds, and time zero is the model default anchor. Merge changes to the same parameter into one track. Across all tracks and controls, shared beats must be at least 40 ms apart and the entire timeline within 12 seconds. Use durationMs to keep the final value beyond its last key; avoid filling unused time with repeated neutral poses.',
  'For example, only if ParamAngleY is exposed with a default of 0 and supports -10: {"version":1,"title":"轻轻点头","tracks":[{"parameterId":"ParamAngleY","keyframes":[{"atMs":340,"value":-10},{"atMs":560,"value":-10},{"atMs":950,"value":0}]}]}. The repeated accent value intentionally holds the nod; it is not an invitation to stop at every intermediate position.',
  '\n## Preview and deliver default presets',
  'Use play and status with the returned jobId to distinguish starting, playing, completed, interrupted and failed. Use stop with the same jobId when requested. On model-changed, fetch capabilities and rebuild the plan. Play previews a one-shot reaction; it does not verify a saved hold or loop. Do not repeatedly replay an interrupted job over the user’s interaction.',
  'Before expanding a full preset set, preview representative idle and expressive actions at the normal pet size. Review the intermediate poses, head/body timing, hand switches, blink speed and return to normal follow. Use actual rendered frames when an image/recording tool is available; otherwise let the user watch and report what remains unverified. A validated timeline or completed job does not establish natural appearance. Revise the demonstrated problem before duplicating the pattern across every emotion.',
  'For default presets, compile_preset uses the exact slotId from presetSlots. Native clips compile as revert. Use hold for a sustained final pose: the timeline runs once, then natural idle may resume beneath its retained state. Use loop only for intentionally repeating parameter/control sequences; loops need two or more steps and must return to model defaults with temporary controls released. Do not claim hold repeats, or select loop merely to keep the pet alive.',
  'Compile returns an import draft without changing the library. Combine draft.presets only under an envelope for the same model and let the user import the JSON in Uta. Preserve user edits outside the requested slots. After import, check the actual hold/loop behavior, loop seam, interruption by another action, and restoration of idle. State separately what was compiled, played once, and visually reviewed; do not claim a whole set was accepted from a single preview.',
].join('\n')

export const motionSkillMarkdown = `---
name: uta-live2d-motion
description: Choreograph and preview actions for the current Uta Live2D pet using native motions, model controls, and parameter tracks. Draft default presets when asked.
---

# Uta Live2D choreography

${motionSkill}
`

export const motionTool = {
  name: 'deskpet_motion',
  description: motionSkill,
  inputSchema: {
    type: 'object',
    required: ['operation'],
    additionalProperties: false,
    properties: {
      operation: { type: 'string', enum: ['capabilities', 'validate', 'compile_preset', 'play', 'status', 'stop'] },
      revision: { type: 'string', description: 'Required for validate, compile_preset and play. Copy it from capabilities.' },
      slotId: { type: 'string', description: 'Required for compile_preset. Copy one default preset slot ID from capabilities.' },
      finishMode: { type: 'string', enum: ['revert', 'hold', 'loop'], description: 'Optional for compile_preset. Defaults to the slot’s finish mode.' },
      plan: {
        type: 'object', required: ['version', 'tracks'], additionalProperties: false,
        properties: {
          version: { type: 'integer', enum: [1] },
          title: { type: 'string', maxLength: 60 },
          durationMs: { type: 'integer', minimum: 40, maximum: 12000 },
          nativeMotion: {
            type: 'object', required: ['group', 'index'], additionalProperties: false,
            properties: { group: { type: 'string' }, index: { type: 'integer', minimum: 0 } },
          },
          controlKeyframes: {
            type: 'array', maxItems: 24,
            items: {
              type: 'object', required: ['atMs', 'controls'], additionalProperties: false,
              properties: {
                atMs: { type: 'integer', minimum: 0, maximum: 12000 },
                controls: { type: 'array', maxItems: 12, items: { type: 'string' } },
              },
            },
          },
          tracks: {
            type: 'array', maxItems: 12,
            items: {
              type: 'object', required: ['parameterId', 'keyframes'], additionalProperties: false,
              properties: {
                parameterId: { type: 'string' },
                keyframes: {
                  type: 'array', minItems: 1, maxItems: 24,
                  items: {
                    type: 'object', required: ['atMs', 'value'], additionalProperties: false,
                    properties: { atMs: { type: 'integer', minimum: 0, maximum: 12000 }, value: { type: 'number' } },
                  },
                },
              },
            },
          },
        },
      },
      jobId: { type: 'string', description: 'Required for status or stop. For play, reuse an ID only to retry the same request.' },
    },
  },
}

export async function runMotionTool(args, { hostId, sessionId = '', env = process.env, request } = {}) {
  if (!hostId) throw new Error('Load the Uta connector for the current host so the motion can be routed to its pet.')
  const { operation, revision, plan, jobId, slotId, finishMode } = args ?? {}
  const payload = { operation, revision, plan, slotId, finishMode,
    jobId: operation === 'play' ? jobId ?? randomUUID() : jobId, hostId, sessionId }
  return request ? request(payload) : callRuntime('POST', '/motion', payload, { env: { ...env, UTA_HOST: hostId } })
}
