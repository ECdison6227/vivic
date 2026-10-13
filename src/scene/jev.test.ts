import { describe, expect, it } from 'vitest'
import { classify, extractCity, parseChineseNumber, parseTimer } from './jev.ts'

describe('classify', () => {
  it('switches mood without a model', () => {
    expect(classify('背景变红')).toMatchObject({ kind: 'turn', turn: { mood: 'alert' } })
  })

  it('moves between views', () => {
    expect(classify('去待办')).toMatchObject({ kind: 'turn', turn: { view: 'todo', speech: '' } })
    expect(classify('回眼睛')).toMatchObject({ kind: 'turn', turn: { view: 'idle' } })
  })

  it('dismisses a pinned card', () => {
    expect(classify('关掉天气')).toMatchObject({ kind: 'turn', turn: { dismiss: ['type:weather'] } })
  })

  it('sends research to search and weather to weather', () => {
    expect(classify('帮我搜一下乐播投屏')).toMatchObject({ kind: 'search' })
    expect(classify('北京今天天气')).toMatchObject({ kind: 'weather', city: '北京' })
  })

  it('lets an open question through', () => {
    expect(classify('我今天有点乱，帮我收一下')).toBeNull()
  })
})

describe('numbers', () => {
  it('reads chinese durations', () => {
    expect(parseChineseNumber('十五')).toBe(15)
    expect(parseTimer('五分钟后提醒我喝水')).toEqual({ minutes: 5, label: '喝水' })
    expect(extractCity('帮我看天气')).toBeUndefined()
  })
})
