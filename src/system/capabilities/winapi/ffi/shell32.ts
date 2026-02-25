import { FFIType, dlopen } from 'bun:ffi'

const shell32 = dlopen('shell32.dll', {
  IsUserAnAdmin: {
    args: [],
    returns: FFIType.bool
  }
})

export function isUserAnAdmin(): boolean {
  try {
    return Boolean(shell32.symbols.IsUserAnAdmin())
  } catch {
    return false
  }
}
