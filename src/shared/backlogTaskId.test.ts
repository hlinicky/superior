import { describe, expect, it } from 'vitest'
import { parseBacklogTaskId } from './backlogTaskId'

describe('parseBacklogTaskId', () => {
  it('finds a plain reference', () => {
    expect(parseBacklogTaskId('Fix the cart total in task-42')).toBe('task-42')
  })

  it('finds a nested reference', () => {
    expect(parseBacklogTaskId('task-5.1 needs the copy updated')).toBe('task-5.1')
  })

  it('normalises case so the CLI always receives one spelling', () => {
    expect(parseBacklogTaskId('See TASK-7')).toBe('task-7')
  })

  it('takes the first reference when a prompt names several', () => {
    expect(parseBacklogTaskId('do task-3 and then task-9')).toBe('task-3')
  })

  it('ignores a bare number, which is far too common in prose', () => {
    expect(parseBacklogTaskId('fix the 42 failing tests')).toBeUndefined()
  })

  it('does not match a longer word ending in task', () => {
    expect(parseBacklogTaskId('see subtask-42 for detail')).toBeUndefined()
  })

  it('does not match an id that runs into other characters', () => {
    expect(parseBacklogTaskId('the task-42abc branch')).toBeUndefined()
  })

  it('returns undefined for a prompt with no reference at all', () => {
    expect(parseBacklogTaskId('add a dark mode toggle')).toBeUndefined()
  })

  it('returns undefined for an empty prompt', () => {
    expect(parseBacklogTaskId('')).toBeUndefined()
  })

  it('does not match a nested id that runs into other characters', () => {
    expect(parseBacklogTaskId('the task-5.1abc branch')).toBeUndefined()
  })

  it('does not match a deeper nested id that runs into other characters', () => {
    expect(parseBacklogTaskId('task-5.1.2x')).toBeUndefined()
  })

  it('still matches an id ending a sentence', () => {
    expect(parseBacklogTaskId('please fix task-5.')).toBe('task-5')
  })

  it('still matches a nested id followed by punctuation', () => {
    expect(parseBacklogTaskId('task-5.1, then ship')).toBe('task-5.1')
  })
})
