// WiFi transport: WebSocket to the controller (port 81 by default).
export class WifiTransport {
  constructor({ onLine, onClose }) {
    this.kind = 'wifi';
    this.onLine = onLine;
    this.onClose = onClose;
    this.ws = null;
    this.closing = false;
  }

  static url(host) {
    let h = host.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
    if (!h.includes(':')) h += ':81';
    return `ws://${h}/`;
  }

  connect(host, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WifiTransport.url(host));
      this.ws = ws;
      this.closing = false;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`No answer from ${host}. Is your PC on the same WiFi as the controller?`));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Could not reach ${host}`));
      };
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') this.onLine(e.data);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!this.closing && this.ws === ws) {
          this.ws = null;
          this.onClose?.('WiFi connection lost');
        }
      };
    });
  }

  async send(line) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(line);
    return true;
  }

  async disconnect() {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }
}
