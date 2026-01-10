/**
 * write_a_change.js
 *
 * 跨模块的“副作用入口”封装：
 * - updateAppSettings：写入设置并广播 SETTINGS_CHANGED
 * - requestFileWrite：通过消息总线向主进程请求文件写入（渲染进程不直接进行磁盘 I/O）
 */
import Message, { EVENTS } from './message.js';
import Settings from './setting.js';

/**
 * 合并并持久化设置，然后广播 SETTINGS_CHANGED。
 * @param {Object} partial - 需要更新的设置字段（会与当前设置合并）
 * @returns {Object} 合并后的完整设置对象
 */
export function updateAppSettings(partial){
  const merged = Settings.saveSettings(partial);
  try{ Message.emit(EVENTS.SETTINGS_CHANGED, merged); }catch(e){}
  try{
    const p = partial && typeof partial === 'object' ? partial : {};
    const hasToolbarOrder = Object.prototype.hasOwnProperty.call(p, 'toolbarButtonOrder');
    const hasToolbarHidden = Object.prototype.hasOwnProperty.call(p, 'toolbarButtonHidden');
    const hasPluginDisplay = Object.prototype.hasOwnProperty.call(p, 'pluginButtonDisplay');
    if (hasToolbarOrder || hasToolbarHidden || hasPluginDisplay) {
      const entry = {
        ts: Date.now(),
        kind: 'toolbar_config_change',
        patch: {
          toolbarButtonOrder: hasToolbarOrder ? p.toolbarButtonOrder : undefined,
          toolbarButtonHidden: hasToolbarHidden ? p.toolbarButtonHidden : undefined,
          pluginButtonDisplay: hasPluginDisplay ? p.pluginButtonDisplay : undefined
        }
      };
      try{ localStorage.setItem('toolbar_config_change_last', JSON.stringify(entry)); }catch(e){}
    }
  }catch(e){}
  return merged;
}

/**
 * 请求主进程写入文件。
 * @param {string} path - 目标路径（相对路径会在主进程内解析到 userData 下；绝对路径会直接写入）
 * @param {string} content - 写入内容（utf8）
 * @returns {void}
 */
export function requestFileWrite(path, content){
  try{ Message.emit(EVENTS.REQUEST_FILE_WRITE, { path, content }); }catch(e){ console.warn('requestFileWrite emit failed', e); }
}

export default { updateAppSettings, requestFileWrite };
