import { useContext } from 'react'

import { UiPreferencesContext } from './ui-preferences-context'

export function useUiPreferences() {
  const context = useContext(UiPreferencesContext)
  if (!context) {
    throw new Error('useUiPreferences must be used within UiPreferencesProvider')
  }
  return context
}
