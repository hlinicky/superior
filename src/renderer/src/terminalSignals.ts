/**
 * Read explicit terminal attention requests, never infer completion from text or
 * silence. BEL is an attention request, not proof that a task succeeded. OSC 9
 * and OSC 777 are used by agent CLIs for desktop notifications. Other OSCs
 * (especially Windows OSC 9;4 progress updates) must not become notifications.
 * State spans PTY chunks; control-string payloads are bounded and never executed.
 * Window titles (OSC 0/2) are reported separately; agents animate them while working.
 */
export class TerminalSignals {
  private state: 'text' | 'escape' | 'osc' | 'oscEscape' | 'string' | 'stringEscape' = 'text'
  private payload = ''
  private overflow = false

  constructor(private readonly onTitle?: (title: string) => void) {}

  private endOsc(): boolean {
    const text = this.payload
    if (!this.overflow && /^[02];/.test(text)) this.onTitle?.(text.slice(2))
    const valid = !this.overflow && (
      (text.startsWith('9;') && text.length > 2 && !/^9;\d+(?:;|$)/.test(text)) ||
      (text.startsWith('777;notify;') && text.length > 11)
    )
    this.state = 'text'
    this.payload = ''
    this.overflow = false
    return valid
  }

  read(data: string): boolean {
    let attention = false
    for (const char of data) {
      if (char === '\x18' || char === '\x1a') {
        this.state = 'text'
        this.payload = ''
        this.overflow = false
        continue
      }
      switch (this.state) {
        case 'text':
          if (char === '\x07') attention = true
          else if (char === '\x1b') this.state = 'escape'
          else if (char === '\x9d') this.state = 'osc'
          else if (['\x90', '\x98', '\x9e', '\x9f'].includes(char)) this.state = 'string'
          break
        case 'escape':
          if (char === ']') this.state = 'osc'
          else if (['P', 'X', '^', '_'].includes(char)) this.state = 'string'
          else {
            this.state = char === '\x1b' ? 'escape' : 'text'
            if (char === '\x07') attention = true
          }
          break
        case 'osc':
          if (char === '\x07' || char === '\x9c') attention = this.endOsc() || attention
          else if (char === '\x1b') this.state = 'oscEscape'
          else if (this.payload.length < 8192) this.payload += char
          else this.overflow = true
          break
        case 'oscEscape':
          if (char === '\\') attention = this.endOsc() || attention
          else {
            // Malformed OSC: discard until its terminator instead of interpreting
            // payload bytes (including BEL) as independent attention requests.
            this.overflow = true
            this.state = 'osc'
            if (char === '\x07' || char === '\x9c') this.endOsc()
          }
          break
        case 'string':
          if (char === '\x1b') this.state = 'stringEscape'
          else if (char === '\x9c') this.state = 'text'
          break
        case 'stringEscape':
          this.state = char === '\\' ? 'text' : char === '\x1b' ? 'stringEscape' : 'string'
          break
      }
    }
    return attention
  }
}
