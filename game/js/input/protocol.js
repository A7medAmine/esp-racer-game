// Parses the text lines sent by the controller firmware (see docs/protocol.md).
//   D,<seq>,<roll x10>,<pitch x10>,<joy -1000..1000>,<btn 0/1>,<flags>[,<gas 0/1>,<brake 0/1>]
//   (gas and brake paddles were added in firmware 1.1; older firmware stops at flags)
//   I {json}          device info
//   OK ... / ERR ...  command replies
//   # ...             log lines
export function parseLine(raw) {
  const line = raw.trim();
  if (!line) return null;

  if (line.startsWith('D,')) {
    const p = line.split(',');
    if (p.length < 6) return null;
    const n = p.slice(1).map(Number);
    if (n.some((v) => !Number.isFinite(v))) return null;
    return {
      type: 'data',
      seq: n[0],
      roll: n[1] / 10,
      pitch: n[2] / 10,
      joy: Math.max(-1, Math.min(1, n[3] / 1000)),
      button: n[4] === 1,
      sensorOk: p.length > 6 ? (n[5] & 1) === 1 : true,
      gas: p.length > 8 && n[6] === 1,
      brake: p.length > 8 && n[7] === 1,
    };
  }
  if (line.startsWith('I ')) {
    try {
      return { type: 'info', info: JSON.parse(line.slice(2)) };
    } catch {
      return null;
    }
  }
  if (line.startsWith('OK')) return { type: 'ok', text: line.slice(2).trim() };
  if (line.startsWith('ERR')) return { type: 'error', text: line.slice(3).trim() };
  if (line.startsWith('#')) return { type: 'log', text: line.slice(1).trim() };
  return null; // boot noise from the ESP8266 ROM, ignore
}
