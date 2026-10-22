import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { expect, it, vi } from 'vitest'
import { GlobalStyles, theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))

function Probe() {
  const client = useQueryClient()
  const currentTheme = useTheme()
  return (
    <>
      <p>{client === queryClient ? 'default client' : 'custom client'}</p>
      <p>{currentTheme === theme ? 'design theme' : 'other theme'}</p>
    </>
  )
}

it('provides the default query client, the theme and global styles', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('default client')).toBeVisible()
  expect(screen.getByText('design theme')).toBeVisible()
  expect(GlobalStyles).toHaveBeenCalled()
})

it('uses an injected query client', () => {
  render(
    <AppProviders client={new QueryClient()}>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('custom client')).toBeVisible()
})
