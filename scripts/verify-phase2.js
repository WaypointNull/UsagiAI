const { createHub } = require('../src/hub');

async function main() {
  const hub = await createHub();
  const base = `http://127.0.0.1:${hub.port}`;

  const initial = await (await fetch(`${base}/api/plugins`)).json();
  console.log('plugins:', JSON.stringify(initial.plugins.map((p) => ({ id: p.id, version: p.version, io: p.io }))));

  const started = await (await fetch(`${base}/api/plugins/akumu/start`, { method: 'POST' })).json();
  console.log('started:', started.plugin.status, started.plugin.url);

  // Find the plugin's token from the manager to act as the plugin.
  const runtime = hub.manager.byToken && [...hub.manager.plugins.values()].find((p) => p.manifest.id === 'akumu');
  const token = runtime.token;

  await new Promise((r) => setTimeout(r, 1000));
  const readyBefore = (await (await fetch(`${base}/api/plugins`)).json()).plugins.find((p) => p.id === 'akumu');
  console.log('sdkReady:', readyBefore.sdkReady, 'status:', readyBefore.status);

  const headers = { 'content-type': 'application/json', 'x-usagi-token': token };

  const rec = await (
    await fetch(`${base}/bus/history`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schema: 'tag-list@1',
        input: { naturalLanguage: 'Neeko sitting on a rock looking confused.', loraInput: '', modelTranslate: 'qwen2.5:7b', mode: 'strict' },
        output: {
          positiveTags: ['masterpiece', '1girl', 'neeko_(league_of_legends)'],
          negativeTags: ['bad_quality', 'watermark'],
          globalPositiveText: 'masterpiece, best_quality, 1girl, neeko_(league_of_legends)',
          globalNegativeText: 'bad_quality, worst_quality, watermark',
          finalText: 'Global Positive:\nmasterpiece, ...'
        }
      })
    })
  ).json();
  console.log('record:', rec.ok, rec.record && rec.record.id, rec.record && rec.record.schema);

  const latest = await (await fetch(`${base}/bus/history/latest?from=akumu&schema=tag-list@1`, { headers })).json();
  console.log('latest:', latest.ok, latest.record && latest.record.output.positiveTags.join(', '));

  const badToken = await (
    await fetch(`${base}/bus/history?plugin=akumu&schema=tag-list@1`, { headers: { 'x-usagi-token': 'nope' } })
  ).json();
  console.log('bad token -> 401?', badToken.ok === false && badToken.error === 'invalid plugin token');

  const all = await (await fetch(`${base}/bus/history?plugin=akumu&schema=tag-list@1`, { headers })).json();
  console.log('history count:', all.records.length);

  await hub.stopAll();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
