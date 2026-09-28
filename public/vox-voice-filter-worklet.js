// Audio worklet used only by the Vox desktop app on a Mac. It sends the
// microphone to the desktop app's voice filter in 10 ms frames (480 samples at
// 48 kHz) and plays back the cleaned audio. If the filter stops answering, it
// passes the microphone through untouched so Vox can always hear the user.
const FRAME = 480;
const PREBUFFER = 3; // Frames held back to absorb scheduling jitter (30 ms).
const STALE_SECONDS = 0.5;

class VoxVoiceFilterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.link = null;
    this.outgoing = new Float32Array(FRAME);
    this.outgoingFill = 0;
    this.queue = [];
    this.current = null;
    this.currentIndex = 0;
    this.primed = false;
    this.lastReply = -1;
    this.port.onmessage = (event) => {
      // Page → filter control messages (for example, "Vox is speaking").
      if (event.data?.type === "assistant") {
        this.link?.postMessage({ type: "assistant", speaking: event.data.speaking === true });
        return;
      }
      if (event.data?.type !== "link" || !event.data.port) return;
      this.link = event.data.port;
      this.link.onmessage = (message) => {
        const data = message.data;
        if (data instanceof Float32Array || data instanceof ArrayBuffer) {
          this.queue.push(data instanceof Float32Array ? data : new Float32Array(data));
          this.lastReply = currentTime;
          // Keep latency bounded if replies pile up.
          while (this.queue.length > PREBUFFER * 4) this.queue.shift();
        } else if (data && typeof data === "object") {
          this.port.postMessage(data);
        }
      };
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (this.link) {
      // Keep the frames flowing through silence too, so the filter hears gaps.
      const source = input ?? this.silence ?? (this.silence = new Float32Array(output.length));
      let offset = 0;
      while (offset < source.length) {
        const take = Math.min(FRAME - this.outgoingFill, source.length - offset);
        this.outgoing.set(source.subarray(offset, offset + take), this.outgoingFill);
        this.outgoingFill += take;
        offset += take;
        if (this.outgoingFill === FRAME) {
          // Copied, not transferred: Electron's main-process ports drop
          // transferred buffers.
          this.link.postMessage(this.outgoing);
          this.outgoingFill = 0;
        }
      }
    }

    const filterAlive = this.link && this.lastReply >= 0 && currentTime - this.lastReply < STALE_SECONDS;
    if (!filterAlive) {
      // Not connected yet, or the filter stopped: use the microphone as is.
      if (input) output.set(input);
      else output.fill(0);
      this.primed = false;
      return true;
    }

    if (!this.primed) {
      if (this.queue.length < PREBUFFER) {
        output.fill(0);
        return true;
      }
      this.primed = true;
    }
    for (let i = 0; i < output.length; i++) {
      if (!this.current || this.currentIndex >= this.current.length) {
        this.current = this.queue.shift() ?? null;
        this.currentIndex = 0;
        if (!this.current) {
          output.fill(0, i);
          this.primed = false;
          break;
        }
      }
      output[i] = this.current[this.currentIndex++];
    }
    return true;
  }
}

registerProcessor("vox-voice-filter", VoxVoiceFilterProcessor);
