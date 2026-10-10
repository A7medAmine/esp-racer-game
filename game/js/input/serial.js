// USB transport using the Web Serial API (Chrome / Edge / Opera on desktop).
export class SerialTransport {
  constructor({ onLine, onClose }) {
    this.kind = 'usb';
    this.onLine = onLine;
    this.onClose = onClose;
    this.port = null;
    this.reader = null;
    this.closing = false;
  }

  static supported() {
    return 'serial' in navigator;
  }

  // Ports the user already granted in an earlier session (no prompt needed).
  static async grantedPorts() {
    if (!SerialTransport.supported()) return [];
    return navigator.serial.getPorts();
  }

  // Opens `port`, or asks the user to pick one when no port is given.
  async connect(port) {
    this.port = port ?? (await navigator.serial.requestPort());
    await this.port.open({ baudRate: 115200, bufferSize: 4096 });
    try {
      // NodeMCU auto-reset circuit: both lines released = normal run mode.
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // Not all adapters support control signals; harmless.
    }
    this.closing = false;
    this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (this.port?.readable && !this.closing) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              this.onLine(buffer.slice(0, nl));
              buffer = buffer.slice(nl + 1);
            }
            if (buffer.length > 2000) buffer = '';
          }
        } catch (err) {
          // Framing/buffer errors are recoverable; a lost device ends the loop below.
          if (err.name === 'NetworkError' || err.name === 'NotFoundError') break;
        } finally {
          this.reader?.releaseLock();
          this.reader = null;
        }
      }
    } finally {
      if (!this.closing) {
        await this.disconnect();
        this.onClose?.('USB connection lost');
      }
    }
  }

  async send(line) {
    if (!this.port?.writable) return false;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(line + '\n'));
      return true;
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
  }
}
