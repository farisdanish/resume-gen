// Render the exact export bytes. Resume HTML is never inserted into the editor DOM.
let renderer;
const loadRenderer = () => renderer ??= import('/vendor/pdfjs.mjs');

export class PdfPreview {
  constructor(host) {
    this.host = host;
    this.active = null;
    this.pending = null;
  }

  cancelPending() {
    this.pending?.cancel();
  }

  async render(base64, expectedPages, signal) {
    this.cancelPending();
    const stage = document.createElement('div');
    stage.className = 'pdf-page-list pdf-pending';
    stage.inert = true;
    let task;
    let cancelled = false;
    let disposed = false;
    const renders = new Set();
    const layers = new Set();
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const render of renders) render.cancel();
      for (const layer of layers) layer.cancel();
      void task?.destroy().catch(() => {});
      for (const canvas of stage.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; }
      stage.remove();
    };
    const job = { cancel: () => { cancelled = true; dispose(); }, dispose };
    this.pending = job;
    const abort = () => job.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    const check = () => {
      if (cancelled || signal?.aborted || this.pending !== job) throw new DOMException('Preview superseded', 'AbortError');
    };
    let deadline;
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        job.cancel();
        reject(new Error('PDF preview rendering timed out after 20 seconds'));
      }, 20_000);
    });
    try {
      await Promise.race([(async () => {
        check();
        if (typeof base64 !== 'string') throw new Error('Preview response is missing PDF bytes');
        const pdfjs = await loadRenderer();
        check();
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false,
          useSystemFonts: false, useWasm: false, isImageDecoderSupported: false });
        const pdf = await task.promise;
        check();
        if (pdf.numPages !== expectedPages) throw new Error('Preview PDF page count does not match its budget');
        document.body.append(stage);
        // Prepare a complete stack before replacing the previous document; page one is rendered first.
        for (let number = 1; number <= pdf.numPages; number++) {
          check();
          const page = await pdf.getPage(number);
          check();
          const viewport = page.getViewport({ scale: 96 / 72 });
          const wrapper = document.createElement('section');
          wrapper.className = 'pdf-page';
          wrapper.dataset.pageNumber = String(number);
          wrapper.setAttribute('aria-label', `Page ${number} of ${pdf.numPages}`);
          const label = document.createElement('div');
          label.className = 'pdf-page-label';
          label.textContent = `Page ${number} of ${pdf.numPages}`;
          const sheet = document.createElement('div');
          sheet.className = 'pdf-sheet';
          sheet.style.width = `${viewport.width}px`;
          sheet.style.height = `${viewport.height}px`;
          sheet.style.setProperty('--total-scale-factor', String(viewport.scale));
          const canvas = document.createElement('canvas');
          canvas.setAttribute('aria-hidden', 'true');
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.ceil(viewport.width * ratio);
          canvas.height = Math.ceil(viewport.height * ratio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const text = document.createElement('div');
          text.className = 'pdf-text-layer';
          sheet.append(canvas, text);
          wrapper.append(label, sheet);
          stage.append(wrapper);
          const render = page.render({ canvasContext: canvas.getContext('2d'), canvas,
            viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
          renders.add(render);
          await render.promise;
          renders.delete(render);
          check();
          const content = await page.getTextContent();
          check();
          const layer = new pdfjs.TextLayer({ textContentSource: content, container: text, viewport });
          layers.add(layer);
          await layer.render();
          layers.delete(layer);
          check();
        }
      })(), timeout]);
      check();
      stage.classList.remove('pdf-pending');
      stage.inert = false;
      const previous = this.active;
      this.host.replaceChildren(stage);
      this.host.dataset.pageCount = String(expectedPages);
      this.active = job;
      this.pending = null;
      previous?.dispose();
    } catch (error) {
      job.cancel();
      throw error;
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (this.pending === job) this.pending = null;
    }
  }

  destroy() {
    this.cancelPending();
    this.active?.dispose();
    this.active = null;
  }
}
