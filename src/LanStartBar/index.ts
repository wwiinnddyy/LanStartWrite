import { ensureBuiltinLanStartBarContributions } from './builtinContributions'
import { lanStartBarRegistry } from './registry'

ensureBuiltinLanStartBarContributions(lanStartBarRegistry)

export { LanStartBarApp, WINDOW_ID_LANSTART_BAR } from './LanStartBarApp'
export {
  LanStartBarRegistry,
  lanStartBarRegistry,
  registerLanStartBarItem,
  type LanStartBarItem,
  type LanStartBarItemAction
} from './registry'
