(function (global) {
  'use strict';
  const ENDPOINT = 'https://incident-api.tayunet-traininfo.com/server-monitor/freight-status';
  function validate(bundle) {
    if (!bundle?.health || typeof bundle.health.ok !== 'boolean' || !bundle.data?.ok ||
        !['trains', 'routes', 'incidents'].every(key => Array.isArray(bundle.data[key]))) {
      throw new Error('貨物取得結果の形式が不正です');
    }
    return bundle;
  }
  function isCurrent(bundle) {
    const age = Date.now() - Date.parse(bundle?.health?.checkedAt || '');
    return bundle?.health?.ok === true && bundle.health.available !== false &&
      Number.isFinite(age) && age >= -300000 && age <= 20 * 60 * 1000;
  }
  async function getJSON(url, signal) {
    const response = await fetch(url, {cache: 'no-store', signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function load(options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) abort();
    try {
      const bundle = validate(await getJSON(ENDPOINT, controller.signal));
      return {...bundle, transport: 'live'};
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A transport failure may use the published snapshot, with its real age.
      // A valid live failure/closed-hours result is returned above, not hidden.
      const [data, health] = await Promise.all([
        getJSON('/JRF_status/JRF-gtfs/data/freight-status.json', options.signal),
        getJSON('/JRF_status/JRF-gtfs/data/fetch-health.json', options.signal),
      ]);
      return {...validate({data, health}), transport: 'pages', transportError: '定期取得サーバーへ接続できず、公開済みデータを表示中'};
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  global.TayunetFreightStatus = Object.freeze({load, isCurrent, ENDPOINT});
})(window);
