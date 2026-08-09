import { css } from 'remix/ui'

export const palette = Object.freeze({
  ink: '#e8eef8',
  muted: '#9eabc0',
  panel: '#151d2a',
  raised: '#1d2838',
  border: '#3b4c64',
  blue: '#6fb5ff',
  green: '#67d9a1',
  amber: '#ffd166',
  red: '#ff8b8b',
})

export const fieldStyle = css({
  boxSizing: 'border-box',
  width: '100%',
  minHeight: '44px',
  borderRadius: '8px',
  border: `1px solid ${palette.border}`,
  background: '#0d1420',
  color: palette.ink,
  colorScheme: 'dark',
  padding: '10px 12px',
  font: 'inherit',
  '&:focus-visible': { outline: `3px solid ${palette.blue}`, outlineOffset: '2px' },
})

export const buttonStyle = css({
  minHeight: '44px',
  borderRadius: '8px',
  border: '1px solid transparent',
  background: '#1d78d0',
  color: '#ffffff',
  padding: '10px 16px',
  font: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
  '&:hover': { background: '#2788e8' },
  '&:focus-visible': { outline: `3px solid ${palette.amber}`, outlineOffset: '2px' },
  '&:disabled': { cursor: 'not-allowed', opacity: 0.55 },
})

export const panelStyle = css({
  border: `1px solid ${palette.border}`,
  borderRadius: '14px',
  background: palette.panel,
  color: palette.ink,
  padding: '20px',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
})

export const visuallyHidden = css({
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
})

export const skipLinkStyle = css({
  position: 'absolute',
  left: '-9999px',
  zIndex: 10,
  '&:focus': {
    left: '20px',
    top: '12px',
    borderRadius: '8px',
    background: palette.blue,
    color: '#07101d',
    padding: '10px 14px',
    outline: `3px solid ${palette.amber}`,
  },
})
