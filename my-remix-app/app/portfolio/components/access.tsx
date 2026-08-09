import { on, type Handle } from 'remix/ui'

import { buttonStyle, fieldStyle, palette, panelStyle } from './styles.ts'

export function LoginPanel(handle: Handle<Readonly<{
  configured: boolean
  busy: boolean
  error?: string
  onLogin(username: string, password: string, mfaCode: string): void
  onBootstrap(username: string, password: string, displayName: string): void
}>>) {
  return () => (
    <main mix={panelStyle} aria-labelledby="portfolio-login-title" style={{ color: palette.ink }}>
      <p style={{ color: palette.blue, fontWeight: 700, margin: '0 0 6px' }}>Protected workspace</p>
      <h1 id="portfolio-login-title" style={{ marginTop: 0 }}>{handle.props.configured ? 'Portfolio sign in' : 'Create portfolio administrator'}</h1>
      {handle.props.configured ? (
        <form
          mix={on('submit', (event) => {
            event.preventDefault()
            const values = new FormData(event.currentTarget)
            handle.props.onLogin(
              String(values.get('username') ?? ''),
              String(values.get('password') ?? ''),
              String(values.get('mfaCode') ?? ''),
            )
          })}
          style={{ display: 'grid', gap: '16px', maxWidth: '420px' }}
        >
          <label style={{ display: 'grid', gap: '6px', color: palette.ink }}>Username<input mix={fieldStyle} name="username" autoComplete="username" required maxLength={64} /></label>
          <label style={{ display: 'grid', gap: '6px', color: palette.ink }}>Password<input mix={fieldStyle} name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
          <label style={{ display: 'grid', gap: '6px', color: palette.ink }}>Authenticator code <span style={{ color: palette.amber }}>(required after MFA setup)</span>
            <input mix={fieldStyle} name="mfaCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="Current 6-digit code" />
          </label>
          <p style={{ color: palette.muted, margin: '-8px 0 0' }}>Open your authenticator app and enter the current code shown for Stock Watcher. Codes refresh every 30 seconds.</p>
          <button mix={buttonStyle} disabled={handle.props.busy} type="submit">
            {handle.props.busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form
          mix={on('submit', (event) => {
            event.preventDefault()
            const values = new FormData(event.currentTarget)
            handle.props.onBootstrap(
              String(values.get('username') ?? ''),
              String(values.get('password') ?? ''),
              String(values.get('displayName') ?? ''),
            )
          })}
          style={{ display: 'grid', gap: '16px', maxWidth: '460px' }}
        >
          <p style={{ color: palette.amber, margin: 0 }}>
            No administrator exists yet. Create the first admin account to unlock the workspace.
          </p>
          <label>Username<input mix={fieldStyle} name="username" autoComplete="username" required maxLength={64} pattern="[A-Za-z0-9._-]{3,64}" /></label>
          <label>Display name <span style={{ color: palette.muted }}>(optional)</span><input mix={fieldStyle} name="displayName" autoComplete="name" maxLength={120} /></label>
          <label>Password<input mix={fieldStyle} name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
          <button mix={buttonStyle} disabled={handle.props.busy} type="submit">
            {handle.props.busy ? 'Creating adminâ€¦' : 'Create admin and sign in'}
          </button>
        </form>
      )}
      {handle.props.error ? <p role="alert" style={{ color: palette.red }}>{handle.props.error}</p> : null}
    </main>
  )
}
