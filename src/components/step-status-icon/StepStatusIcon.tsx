import { makeStyles, mergeClasses, Spinner, tokens } from '@fluentui/react-components'
import { CheckmarkCircle20Regular, Circle20Regular } from '@fluentui/react-icons'
import { useLayoutEffect, useRef, useState } from 'react'
/**
 * A task step's state; Luma's `TaskStepStatus` (src/types/conversation.ts
 * there), with one of Mica's own: `pending-approval`, a step that is done but
 * waits for someone to approve it.
 */
export type TaskStepStatus = 'done' | 'in-progress' | 'pending' | 'pending-approval'

/*
 * Motion is matched frame by frame to the reference promo; docs/COMPONENTS.md
 * ("Step status icon") lists every phase. Geometry is the design's: the dots
 * are Figma's progress-indicator.svg (four r=3 dots, white at 80%) turned 45°,
 * drawn inline so each dot can move. The finished ring and check trace
 * Fluent's CheckmarkCircle20Regular, which takes over when the transition ends.
 *
 * Pending approval is Mica's: Fluent's tiny Spinner, reached by the same
 * phases. The dots close into a ring as they do for the check, but one the
 * size of the Spinner's track, which then dims into the track as the
 * Spinner's arc comes in, so the Spinner takes over the same way. On approval
 * the arc fades, the track firms up into the check's ring, and the check
 * draws on as it does after the dots.
 *
 * Every state draws a 20px icon centred in a 32px box, so none can sit off
 * centre whatever holds it.
 */

/** One full turn, clockwise and linear (288°/s). */
const spinMs = 1250
/** From the status change to the finished check. */
const completeMs = 875
/** Pending approval to done: the arc fades as the track firms into the check's ring, then the check draws on. */
const approveMs = 375
/** Dot centre distance from the icon centre: the 14px asset's corners turned 45°. */
const orbit = 4 * Math.SQRT2
const easeOutSine = 'cubic-bezier(0.61, 1, 0.88, 1)'
const easeOutCubic = 'cubic-bezier(0.33, 1, 0.68, 1)'
const easeOutQuint = 'cubic-bezier(0.22, 1, 0.36, 1)'
const easeInExpo = 'cubic-bezier(0.7, 0, 0.84, 0)'
const easeInOutCubic = 'cubic-bezier(0.65, 0, 0.35, 1)'
/** easeOutQuint starts at 1/0.22 of its average speed; this starts the spin-down 1.5× faster than the spin. */
const spinDownMsPerDegree = 1 / 0.22 / (1.5 * (360 / spinMs))

/** CheckmarkCircle20Regular's ring, as [outer radius, inner radius]. */
const checkRing = [8, 7] as const
/**
 * The tiny Spinner's track: its mask draws a ring solid from radius 8 to 9
 * with a 1px soft edge either side, so it reads as a 2px ring from 7.5 to 9.5.
 */
const trackRing = [9.5, 7.5] as const
/** How strong the Spinner's track is against its arc, both in the icon's colour. */
const trackAlpha = 0.2

/** Keyframe offset of a moment in a transition `total` ms long (the dots closing, by default). */
const at = (ms: number, total = completeMs) => `${((ms / total) * 100).toFixed(2)}%`

/** Starts each dot's dip as it passes 145° clockwise from 12 o'clock, so the small dot stays near 7 o'clock. */
const dipDelayMs = (index: number) => -(((index * 90 - 145 + 360) % 360) / 360) * spinMs

/**
 * The merged dot opening into the check's ring, as [ms, outer radius, inner radius].
 * The circle (r 7.5) is scaled by s with stroke width w, so
 * outer = s(7.5 + w/2) and inner = s(7.5 - w/2).
 */
const ringFrames: readonly (readonly [number, number, number])[] = [
  [417, 3, 0], // the four dots meet as one solid dot
  [458, 7.32, 0.66],
  [500, 8.76, 4.73],
  [542, 9, 6.3], // overshoots the final size by 12%
  [583, 8.92, 6.87],
  [625, 8.28, 6.96],
  [667, 8.04, 6.96],
  [708, 8, 7], // CheckmarkCircle20Regular's ring
]

function ringStyle(outer: number, inner: number, opacity: number) {
  const scale = (outer + inner) / 15
  return { opacity, transform: `scale(${scale.toFixed(4)})`, strokeWidth: `${((outer - inner) / scale).toFixed(4)}px` }
}

/** The merged dot opening into a ring of `[outer, inner]`: ringFrames, stretched from the check's ring to it. */
function ringOpening([outer, inner]: readonly [number, number]) {
  const toOuter = (o: number) => 3 + ((o - 3) * (outer - 3)) / (checkRing[0] - 3)
  const toInner = (i: number) => (i * inner) / checkRing[1]
  return Object.fromEntries([
    [at(0), ringStyle(3, 0, 0)],
    [at(416), ringStyle(3, 0, 0)],
    ...ringFrames.map(([ms, o, i]) => [at(ms), ringStyle(toOuter(o), toInner(i), 0.8 + (0.2 * (ms - 417)) / (708 - 417))]),
  ])
}

const ringKeyframes = { ...ringOpening(checkRing), '100%': ringStyle(...checkRing, 1) }
// Opened to the track's size, the ring dims into the track as the arc comes in.
const trackKeyframes = {
  ...ringOpening(trackRing),
  [at(708)]: { ...ringStyle(...trackRing, 1), animationTimingFunction: easeInOutCubic },
  '100%': ringStyle(...trackRing, trackAlpha),
}

const useStyles = makeStyles({
  // The 32px box every state sits centred in, in the icon's colour.
  box: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    flexShrink: 0,
    color: tokens.colorNeutralForeground1,
  },
  stage: { position: 'relative', width: '20px', height: '20px' },
  layer: { position: 'absolute', top: 0, left: 0, width: '20px', height: '20px', display: 'block' },
  // The Spinner keeps its own display (flex, which lays out its ring).
  spinnerLayer: { position: 'absolute', top: 0, left: 0 },
  root: { overflow: 'visible' },
  rotor: {
    transformBox: 'view-box',
    transformOrigin: '0 0',
    animationName: { to: { transform: 'rotate(360deg)' } },
    animationDuration: `${spinMs}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  dots: { opacity: 0.8, fill: 'currentColor' },
  orbit: { transform: `translateY(-${orbit.toFixed(3)}px)` },
  // One dot at a time eases down to 75.5% and back as it passes the lower left.
  dot: {
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: {
      '0%': { transform: 'scale(1)', animationTimingFunction: easeOutCubic },
      '11%': { transform: 'scale(0.755)' },
      '25%': { transform: 'scale(0.755)', animationTimingFunction: easeOutCubic },
      '39%': { transform: 'scale(1)' },
      '100%': { transform: 'scale(1)' },
    },
    animationDuration: `${spinMs}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  ring: { opacity: 0, fill: 'none', stroke: 'currentColor', transformBox: 'fill-box', transformOrigin: 'center' },
  check: {
    opacity: 0,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1px',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeDasharray: '1 1',
  },
  // The Spinner in the icon's colour: its arc as is, its track faint.
  spinnerRing: {
    color: 'inherit',
    backgroundColor: `color-mix(in srgb, currentColor ${trackAlpha * 100}%, transparent)`,
  },
  // While the drawn ring stands in for the track.
  trackHidden: { backgroundColor: 'transparent' },

  // Transition classes: one shared duration per transition so every phase stays in step.
  merge: {
    animationName: { [at(0)]: { opacity: 0.8 }, [at(416)]: { opacity: 0.8 }, [at(417)]: { opacity: 0 }, '100%': { opacity: 0 } },
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  // Spread out by 39%, hang, then snap to the centre.
  collapse: {
    animationName: {
      [at(0)]: { transform: `translateY(-${orbit.toFixed(3)}px)`, animationTimingFunction: easeOutSine },
      [at(208)]: { transform: `translateY(-${(orbit * 1.39).toFixed(3)}px)`, animationTimingFunction: easeInExpo },
      [at(417)]: { transform: 'translateY(0)' },
      '100%': { transform: 'translateY(0)' },
    },
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  ringIn: {
    animationName: ringKeyframes,
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  trackIn: {
    animationName: trackKeyframes,
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  // Draws on from the short leg; its round cap shows at full opacity from the first frame.
  checkIn: {
    animationName: {
      [at(0)]: { opacity: 0, strokeDashoffset: '1' },
      [at(624)]: { opacity: 0, strokeDashoffset: '1' },
      [at(625)]: { opacity: 1, strokeDashoffset: '1', animationTimingFunction: easeInOutCubic },
      '100%': { opacity: 1, strokeDashoffset: '0' },
    },
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  // The Spinner's arc comes in as the ring dims, eased as the check draws.
  arcIn: {
    animationName: {
      [at(0)]: { opacity: 0 },
      [at(708)]: { opacity: 0, animationTimingFunction: easeInOutCubic },
      '100%': { opacity: 1 },
    },
    animationDuration: `${completeMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },

  // Approval: the arc fades, the track firms up into the check's ring, the check draws on.
  arcOut: {
    animationName: {
      [at(0, approveMs)]: { opacity: 1, animationTimingFunction: easeOutCubic },
      [at(125, approveMs)]: { opacity: 0 },
      '100%': { opacity: 0 },
    },
    animationDuration: `${approveMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  settle: {
    animationName: {
      [at(0, approveMs)]: { ...ringStyle(...trackRing, trackAlpha), animationTimingFunction: easeOutCubic },
      [at(250, approveMs)]: ringStyle(...checkRing, 1),
      '100%': ringStyle(...checkRing, 1),
    },
    animationDuration: `${approveMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  checkInAfterTrack: {
    animationName: {
      [at(0, approveMs)]: { opacity: 0, strokeDashoffset: '1' },
      [at(124, approveMs)]: { opacity: 0, strokeDashoffset: '1' },
      [at(125, approveMs)]: { opacity: 1, strokeDashoffset: '1', animationTimingFunction: easeInOutCubic },
      '100%': { opacity: 1, strokeDashoffset: '0' },
    },
    animationDuration: `${approveMs}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
})

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The morph a status change plays while shown: the dots closing into the
 * check (`complete`) or the Spinner (`await`), or the Spinner closing into
 * the check (`approve`). Any other change, or any under reduced motion,
 * switches straight to the new icon.
 */
type Transition = 'complete' | 'await' | 'approve'

function transitionFor(from: TaskStepStatus, to: TaskStepStatus): Transition | null {
  if (prefersReducedMotion()) return null
  if (from === 'in-progress' && to === 'done') return 'complete'
  if (from === 'in-progress' && to === 'pending-approval') return 'await'
  if (from === 'pending-approval' && to === 'done') return 'approve'
  return null
}

export interface StepStatusIconProps {
  status: TaskStepStatus
  /** On the 32px box: a colour other than colorNeutralForeground1, say. */
  className?: string
}

/**
 * Status icon for a task step, 20px in a 32px box: an empty circle when
 * pending, the four-dot spinner while in progress, Fluent's Spinner while
 * pending approval, and a checkmark circle when done. A step that goes from
 * in progress to done or to pending approval while shown morphs from the dots
 * into the check or the Spinner, and one approved while shown morphs from the
 * Spinner into the check; under reduced motion each switches straight to its
 * new icon.
 *
 * Its layers keep their places from state to state (the dots, the Spinner,
 * the still icons), so the dots and the Spinner keep turning through a morph
 * rather than starting over.
 */
export function StepStatusIcon({ status, className }: StepStatusIconProps) {
  const styles = useStyles()
  const rotorRef = useRef<SVGGElement>(null)
  const [previousStatus, setPreviousStatus] = useState(status)
  const [transition, setTransition] = useState<Transition | null>(null)
  if (status !== previousStatus) {
    setPreviousStatus(status)
    setTransition(transitionFor(previousStatus, status))
  }
  // The dots close into the check and the Spinner alike.
  const closing = transition === 'complete' || transition === 'await'

  // The spin and the dot dips loop in CSS. Hand them over without a jump:
  // spin down from the current angle to the next "+" at least 45° ahead, and
  // grow the dipped dot back to full size.
  useLayoutEffect(() => {
    const rotor = rotorRef.current
    if (!closing || !rotor) return
    const dots = Array.from(rotor.querySelectorAll('circle'))
    const [spin] = rotor.getAnimations()
    const elapsed = typeof spin?.currentTime === 'number' ? spin.currentTime : 0
    const from = ((elapsed % spinMs) / spinMs) * 360
    const to = Math.ceil((from + 45) / 90) * 90
    const scales = dots.map((dot) => {
      const transform = getComputedStyle(dot).transform
      return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a
    })
    const looping = [...rotor.getAnimations(), ...dots.flatMap((dot) => dot.getAnimations())]
    looping.forEach((animation) => animation.cancel())
    const scripted = [
      rotor.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], {
        duration: (to - from) * spinDownMsPerDegree,
        easing: easeOutQuint,
        fill: 'forwards',
      }),
      ...dots.map((dot, index) =>
        dot.animate([{ transform: `scale(${scales[index]})` }, { transform: 'scale(1)' }], {
          duration: 208,
          easing: easeOutCubic,
          fill: 'forwards',
        }),
      ),
    ]
    return () => {
      scripted.forEach((animation) => animation.cancel())
      if (rotor.isConnected) looping.forEach((animation) => animation.play())
    }
  }, [closing])

  const dotsShown = status === 'in-progress' || closing
  const spinnerShown = status === 'pending-approval' || transition === 'approve'
  const stillIcon =
    status === 'pending' ? (
      <Circle20Regular className={styles.layer} />
    ) : status === 'done' && !transition ? (
      <CheckmarkCircle20Regular className={styles.layer} />
    ) : null

  return (
    <span
      className={mergeClasses(styles.box, className)}
      onAnimationEnd={transition ? () => setTransition(null) : undefined}
    >
      <span className={styles.stage}>
        {dotsShown ? (
          <svg className={mergeClasses(styles.layer, styles.root)} width="20" height="20" viewBox="0 0 20 20">
            <g transform="translate(10 10)">
              <g ref={rotorRef} className={styles.rotor}>
                <g className={mergeClasses(styles.dots, closing && styles.merge)}>
                  {[0, 1, 2, 3].map((index) => (
                    <g key={index} transform={`rotate(${index * 90})`}>
                      <g className={mergeClasses(styles.orbit, closing && styles.collapse)}>
                        <circle className={styles.dot} r="3" style={{ animationDelay: `${dipDelayMs(index)}ms` }} />
                      </g>
                    </g>
                  ))}
                </g>
              </g>
              <circle
                className={mergeClasses(
                  styles.ring,
                  transition === 'complete' && styles.ringIn,
                  transition === 'await' && styles.trackIn,
                )}
                r="7.5"
              />
              <path
                className={mergeClasses(styles.check, transition === 'complete' && styles.checkIn)}
                d="M-3.5 -0.5 L-1 2 L3 -2"
                pathLength={1}
              />
            </g>
          </svg>
        ) : transition === 'approve' ? (
          <svg className={mergeClasses(styles.layer, styles.root)} width="20" height="20" viewBox="0 0 20 20">
            <g transform="translate(10 10)">
              <circle className={mergeClasses(styles.ring, styles.settle)} r="7.5" />
              <path
                className={mergeClasses(styles.check, styles.checkInAfterTrack)}
                d="M-3.5 -0.5 L-1 2 L3 -2"
                pathLength={1}
              />
            </g>
          </svg>
        ) : null}
        {spinnerShown ? (
          <Spinner
            size="tiny"
            aria-hidden
            className={mergeClasses(
              styles.spinnerLayer,
              transition === 'await' && styles.arcIn,
              transition === 'approve' && styles.arcOut,
            )}
            spinner={{ className: mergeClasses(styles.spinnerRing, transition !== null && styles.trackHidden) }}
          />
        ) : null}
        {stillIcon}
      </span>
    </span>
  )
}
