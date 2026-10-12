// Chrome自身が報告する接続先を読む。owned childのloopback endpointだけを受け入れる。
export function parseDevToolsEndpoint(stderr) {
  for (const match of stderr.matchAll(/DevTools listening on (ws:\/\/[^\s]+)(?=\s)/g)) {
    try {
      const endpoint = new URL(match[1]);
      if (endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
        && Number(endpoint.port) > 0 && Number(endpoint.port) <= 65535
        && endpoint.pathname.startsWith('/devtools/browser/') && endpoint.pathname.length > '/devtools/browser/'.length
        && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash) {
        return endpoint.href;
      }
    } catch { /* 不完全なstderr chunkは、次のchunkで再判定する。 */ }
  }
  return null;
}

export function parseDevToolsActivePort(contents) {
  const [port, path] = contents.trim().split(/\r?\n/);
  if (!/^\d+$/.test(port ?? '') || !path) return null;
  return parseDevToolsEndpoint('DevTools listening on ws://127.0.0.1:' + port + path + '\n');
}
