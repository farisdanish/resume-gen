// Office 2000 Retro Desktop Controller
(() => {
  let currentResume = null;

  // DOM Elements
  const previewFrame = document.getElementById('preview-frame');
  const placeholderOverlay = document.getElementById('placeholder-overlay');
  const diagnosticsLog = document.getElementById('diagnostics-log');
  const statusBarText = document.getElementById('status-bar-text');
  const statusPageCount = document.getElementById('status-page-count');
  const statusAtsBadge = document.getElementById('status-ats-badge');
  const inputPhone = document.getElementById('input-phone');
  const liveUrlGroup = document.getElementById('live-url-group');
  const inputLiveUrl = document.getElementById('input-live-url');
  const radioSources = document.querySelectorAll('input[name="source-type"]');
  const a4Page = document.getElementById('a4-page');
  const zoomSelect = document.getElementById('zoom-select');
  const canvasArea = document.getElementById('canvas-area');

  const btnExtract = document.getElementById('btn-extract');
  const btnRenderPreview = document.getElementById('btn-render-preview');
  const btnDownloadPdf = document.getElementById('btn-download-pdf');
  const tbPrint = document.getElementById('tb-print');
  const tbPreview = document.getElementById('tb-preview');
  const tbSave = document.getElementById('tb-save');

  function getApiUrl(endpoint) {
    if (window.location.protocol === 'file:') {
      return `http://127.0.0.1:3000${endpoint}`;
    }
    return endpoint;
  }

  function log(message, type = 'info') {
    const item = document.createElement('div');
    item.className = `log-item log-${type}`;
    const time = new Date().toLocaleTimeString();
    item.textContent = `[${time}] ${message}`;
    diagnosticsLog.appendChild(item);
    diagnosticsLog.scrollTop = diagnosticsLog.scrollHeight;
  }

  function setStatus(text, pageInfo = 'Page 1/1') {
    statusBarText.textContent = text;
    statusPageCount.textContent = pageInfo;
  }

  function applyZoom() {
    const val = zoomSelect.value;
    if (val === 'fit') {
      const availableHeight = canvasArea.clientHeight - 60;
      const scale = Math.min(Math.max(availableHeight / 1123, 0.4), 1.0);
      a4Page.style.transform = `scale(${scale.toFixed(2)})`;
    } else {
      a4Page.style.transform = `scale(${val})`;
    }
  }

  zoomSelect.addEventListener('change', applyZoom);
  window.addEventListener('resize', () => {
    if (zoomSelect.value === 'fit') applyZoom();
  });

  radioSources.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.value === 'live' && r.checked) {
        liveUrlGroup.style.display = 'block';
      } else if (r.checked) {
        liveUrlGroup.style.display = 'none';
      }
    });
  });

  async function extractData() {
    try {
      setStatus('Extracting resume DOM...');
      const sourceType = document.querySelector('input[name="source-type"]:checked')?.value || 'fixture';
      const source = sourceType === 'live'
        ? (inputLiveUrl?.value.trim() || 'https://farisantoni.com')
        : 'fixture';
      const phoneOverride = inputPhone.value.trim() || undefined;

      log(`Requesting extraction from source: "${source}"...`, 'info');

      const res = await fetch(getApiUrl('/api/extract'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, phoneOverride }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        log(`Extraction error: ${result.error || 'Zod validation failed'}`, 'error');
        if (result.issues) {
          result.issues.forEach((i) => log(`Schema issue: ${i.path.join('.')} - ${i.message}`, 'error'));
        }
        setStatus('Extraction failed', 'Error');
        statusAtsBadge.textContent = 'ATS: Error';
        statusAtsBadge.className = 'status-badge badge-error';
        return;
      }

      currentResume = result.data;
      log(`Extraction successful. Found ${currentResume.work?.length || 0} work items, ${currentResume.education?.length || 0} edu items.`, 'success');

      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((w) => log(`[Warning] ${w}`, 'warn'));
      }

      statusAtsBadge.textContent = 'ATS: Ready';
      statusAtsBadge.className = 'status-badge badge-ok';

      // Automatically render preview
      await renderPreview();
    } catch (err) {
      log(`Extraction network error: ${err.message}`, 'error');
      if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
        log('[Troubleshooting] Is the dev server running? Ensure "npm run dev" is running at 127.0.0.1:3000.', 'warn');
      }
      setStatus('Network error', 'Offline');
    }
  }

  async function renderPreview() {
    if (!currentResume) {
      log('No resume data available. Run extraction first.', 'warn');
      return;
    }

    try {
      setStatus('Compiling Handlebars template...');
      // Allow live editing of phone number
      const phoneOverride = inputPhone.value.trim();
      if (phoneOverride) {
        currentResume.basics.contact.phone = phoneOverride;
      }

      const res = await fetch(getApiUrl('/api/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: currentResume }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        log(`Rendering failed: ${result.error}`, 'error');
        setStatus('Render error', 'Error');
        return;
      }

      // Populate Sandboxed iframe
      previewFrame.srcdoc = result.html;
      placeholderOverlay.style.display = 'none';

      log('Sandboxed preview successfully updated.', 'success');
      setStatus('Document rendered in sandbox', 'Page 1/1');
    } catch (err) {
      log(`Preview error: ${err.message}`, 'error');
      setStatus('Preview failed', 'Error');
    }
  }

  async function exportPdf() {
    if (!currentResume) {
      log('Cannot export: No resume data loaded.', 'warn');
      return;
    }

    try {
      setStatus('Generating Playwright PDF (Strict A4)...');
      log('Calling headless Playwright PDF engine...', 'info');

      // Update phone if edited
      const phoneOverride = inputPhone.value.trim();
      if (phoneOverride) {
        currentResume.basics.contact.phone = phoneOverride;
      }

      const res = await fetch(getApiUrl('/api/generate-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: currentResume }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        log(`PDF generation failed: ${errorJson.error || res.statusText}`, 'error');
        setStatus('PDF generation failed', 'Error');
        return;
      }

      const pageCount = res.headers.get('X-Page-Count') || '1';
      const isSinglePage = res.headers.get('X-Is-Single-Page') === 'true';

      if (!isSinglePage) {
        log(`[WARNING] Page budget exceeded: ${pageCount} pages generated!`, 'warn');
      } else {
        log(`PDF compiled strictly within 1-page budget (${pageCount} page).`, 'success');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume-${currentResume.basics?.name?.toLowerCase().replace(/\s+/g, '-') || 'farisantoni'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus(`PDF exported (${pageCount} page)`, `Page ${pageCount}/${pageCount}`);
      log('Download initiated successfully.', 'info');
    } catch (err) {
      log(`Export PDF network error: ${err.message}`, 'error');
      setStatus('Export failed', 'Error');
    }
  }

  function saveJson() {
    if (!currentResume) {
      log('No data to save.', 'warn');
      return;
    }
    const blob = new Blob([JSON.stringify(currentResume, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.json';
    a.click();
    URL.revokeObjectURL(url);
    log('Saved resume JSON fixture.', 'info');
  }

  // Event Listeners
  btnExtract.addEventListener('click', extractData);
  btnRenderPreview.addEventListener('click', renderPreview);
  btnDownloadPdf.addEventListener('click', exportPdf);
  tbPrint.addEventListener('click', exportPdf);
  tbPreview.addEventListener('click', renderPreview);
  tbSave.addEventListener('click', saveJson);

  // Initial setup
  applyZoom();
  // Auto-extract and render preview on startup
  extractData();
})();
