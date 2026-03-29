import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { setAppLanguage } from '@/i18n'

export function LanguageToggle() {
  const { i18n, t } = useTranslation()
  const languageOptions = [
    { code: 'zh-CN', label: t('common.languages.simplifiedChinese', { defaultValue: '简体中文' }) },
    { code: 'en', label: t('common.languages.english', { defaultValue: 'English' }) },
  ] as const

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          aria-label={t('common.toggleLanguage', { defaultValue: 'Toggle language' })}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('common.toggleLanguage', { defaultValue: 'Toggle language' })}
        selectedKeys={new Set([i18n.resolvedLanguage ?? i18n.language])}
        selectionMode="single"
        onAction={(key) => {
          void setAppLanguage(String(key))
        }}
      >
        {languageOptions.map((language) => (
          <DropdownItem key={language.code}>{language.label}</DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}
