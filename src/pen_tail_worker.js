import { buildPenTailSegment } from './pen_tail.js';

let _seq = 1;
const _handlers = new Map();

function _reply(id, payload){
  try{ postMessage({ id, ...payload }); }catch(e){}
}

self.onmessage = (evt)=>{
  const msg = evt && evt.data ? evt.data : {};
  const id = msg && (msg.id || 0);
  const pointsSegment = msg && Array.isArray(msg.pointsSegment) ? msg.pointsSegment : [];
  const baseSize = msg && msg.baseSize;
  const penTail = msg && msg.penTail;
  try{
    const res = buildPenTailSegment(pointsSegment, baseSize, penTail);
    _reply(id, { ok: true, segment: res.segment, meta: res.meta });
  }catch(e){
    _reply(id, { ok: false, error: String(e && (e.stack || e.message) || e) });
  }
};

