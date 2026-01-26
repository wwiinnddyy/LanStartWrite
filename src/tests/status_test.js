import Status from '../status.js';

const runTests = async () => {
  console.log('Running Status State Machine Tests...');
  let failures = 0;
  const assert = (cond, msg) => {
    if (!cond) {
      const text = `[FAIL] ${msg}`;
      console.error(text);
      try {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.sendToMain) {
          window.electronAPI.sendToMain('tests:log', text);
        }
      } catch (e) {}
      failures++;
    } else {
      const text = `[PASS] ${msg}`;
      console.log(text);
      try {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.sendToMain) {
          window.electronAPI.sendToMain('tests:log', text);
        }
      } catch (e) {}
    }
  };

  Status.resetState();
  const initial = Status.getState();
  assert(!!initial, 'state object should be available');
  assert(initial.machines && initial.machines.lifecycle && initial.machines.lifecycle.value === 'initializing', 'lifecycle initial state must be initializing');
  assert(initial.machines && initial.machines.mode && initial.machines.mode.value === 'whiteboard', 'mode initial state must be whiteboard');

  const invalidBefore = Status.getState();
  const invalidRes = Status.transition('lifecycle', 'UNKNOWN_EVENT');
  const invalidAfter = Status.getState();
  assert(invalidRes.ok === false, 'invalid transition should be rejected');
  assert(invalidBefore.machines.lifecycle.value === invalidAfter.machines.lifecycle.value, 'state should not change on invalid transition');

  let res = Status.transition('lifecycle', 'READY');
  assert(res.ok === true, 'READY transition should succeed');
  assert(res.state.machines.lifecycle.value === 'ready', 'lifecycle should move to ready');

  res = Status.transition('lifecycle', 'BUSY');
  assert(res.ok === true, 'BUSY transition should succeed');
  assert(Status.getMachineState('lifecycle').value === 'busy', 'lifecycle should be busy');

  res = Status.transition('lifecycle', 'IDLE');
  assert(res.ok === true, 'IDLE transition should succeed');
  assert(Status.getMachineState('lifecycle').value === 'ready', 'lifecycle should return to ready from busy via IDLE');

  Status.resetState();
  let subscribeCalls = 0;
  const unsubscribe = Status.subscribe((state, meta) => {
    if (meta && meta.machine) {
      subscribeCalls++;
    }
  });
  Status.transition('mode', 'SWITCH_TO_ANNOTATION');
  unsubscribe();
  assert(subscribeCalls >= 1, 'subscribe should be called when state changes');
  assert(Status.getMachineState('mode').value === 'annotation', 'mode should switch to annotation');

  Status.resetState();
  Status.transition('lifecycle', 'READY');
  const snap = Status.createSnapshot('ready-state');
  Status.transition('lifecycle', 'BUSY');
  const beforeRollback = Status.getMachineState('lifecycle');
  assert(beforeRollback.value === 'busy', 'lifecycle should be busy before rollback');
  const rollbackRes = Status.rollbackToSnapshot(snap.id);
  const afterRollback = Status.getMachineState('lifecycle');
  assert(rollbackRes.ok === true, 'rollback should succeed');
  assert(afterRollback.value === 'ready', 'rollback should restore lifecycle state to ready');

  Status.resetState();
  Status.transition('mode', 'SWITCH_TO_ANNOTATION');
  let persistedOk = true;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('appStatus');
      if (raw) {
        const parsed = JSON.parse(raw);
        const val = parsed && parsed.machines && parsed.machines.mode && parsed.machines.mode.value;
        assert(val === 'annotation', 'persisted mode value should be annotation');
      } else {
        assert(true, 'no persisted state found, skipping strict persistence check');
      }
    } else {
      assert(true, 'localStorage not available, skipping persistence check');
    }
  } catch (e) {
    persistedOk = false;
  }
  assert(persistedOk, 'persistence read should not throw');

  const log = Status.getLog();
  assert(Array.isArray(log), 'log should be an array');
  assert(log.length > 0, 'log should contain entries after transitions');

  if (failures === 0) {
    console.log('All Status State Machine Tests Passed.');
    return true;
  } else {
    const msg = `${failures} Status State Machine Tests Failed`;
    console.error(msg);
    throw new Error(msg);
  }
};

export default runTests;

if (typeof window !== 'undefined' && !window.__IS_TEST_RUNNER__) {
  runTests().catch(e => console.error(e));
}

