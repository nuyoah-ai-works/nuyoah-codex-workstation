import test from 'node:test';
import assert from 'node:assert/strict';
import { createInjectorScheduler } from '../lib/injector-scheduler.mjs';

test('slow jobs are single flight without blocking other services, and failure releases the lane', async () => {
  const failures = [], scheduler = createInjectorScheduler({ onError: name => failures.push(name) });
  let release, calls = 0;
  const first = scheduler.run('skills', () => { calls++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(scheduler.run('skills', () => assert.fail('duplicate expensive job')), first);
  await scheduler.run('map', () => { assert.equal(calls, 1); assert.equal(scheduler.busy('skills'), true); });
  release(); await scheduler.settle(); assert.equal(scheduler.busy('skills'), false);
  await scheduler.run('map', () => { throw new Error('fictional failure'); });
  assert.deepEqual(failures, ['map']); assert.equal(scheduler.busy('map'), false);
  await scheduler.run('map', () => calls++); assert.equal(calls, 2);
});
