import { makeStyles, mergeClasses } from '@fluentui/react-components'
import type { GriffelStyle } from '@fluentui/react-components'
import { useEffect, useMemo, useRef } from 'react'
// Ported from dxb-luma/src/components/VoiceSkye.tsx; layer geometry and active
// poses match. Mica supplies the existing call state and measured streams.
import { skyeBodyWidth, skyeLayers, skyePalettes } from './skye'
import type { SkyePalette } from './skye'
import { useReducedMotion } from './useReducedMotion'
import type { VoiceState } from './state'

/**
 * How the skye sits in each voice state. `presence` is its opacity. `energy`
 * (about 0–1) is how tall and bright it stands, before the voice adds
 * `gain × level`. `pulse` is a slow breath on top while the assistant works.
 */
interface Pose {
  presence: number
  energy: number
  gain: number
  pulse: number
}

const poses: Record<VoiceState, Pose> = {
  // Mica's resting background is shorter and dimmer; active poses match Luma.
  idle: { presence: 0.42, energy: 0.06, gain: 0, pulse: 0 },
  listening: { presence: 0.9, energy: 0.3, gain: 0.55, pulse: 0 },
  connecting: { presence: 0.7, energy: 0.16, gain: 0, pulse: 0.08 },
  thinking: { presence: 0.7, energy: 0.16, gain: 0, pulse: 0.08 },
  speaking: { presence: 0.85, energy: 0.22, gain: 0.45, pulse: 0 },
  unavailable: { presence: 0.25, energy: 0.03, gain: 0, pulse: 0 },
}

/** Time constants (s): the voice is followed quickly as it rises and let go more slowly; states blend over about half a second. */
const attackS = 0.05
const releaseS = 0.22
const energyS = 0.08
const presenceS = 0.25
/** One breath while thinking. */
const pulseS = 2.4

const energyVar = 'var(--skye-energy, 0)'

/** A slow loop that never stops, so the skye is alive even at rest. Each layer has its own period, so they never line up. */
const sway = (from: string, to: string, seconds: number, property: 'transform' | 'opacity' = 'transform'): GriffelStyle => ({
  animationName: { from: { [property]: from }, to: { [property]: to } },
  animationDuration: `${seconds}s`,
  animationDirection: 'alternate',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
  '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
})

const bodyInset = `${-((skyeBodyWidth - 1) / 2) * 100}%`

const useStyles = makeStyles({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
    transitionProperty: 'height',
    transitionDuration: '500ms',
    transitionTimingFunction: 'ease-in-out',
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms' },
    overflow: 'hidden',
    pointerEvents: 'none',
    isolation: 'isolate',
    opacity: 'var(--skye-presence, 0)',
  },
  resting: { height: '30%' },
  // Each layer is a swaying wrapper (CSS animation) around a layer that stands taller with energy (custom properties).
  body: { position: 'absolute', top: 0, bottom: 0, left: bodyInset, right: bodyInset, transformOrigin: '50% 100%' },
  // The references' frame glows up its sides too. The screen's sides are straight and the skye is
  // shorter than the screen, so those side glows would end in a hard line: they're pushed off screen.
  edge: { position: 'absolute', top: 0, bottom: 0, left: '-120px', right: '-120px' },
  // Blend modes go on the wrapper: it's the one that sits in the skye's group, so it's the one that blends with the layers below.
  lighter: { mixBlendMode: ['screen', 'plus-lighter'] },
  layer: { position: 'absolute', inset: 0, transformOrigin: '50% 100%', willChange: 'transform, opacity' },
  waveSway: sway('translateX(-3%) scaleY(0.95)', 'translateX(3%) scaleY(1.05)', 9.2),
  wave: { transform: `scaleY(calc(0.3 + 0.7 * ${energyVar}))`, opacity: `calc(0.55 + 0.45 * ${energyVar})` },
  crestSway: sway('translateX(6%) scaleY(1.06)', 'translateX(-7%) scaleY(0.9)', 7.4),
  crest: { transform: `scaleY(calc(0.2 + 0.85 * ${energyVar}))`, opacity: `calc(0.4 + 0.6 * ${energyVar})` },
  rimSway: sway('0.75', '1', 4.6, 'opacity'),
  rim: { transform: `scaleY(calc(0.6 + 0.5 * ${energyVar}))`, opacity: `calc(0.15 + 0.5 * ${energyVar})` },
  glowSway: sway('translateX(2%) scaleY(0.94)', 'translateX(-3%) scaleY(1.06)', 6.1),
  glow: { transform: `scaleY(calc(0.25 + 0.8 * ${energyVar}))`, opacity: `calc(0.25 + 0.75 * ${energyVar})` },
  coreSway: sway('scaleX(0.96)', 'scaleX(1.04)', 5.3),
  core: {
    transform: `scale(calc(0.85 + 0.2 * ${energyVar}), calc(0.4 + 0.8 * ${energyVar}))`,
    opacity: `calc(0.35 + 0.65 * ${energyVar})`,
  },
})

export interface VoiceSkyeProps {
  /** The voice pill's state (`ChatToolbar`); the skye follows it. */
  state: VoiceState
  /** How loud the voice is right now, 0–1 (`Agent.voiceLevel`). Read every frame while listening or speaking. */
  level?: () => number
  /** Colours. Defaults to `luma`. */
  palette?: SkyePalette
  className?: string
}

const approach = (from: number, to: number, seconds: number, dt: number) => to + (from - to) * Math.exp(-dt / seconds)
const clamp = (value: number) => Math.min(1, Math.max(0, value))

function paint(root: HTMLElement, presence: number, energy: number) {
  root.style.setProperty('--skye-presence', presence.toFixed(3))
  root.style.setProperty('--skye-energy', energy.toFixed(3))
}

/**
 * Light rising from the bottom of the screen that answers the voice (tokens in
 * `theme/skye.ts`). It sways gently at rest, stands up and follows the
 * traveller's voice while listening, breathes while the assistant works, and
 * follows the assistant's voice while it speaks. Decorative: hidden from
 * screen readers and from the pointer. Under reduced motion it holds still at
 * each state's level.
 */
export function VoiceSkye({ state, level, palette = skyePalettes.luma, className }: VoiceSkyeProps) {
  const styles = useStyles()
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef(level)
  // Where the skye is now. It outlives each state, so a change blends from wherever it was.
  const shown = useRef({ presence: 0, energy: 0, heard: 0 })
  const layers = useMemo(() => skyeLayers(palette), [palette])

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const pose = poses[state]
    const current = shown.current
    if (reducedMotion) {
      Object.assign(current, { presence: pose.presence, energy: pose.energy, heard: 0 })
      paint(root, pose.presence, pose.energy)
      return
    }
    const startedAt = performance.now()
    let last = startedAt
    let frame = 0
    const tick = (time: number) => {
      const dt = Math.min(0.064, (time - last) / 1000)
      last = time
      const loudness = pose.gain > 0 ? clamp(levelRef.current?.() ?? 0) : 0
      current.heard = approach(current.heard, loudness, loudness > current.heard ? attackS : releaseS, dt)
      const breath = pose.pulse * (0.5 - 0.5 * Math.cos((2 * Math.PI * (time - startedAt)) / 1000 / pulseS))
      current.energy = approach(current.energy, pose.energy + pose.gain * current.heard + breath, energyS, dt)
      current.presence = approach(current.presence, pose.presence, presenceS, dt)
      const settled =
        pose.gain === 0 &&
        pose.pulse === 0 &&
        current.heard < 0.001 &&
        Math.abs(current.energy - pose.energy) < 0.001 &&
        Math.abs(current.presence - pose.presence) < 0.001
      // At rest only the CSS sway runs, so an idle screen costs no script.
      if (settled) {
        Object.assign(current, { presence: pose.presence, energy: pose.energy, heard: 0 })
        paint(root, pose.presence, pose.energy)
        return
      }
      paint(root, current.presence, current.energy)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state, reducedMotion])

  return (
    <div ref={rootRef} className={mergeClasses(styles.root, state === 'idle' && styles.resting, className)} aria-hidden="true" data-luma-skye={state}>
      <div className={mergeClasses(styles.body, styles.waveSway)}>
        <div className={mergeClasses(styles.layer, styles.wave)} style={{ backgroundImage: layers.wave }} />
      </div>
      <div className={mergeClasses(styles.body, styles.crestSway)}>
        <div className={mergeClasses(styles.layer, styles.crest)} style={{ backgroundImage: layers.crest }} />
      </div>
      <div className={mergeClasses(styles.edge, styles.rimSway)}>
        <div className={mergeClasses(styles.layer, styles.rim)} style={{ boxShadow: layers.rim }} />
      </div>
      <div className={mergeClasses(styles.body, styles.lighter, styles.glowSway)}>
        <div className={mergeClasses(styles.layer, styles.glow)} style={{ backgroundImage: layers.glow }} />
      </div>
      <div className={mergeClasses(styles.body, styles.lighter, styles.coreSway)}>
        <div className={mergeClasses(styles.layer, styles.core)} style={{ backgroundImage: layers.core }} />
      </div>
    </div>
  )
}
