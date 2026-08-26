import { el } from './dom'

export function codeOutput(label: string, code: string): HTMLElement {
  const field = el('textarea', { rows: '3', readonly: 'readonly' })
  field.value = code
  const copy = el('button', {}, ['Copy'])
  const status = el('span', { class: 'muted' })

  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(code).then(
      () => { status.textContent = 'copied' },
      () => { field.select(); status.textContent = 'press ⌘C / Ctrl+C' },
    )
  })

  return el('div', { class: 'codebox' }, [
    el('label', {}, [label]), field, el('div', { class: 'row' }, [copy, status]),
  ])
}

export function codeInput(
  label: string,
  onSubmit: (code: string) => void,
): { node: HTMLElement; setError(msg: string): void; clear(): void } {
  const field = el('textarea', { rows: '3', placeholder: 'paste the code here' })
  const submit = el('button', {}, ['Continue'])
  const error = el('p', { class: 'error-text' })

  const fire = (): void => {
    const value = field.value.trim()
    if (value === '') return
    error.textContent = ''
    onSubmit(value)
  }
  submit.addEventListener('click', fire)

  return {
    node: el('div', { class: 'codebox' }, [
      el('label', {}, [label]), field, el('div', { class: 'row' }, [submit]), error,
    ]),
    setError: (msg) => { error.textContent = msg },
    clear: () => { field.value = ''; error.textContent = '' },
  }
}
