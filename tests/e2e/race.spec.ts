import { test, expect, type Page } from '@playwright/test'

/** Read a generated code out of a readonly code box, waiting for ICE. */
async function readCode(page: Page): Promise<string> {
  const field = page.locator('.codebox textarea[readonly]')
  await expect(field).not.toHaveValue('', { timeout: 30_000 })
  return field.inputValue()
}

const pasteBox = (page: Page) => page.locator('.codebox textarea:not([readonly])')

test('two peers connect, race, and both appear in the results', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()

  await host.goto('/')
  await host.getByPlaceholder('nickname').fill('hosty')
  await host.getByRole('button', { name: 'Create room' }).click()

  await guest.goto('/')
  await guest.getByPlaceholder('nickname').fill('guesty')
  await guest.getByRole('button', { name: 'Join a room' }).click()

  // Guest offers; host answers. This is the whole manual handshake.
  const offer = await readCode(guest)
  await pasteBox(host).fill(offer)
  await host.getByRole('button', { name: 'Continue' }).click()

  const answer = await readCode(host)
  await pasteBox(guest).fill(answer)
  await guest.getByRole('button', { name: 'Continue' }).click()

  // The guest only reaches the roster once the data channel is genuinely open,
  // so this assertion is the real proof the peer connection works.
  await expect(host.locator('.roster')).toContainText('guesty', { timeout: 30_000 })

  await host.getByRole('button', { name: /^Start race/ }).click()
  await host.getByRole('button', { name: 'Go' }).click()

  // Hidden during the countdown, revealed on GO.
  await expect(host.locator('.passage')).toHaveClass(/hidden/)
  await expect(host.locator('.passage')).not.toHaveClass(/hidden/, { timeout: 15_000 })
  await expect(guest.locator('.passage')).not.toHaveClass(/hidden/, { timeout: 15_000 })

  // Both peers must generate identical text from the shared seed.
  const hostText = await host.locator('.passage').innerText()
  const guestText = await guest.locator('.passage').innerText()
  expect(guestText).toBe(hostText)

  const plain = hostText.replace(/\n/g, '')
  await host.keyboard.type(plain, { delay: 1 })

  // A finisher sees their own result immediately, without waiting for others.
  await expect(host.locator('.results')).toBeVisible({ timeout: 30_000 })

  // The guest must see the host's progress relayed over the data channel.
  await expect(guest.locator('.bars')).toContainText('hosty', { timeout: 15_000 })
  await expect(guest.locator('.bar.gone')).toHaveCount(0)

  await guest.keyboard.type(plain, { delay: 1 })

  // With everyone finished, both peers show a complete two-row table.
  for (const page of [host, guest]) {
    await expect(page.locator('.results tbody tr')).toHaveCount(2, { timeout: 30_000 })
    await expect(page.locator('.results')).toContainText('hosty')
    await expect(page.locator('.results')).toContainText('guesty')
  }

  await hostCtx.close()
  await guestCtx.close()
})
