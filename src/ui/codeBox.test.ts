// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { codeOutput, codeInput } from './codeBox'

describe('codeOutput', () => {
  it('shows the code in a readonly field', () => {
    const node = codeOutput('Your join code', 'ABC123')
    const field = node.querySelector('textarea')!
    expect(field.value).toBe('ABC123')
    expect(field.readOnly).toBe(true)
  })

  it('copies to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const node = codeOutput('x', 'ABC123')
    node.querySelector('button')!.click()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('ABC123')
  })
})

describe('codeInput', () => {
  it('submits the trimmed value', () => {
    const onSubmit = vi.fn()
    const { node } = codeInput('Paste it', onSubmit)
    node.querySelector('textarea')!.value = '  ABC123  '
    node.querySelector('button')!.click()
    expect(onSubmit).toHaveBeenCalledWith('ABC123')
  })

  it('does not submit an empty value', () => {
    const onSubmit = vi.fn()
    const { node } = codeInput('Paste it', onSubmit)
    node.querySelector('button')!.click()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows and clears an error', () => {
    const { node, setError, clear } = codeInput('Paste it', vi.fn())
    setError('nope')
    expect(node.textContent).toContain('nope')
    clear()
    expect(node.textContent).not.toContain('nope')
  })
})
