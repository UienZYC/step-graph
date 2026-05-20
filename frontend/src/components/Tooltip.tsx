import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export const DEFAULT_HELP_TEXT = 'Hover over an item to see help.'

type HelpContextValue = {
  helpText: string
  setHelp: (text: string) => void
  clearHelp: () => void
}

type TooltipProps = {
  text?: string
  children: ReactNode
}

const HelpContext = createContext<HelpContextValue | null>(null)

export function HelpProvider({ children }: { children: ReactNode }) {
  const [helpText, setHelpText] = useState(DEFAULT_HELP_TEXT)
  const value = useMemo<HelpContextValue>(() => ({
    helpText,
    setHelp: (text: string) => setHelpText(text),
    clearHelp: () => setHelpText(DEFAULT_HELP_TEXT),
  }), [helpText])

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>
}

export function HelpBar() {
  const help = useHelp()

  return (
    <div className="help-bar">
      <span className="help-bar-label">Help:</span>
      <span className="help-bar-text">{help.helpText}</span>
    </div>
  )
}

export function HelpTarget({ text, children }: TooltipProps) {
  const help = useContext(HelpContext)
  if (!text) return <>{children}</>

  return (
    <span
      className="help-target"
      onMouseEnter={() => help?.setHelp(text)}
      onMouseLeave={() => help?.clearHelp()}
      onFocus={() => help?.setHelp(text)}
      onBlur={() => help?.clearHelp()}
    >
      {children}
    </span>
  )
}

export function Tooltip(props: TooltipProps) {
  return <HelpTarget {...props} />
}

export function HelpLabel({ label, tooltip }: { label: ReactNode; tooltip?: string }) {
  return (
    <HelpTarget text={tooltip}>
      <span className="help-label">{label}</span>
    </HelpTarget>
  )
}

export function HelpBadge({ label, tooltip }: { label: ReactNode; tooltip?: string }) {
  return (
    <HelpTarget text={tooltip}>
      <span className="help-badge">{label}</span>
    </HelpTarget>
  )
}

function useHelp() {
  const value = useContext(HelpContext)
  if (value) return value

  return {
    helpText: DEFAULT_HELP_TEXT,
    setHelp: () => undefined,
    clearHelp: () => undefined,
  }
}
