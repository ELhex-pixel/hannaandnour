const test = require('node:test');
const assert = require('node:assert/strict');
const { publicRead, queryResult } = require('../netlify/functions/lib/public-read');

test('une lecture transitoire est reprise une fois avec des données fraîches et un diagnostic filtré', async () => {
  let calls = 0; const logs = [];
  const result = await publicRead('configuration', async () => {
    if (++calls === 1) return queryResult({ status: 503, error: { code: 'PGRST002', message: 'private URL and credentials' } });
    return queryResult({ data: [{ key: 'currency', value: { code: 'eur' } }] });
  }, { log: entry => logs.push(entry) });
  assert.equal(calls, 2); assert.equal(result.data[0].value.code, 'eur');
  assert.equal(logs[0].source, 'configuration'); assert.equal(logs[0].retryable, true);
  assert.doesNotMatch(JSON.stringify(logs), /private|credentials|URL/);
});
test('erreur de permission et données invalides ne sont pas reprises ni remplacées par un cache', async () => {
  let calls = 0;
  await assert.rejects(publicRead('configuration', async () => {
    calls++; return queryResult({ status: 403, error: { code: '42501', message: 'private detail' } });
  }), error => !error.transient && !error.message.includes('private'));
  assert.equal(calls, 1);
});
test('une requête bloquée est interrompue et ne dépasse jamais deux tentatives', async () => {
  const signals = [];
  await assert.rejects(publicRead('configuration', signal => {
    signals.push(signal); return new Promise(() => {});
  }, { timeout: 10 }), error => error.transient === true);
  assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
});
