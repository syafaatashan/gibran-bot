export function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log('[' + new Date().toISOString() + '] ' + line);
}
