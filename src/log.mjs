const BUFFER_MAX = 400;
const buffer = [];

export function recentLogs(limit) {
  const n = Math.max(1, Number(limit || BUFFER_MAX));
  return buffer.slice(-n);
}

export function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const stamped = '[' + new Date().toISOString() + '] ' + line;
  buffer.push(stamped);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  console.log(stamped);
}
