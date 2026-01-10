import Message, { EVENTS } from './message.js';
import Settings from './setting.js';

function _invokeMainMessage(channel, data) {
  try {
    if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') return Promise.resolve({ success: false, error: 'ipc_unavailable' });
    return window.electronAPI.invokeMain('message', String(channel || ''), data);
  } catch (e) {
    return Promise.resolve({ success: false, error: String(e && e.message || e) });
  }
}

function _normalizeMode(input) {
  if (!input) return 'window';
  if (typeof input === 'string') return input === 'fullscreen' ? 'fullscreen' : 'window';
  const raw = input && typeof input === 'object' && input.mode ? String(input.mode) : '';
  return raw === 'fullscreen' ? 'fullscreen' : 'window';
}

export function resolvePdfOpenMode(params, settingsLike){
  const normalized = _normalizeMode(params);
  if (params && typeof params === 'object' && typeof params.mode !== 'undefined') return normalized;
  if (typeof params === 'string') return normalized;
  const s = settingsLike && typeof settingsLike === 'object' ? settingsLike : Settings.loadSettings();
  try{
    const raw = s && s.pdfDefaultMode ? String(s.pdfDefaultMode) : '';
    if (raw === 'fullscreen') return 'fullscreen';
    if (raw === 'window') return 'window';
  }catch(e){}
  return normalized;
}

export async function openPdfFile(params) {
  const mode = resolvePdfOpenMode(params);
  const pick = await _invokeMainMessage('pdf:open-dialog', {});
  if (!pick || !pick.success || !pick.path) return false;
  const path = String(pick.path || '');
  if (!path) return false;
  const res = await _invokeMainMessage('pdf:open-window', { path, mode });
  if (!res || !res.success) return false;
  try {
    Message.emit(EVENTS.SETTINGS_CHANGED, { kind: 'pdf_viewer_opened', mode, path });
  } catch (e) {}
  return true;
}

export default { openPdfFile };
