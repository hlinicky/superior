/**
 * Shared icon set. Every icon takes an optional pixel `size` (default 14) and
 * `className`, draws with `currentColor`, and is aria-hidden — pair with an
 * aria-label on the interactive parent. Consolidates the SVGs previously
 * copy-pasted across Sidebar, TitleBar, switchers, and panels.
 */

interface IconProps {
  size?: number
  className?: string
}

function base(props: IconProps, strokeWidth = 1.5): React.JSX.Element['props'] {
  return {
    width: props.size ?? 14,
    height: props.size ?? 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: props.className,
    'aria-hidden': true
  }
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.8)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function PencilIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

export function ChevronIcon({
  direction = 'down',
  ...props
}: IconProps & { direction?: 'up' | 'down' | 'left' | 'right' }): React.JSX.Element {
  const rotate = { down: 0, left: 90, up: 180, right: 270 }[direction]
  return (
    <svg {...base(props, 2)} style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 2)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  // 16-grid drawing kept from the original ChangesView/FilesView glyph.
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2v3.5H10" />
    </svg>
  )
}

export function BranchIcon(props: IconProps): React.JSX.Element {
  // 16-grid drawing kept from the original BranchSwitcher/ChangesView glyph.
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="5.5" r="1.75" />
      <path d="M4 5.25v5.5M10.25 5.5H9A5 5 0 0 0 4 10.5" />
    </svg>
  )
}

export function ProfileIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.6)}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

export function HistoryIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function TasksIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="m3 6 1.5 1.5L7 5M11 6h10M3 12h4M11 12h10M3 18h4M11 18h10" />
    </svg>
  )
}

export function GripIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 2)}>
      <circle cx="9" cy="6" r="0.5" />
      <circle cx="15" cy="6" r="0.5" />
      <circle cx="9" cy="12" r="0.5" />
      <circle cx="15" cy="12" r="0.5" />
      <circle cx="9" cy="18" r="0.5" />
      <circle cx="15" cy="18" r="0.5" />
    </svg>
  )
}

export function KebabIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 2)}>
      <circle cx="12" cy="5" r="0.6" />
      <circle cx="12" cy="12" r="0.6" />
      <circle cx="12" cy="19" r="0.6" />
    </svg>
  )
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.8)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

export function StarIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
    </svg>
  )
}

/** Sliders: sort / view options. */
export function SlidersIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  )
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 2.2)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function ExternalLinkIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

export function GearIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function PromptIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <path d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  )
}

export function BroadcastIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props, 1.7)}>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" />
    </svg>
  )
}

export function RestartIcon(props: IconProps): React.JSX.Element {
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2v3h-3" />
    </svg>
  )
}

export function TerminalIcon(props: IconProps): React.JSX.Element {
  return <svg {...base(props)}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></svg>
}

export function KeyboardIcon(props: IconProps): React.JSX.Element {
  return <svg {...base(props)}><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" /></svg>
}
