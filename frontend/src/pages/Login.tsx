import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '@iconify/react'
import { Button, Form, Input } from '@heroui/react'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { LanguageToggle } from '@/components/LanguageToggle'
import { SurfaceNotice } from '@/components/ui/surface'
import { ThemeToggleButton } from '@/components/ui/theme-toggle-button'
import SoftAurora from '@/components/ui/soft-aurora'

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>
}

export default function Login({ onLogin }: LoginProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      setErrorMsg('')
      await onLogin(username.trim(), password)
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 401) {
        setErrorMsg(t('login.messages.invalidCredentials'))
      } else {
        setErrorMsg(t('login.messages.failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* React Bits SoftAurora 背景 — OGL WebGL，兼容 React 19 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-30"
        aria-hidden="true"
      >
        <SoftAurora
          color1="#0d9488"
          color2="#2dd4bf"
          speed={0.4}
          scale={1.2}
          brightness={0.9}
          bandHeight={0.5}
          bandSpread={1.2}
          noiseFrequency={2.0}
          noiseAmplitude={0.8}
          layerOffset={0.4}
          colorSpeed={0.6}
          enableMouseInteraction={false}
        />
      </div>

      <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
        <ThemeToggleButton />
        <LanguageToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        {/* 品牌标识 */}
        <div className="mb-8 flex items-center gap-3">
          <img src="/favicon.svg" alt="Codex-Pool" className="h-9 w-9 rounded-xl" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-default-400">
              Codex
            </p>
            <p className="text-sm font-semibold leading-none text-foreground">Pool</p>
          </div>
        </div>

        {/* 标题区 */}
        <div className="mb-6 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {t('login.title')}
          </h1>
          <p className="text-sm text-default-600">
            {t('login.subtitle')}
          </p>
        </div>

        {errorMsg ? (
          <SurfaceNotice tone="danger" className="mb-4">
            {errorMsg}
          </SurfaceNotice>
        ) : null}

        <Form
          className="flex flex-col gap-3"
          validationBehavior="native"
          onSubmit={submit}
        >
          <Input
            isRequired
            autoFocus
            autoComplete="username"
            label={t('login.username')}
            labelPlacement="outside"
            name="username"
            placeholder={t('login.usernamePlaceholder')}
            size="md"
            value={username}
            onValueChange={setUsername}
            classNames={{ inputWrapper: 'bg-content2/60' }}
          />

          <Input
            isRequired
            autoComplete="current-password"
            label={t('login.password')}
            labelPlacement="outside"
            name="password"
            placeholder={t('login.passwordPlaceholder')}
            size="md"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onValueChange={setPassword}
            endContent={(
              <button
                type="button"
                className="text-default-400 transition-colors hover:text-foreground focus:outline-none"
                aria-label={
                  showPassword
                    ? t('login.hidePassword')
                    : t('login.showPassword')
                }
                onClick={() => setShowPassword((c) => !c)}
              >
                <Icon
                  icon={showPassword ? 'solar:eye-bold' : 'solar:eye-closed-linear'}
                  className="text-lg"
                />
              </button>
            )}
            classNames={{ inputWrapper: 'bg-content2/60' }}
          />

          <Button
            className="mt-1 w-full font-medium"
            color="primary"
            isDisabled={!username.trim() || !password}
            isLoading={loading}
            size="md"
            type="submit"
          >
            {t('login.submit')}
          </Button>
        </Form>

      </motion.div>
    </div>
  )
}
