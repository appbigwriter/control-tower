import { Suspense } from 'react'

import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#05070b]" />}>
      <LoginForm />
    </Suspense>
  )
}
