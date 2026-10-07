import type { BlockArg, BlockNode, BlockProgram } from '../engine/types';
import { uid } from '../engine/util';

/** Builds a block node: b('op', { slot: value }, { mouth: [blocks] }). */
export function b(op: string, args: Record<string, BlockArg> = {}, stacks?: Record<string, BlockNode[]>): BlockNode {
  return stacks ? { id: uid('blk_'), op, args, stacks } : { id: uid('blk_'), op, args };
}

const prop = (name: string) => b('var.prop', { v: name });
const each = () => b('sensing.each');

/** The Mine of the demo, built from blocks (same behaviour as MINE_SCRIPT). */
export function mineBlocks(): BlockProgram {
  return {
    vars: [
      { name: 'victims', value: 'player, enemy', prop: true },
      { name: 'damage', value: 999, prop: true },
      { name: 'warnRadius', value: 110, prop: true },
      { name: 'calmColor', value: '#5c6b7a', prop: true },
      { name: 'warnColor', value: '#ff5a4d', prop: true },
      { name: 'near', value: 0, prop: false },
    ],
    stacks: [
      {
        x: 30,
        y: 30,
        blocks: [
          b('events.start'),
          b('control.forever', {}, {
            do: [
              b('var.set', { v: 'near', x: '0' }),
              b('control.each', { t: prop('victims') }, {
                do: [
                  // Touch: kill (unless the victim ignores the hit, e.g. an immune form).
                  b('control.if', { c: b('sensing.touching', { a: each() }) }, {
                    do: [
                      b('actions.damage', { a: each(), n: prop('damage') }),
                      b('control.if', { c: b('op.not', { a: b('sensing.aliveOf', { a: each() }) }) }, {
                        do: [
                          b('actions.burst', { n: 30, c: prop('warnColor') }),
                          b('actions.log', { t: b('op.join', { a: b('sensing.of', { p: 'name', a: b('sensing.self') }), b: b('op.join', { a: ' killed ', b: b('sensing.of', { p: 'name', a: each() }) }) }) }),
                        ],
                      }),
                    ],
                  }),
                  // Proximity: remember that someone is close.
                  b('control.if', { c: b('op.lt', { a: b('sensing.distance', { a: each() }), b: prop('warnRadius') }) }, {
                    do: [b('var.set', { v: 'near', x: '1' })],
                  }),
                ],
              }),
              b('control.ifElse', { c: b('op.eq', { a: b('var.get', { v: 'near' }), b: '1' }) }, {
                do: [b('looks.color', { c: prop('warnColor') })],
                else: [b('looks.color', { c: prop('calmColor') })],
              }),
            ],
          }),
        ],
      },
    ],
  };
}

/** A wooden crate built from blocks: 2 health, burns (its kinds 'crate, wood' do the rest). */
export function crateBlocks(): BlockProgram {
  return {
    vars: [],
    stacks: [
      { x: 30, y: 30, blocks: [b('events.start'), b('actions.setHealth', { n: 2 })] },
      {
        x: 30,
        y: 120,
        blocks: [
          b('events.hit'),
          b('actions.changeHealth', { n: b('op.sub', { a: 0, b: b('sensing.hitDamage') }) }),
          b('looks.flash', { s: 0.2 }),
          b('control.if', { c: b('op.lt', { a: b('actions.health'), b: '1' }) }, {
            do: [b('actions.burst', { n: 24, c: '#c08a4a' }), b('actions.log', { t: b('op.join', { a: b('sensing.of', { p: 'name', a: b('sensing.self') }), b: ' burned down' }) }), b('actions.destroy')],
          }),
        ],
      },
      // Blink while burning.
      { x: 30, y: 330, blocks: [b('events.status', { s: 'burning' }), b('looks.flash', { s: b('interact.left', { s: 'burning' }) })] },
    ],
  };
}
