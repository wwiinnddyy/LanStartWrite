// mini_eventemitter.js
// 一个非常轻量的事件发射器，实现 `on`, `off`, `emit`, `once` 方法。
export default class MiniEventEmitter {
  constructor(){ this._listeners = Object.create(null); }
  
  on(name, fn){ 
    if (!this._listeners[name]) this._listeners[name] = []; 
    this._listeners[name].push(fn); 
    return ()=>this.off(name, fn); 
  }
  
  off(name, fn){ 
    if (!this._listeners[name]) return; 
    this._listeners[name] = this._listeners[name].filter(f=>f!==fn); 
  }
  
  emit(name, ...args){ 
    const arr = this._listeners[name]; 
    if (!arr || !arr.length) return; 
    arr.slice().forEach(fn=>{ 
      try{ fn(...args); }
      catch(e){ console.error('event handler error', e); } 
    }); 
  }
  
  once(name, fn) {
    const wrapper = (...args) => {
      fn(...args);
      this.off(name, wrapper);
    };
    this.on(name, wrapper);
    return () => this.off(name, wrapper);
  }
}
