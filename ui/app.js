// Office 2000 Retro Desktop Controller & Interactive Resume Studio
(() => {
  const STORAGE_KEY = 'resume_gen_draft_v1';
  const ASSISTANT_KEY = 'resume_gen_office_assistant_enabled';
  const PROFILE_VERSION = 1;
  const DEFAULT_SECTION_ORDER = ['summary', 'experience', 'education', 'skills', 'certifications', 'projects'];
  const SECTION_LABELS = {
    summary: 'Summary',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    certifications: 'Certifications',
    projects: 'Projects',
  };
  const SECTION_HEADING_KEYS = {
    summary: 'SUMMARY',
    experience: 'EXPERIENCE',
    education: 'EDUCATION',
    skills: 'SKILLS',
    certifications: 'CERTIFICATIONS',
    projects: 'PROJECTS',
  };

  // Central Application State
  let pristineResume = null;
  let draftResume = null;
  let visibility = {
    contact: { phone: true, email: true, location: true, github: true, linkedin: true, website: true },
    work: {},      // index -> boolean
    education: {}, // index -> boolean
    projects: {},  // index -> boolean
  };
  let styleConfig = {
    fontPairing: 'editorial',
    accentColor: '#2b6cb0',
    density: 'standard',
    margins: 'standard',
  };
  let sectionHeadings = {
    SUMMARY: 'SUMMARY',
    EXPERIENCE: 'EXPERIENCE',
    EDUCATION: 'EDUCATION',
    SKILLS: 'SKILLS',
    CERTIFICATIONS: 'CERTIFICATIONS',
    PROJECTS: 'PROJECTS',
  };
  let sectionOrder = [...DEFAULT_SECTION_ORDER];
  let currentBudgetState = 'waiting';
  const dismissedAssistantStates = new Set();

  // DOM Elements - Shell & Diagnostics
  const previewFrame = document.getElementById('preview-frame');
  const placeholderOverlay = document.getElementById('placeholder-overlay');
  const diagnosticsLog = document.getElementById('diagnostics-log');
  const statusBarText = document.getElementById('status-bar-text');
  const statusPageCount = document.getElementById('status-page-count');
  const statusAtsBadge = document.getElementById('status-ats-badge');
  const a4Page = document.getElementById('a4-page');
  const zoomSelect = document.getElementById('zoom-select');
  const canvasArea = document.getElementById('canvas-area');
  const budgetGuard = document.querySelector('.budget-guard');
  const budgetPercent = document.getElementById('budget-percent');
  const budgetMeter = document.getElementById('budget-meter');
  const budgetMeterFill = document.getElementById('budget-meter-fill');
  const budgetState = document.getElementById('budget-state');
  const officeAssistant = document.getElementById('office-assistant');
  const assistantTip = document.getElementById('assistant-tip');
  const chkOfficeAssistant = document.getElementById('chk-office-assistant');
  const btnDismissAssistant = document.getElementById('btn-dismiss-assistant');

  // DOM Elements - Source & Toolbar Actions
  const radioSources = document.querySelectorAll('input[name="source-type"]');
  const liveUrlGroup = document.getElementById('live-url-group');
  const inputLiveUrl = document.getElementById('input-live-url');
  const btnExtract = document.getElementById('btn-extract');
  const btnResetDraft = document.getElementById('btn-reset-draft');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnImportJsonTrigger = document.getElementById('btn-import-json-trigger');
  const inputImportJson = document.getElementById('input-import-json');
  const btnRenderPreview = document.getElementById('btn-render-preview');
  const btnDownloadPdf = document.getElementById('btn-download-pdf');
  const tbPrint = document.getElementById('tb-print');
  const tbPreview = document.getElementById('tb-preview');
  const tbSave = document.getElementById('tb-save');

  // DOM Elements - Tabs
  const taskpaneTabButtons = document.querySelectorAll('.taskpane-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // DOM Elements - Content Basics & Contact
  const editName = document.getElementById('edit-name');
  const editTitle = document.getElementById('edit-title');
  const editSummary = document.getElementById('edit-summary');
  const charCounterSummary = document.getElementById('char-counter-summary');
  const inputPhone = document.getElementById('input-phone');
  const inputEmail = document.getElementById('input-email');
  const inputLocation = document.getElementById('input-location');
  const inputGithub = document.getElementById('input-github');
  const inputLinkedin = document.getElementById('input-linkedin');
  const inputWebsite = document.getElementById('input-website');
  const chkContactPhone = document.getElementById('chk-contact-phone');
  const chkContactEmail = document.getElementById('chk-contact-email');
  const chkContactLocation = document.getElementById('chk-contact-location');
  const chkContactGithub = document.getElementById('chk-contact-github');
  const chkContactLinkedin = document.getElementById('chk-contact-linkedin');
  const chkContactWebsite = document.getElementById('chk-contact-website');

  // DOM Elements - Content Containers
  const workItemsContainer = document.getElementById('work-items-container');
  const skillsItemsContainer = document.getElementById('skills-items-container');
  const eduItemsContainer = document.getElementById('edu-items-container');
  const projItemsContainer = document.getElementById('proj-items-container');

  // DOM Elements - Design & Styling
  const selectFontPairing = document.getElementById('select-font-pairing');
  const selectDensity = document.getElementById('select-density');
  const selectMargins = document.getElementById('select-margins');
  const colorSwatches = document.getElementById('color-swatches');
  const inputCustomColor = document.getElementById('input-custom-color');
  const inputColorHex = document.getElementById('input-color-hex');

  // DOM Elements - Section Headings
  const headingSummary = document.getElementById('heading-summary');
  const headingExperience = document.getElementById('heading-experience');
  const headingEducation = document.getElementById('heading-education');
  const headingSkills = document.getElementById('heading-skills');
  const headingCertifications = document.getElementById('heading-certifications');
  const headingProjects = document.getElementById('heading-projects');
  const sectionOrderList = document.getElementById('section-order-list');
  const btnOrderSenior = document.getElementById('btn-order-senior');
  const btnOrderGraduate = document.getElementById('btn-order-graduate');

  let debounceTimer = null;

  function getApiUrl(endpoint) {
    if (window.location.protocol === 'file:') {
      return `http://127.0.0.1:3000${endpoint}`;
    }
    return endpoint;
  }

  function log(message, type = 'info') {
    if (!diagnosticsLog) return;
    const item = document.createElement('div');
    item.className = `log-item log-${type}`;
    const time = new Date().toLocaleTimeString();
    item.textContent = `[${time}] ${message}`;
    diagnosticsLog.appendChild(item);
    diagnosticsLog.scrollTop = diagnosticsLog.scrollHeight;
  }

  function setStatus(text, pageInfo = 'Page 1/1') {
    if (statusBarText) statusBarText.textContent = text;
    if (statusPageCount) statusPageCount.textContent = pageInfo;
  }

  // --- Zoom Simulation (Ctrl + Wheel) ---
  let currentZoom = 0.75;

  function setZoom(scale, isPreset = false) {
    currentZoom = Math.min(Math.max(scale, 0.25), 2.5);
    if (a4Page) a4Page.style.transform = `scale(${currentZoom.toFixed(2)})`;

    const percentText = `${Math.round(currentZoom * 100)}%`;
    let matchingOption = Array.from(zoomSelect.options).find(
      (opt) => opt.value !== 'fit' && Math.abs(parseFloat(opt.value) - currentZoom) < 0.02
    );

    if (matchingOption) {
      zoomSelect.value = matchingOption.value;
    } else if (!isPreset) {
      let customOption = document.getElementById('zoom-custom-option');
      if (!customOption) {
        customOption = document.createElement('option');
        customOption.id = 'zoom-custom-option';
        zoomSelect.appendChild(customOption);
      }
      customOption.value = currentZoom.toFixed(2);
      customOption.textContent = percentText;
      zoomSelect.value = customOption.value;
    }
  }

  function applyZoom() {
    const val = zoomSelect.value;
    if (val === 'fit') {
      const availableHeight = canvasArea.clientHeight - 60;
      const scale = Math.min(Math.max(availableHeight / 1123, 0.35), 1.0);
      currentZoom = scale;
      if (a4Page) a4Page.style.transform = `scale(${scale.toFixed(2)})`;
    } else {
      setZoom(parseFloat(val), true);
    }
  }

  function handleWheelZoom(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.05 : -0.05;
      setZoom(currentZoom + step);
    }
  }

  canvasArea?.addEventListener('wheel', handleWheelZoom, { passive: false });
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      handleWheelZoom(e);
    }
  }, { passive: false });

  zoomSelect?.addEventListener('change', applyZoom);
  window.addEventListener('resize', () => {
    if (zoomSelect?.value === 'fit') applyZoom();
  });

  // --- Tab Control Navigation ---
  taskpaneTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.dataset.tab;
      taskpaneTabButtons.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // --- Source Selection Radio ---
  radioSources.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.value === 'live' && r.checked) {
        if (liveUrlGroup) liveUrlGroup.style.display = 'block';
      } else if (r.checked) {
        if (liveUrlGroup) liveUrlGroup.style.display = 'none';
      }
    });
  });

  // --- Storage & State Management ---
  function saveStateToStorage() {
    try {
      const bundle = {
        draftResume,
        visibility,
        styleConfig,
        sectionHeadings,
        sectionOrder,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
    } catch {
      // Ignore quota errors
    }
  }

  function loadStateFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const bundle = JSON.parse(raw);
      if (bundle && bundle.draftResume) {
        draftResume = bundle.draftResume;
        visibility = bundle.visibility || visibility;
        styleConfig = bundle.styleConfig || styleConfig;
        sectionHeadings = bundle.sectionHeadings || sectionHeadings;
        sectionOrder = isValidSectionOrder(bundle.sectionOrder)
          ? [...bundle.sectionOrder]
          : [...DEFAULT_SECTION_ORDER];
        return true;
      }
    } catch (e) {
      log(`Storage load failed: ${e.message}`, 'warn');
    }
    return false;
  }

  function scheduleDebouncedPreview() {
    saveStateToStorage();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderPreview();
    }, 300);
  }

  // Build filtered resume according to visibility toggles
  function buildPayload() {
    if (!draftResume) return null;
    const cloned = JSON.parse(JSON.stringify(draftResume));

    // 1. Filter Contact Items
    if (cloned.basics && cloned.basics.contact) {
      if (!visibility.contact.phone) delete cloned.basics.contact.phone;
      if (!visibility.contact.email) delete cloned.basics.contact.email;
      if (!visibility.contact.location) cloned.basics.contact.location = '';
      if (!visibility.contact.github) delete cloned.basics.contact.github;
      if (!visibility.contact.linkedin) delete cloned.basics.contact.linkedin;
      if (!visibility.contact.website) delete cloned.basics.contact.website;
    }

    // 2. Filter Work items
    if (cloned.work && Array.isArray(cloned.work)) {
      cloned.work = cloned.work.filter((_, idx) => visibility.work[idx] !== false);
    }

    // 3. Filter Education items
    if (cloned.education && Array.isArray(cloned.education)) {
      cloned.education = cloned.education.filter((_, idx) => visibility.education[idx] !== false);
    }

    // 4. Filter Projects items
    if (cloned.projects && Array.isArray(cloned.projects)) {
      cloned.projects = cloned.projects.filter((_, idx) => visibility.projects[idx] !== false);
    }

    return cloned;
  }

  // --- Populate UI from State ---
  function populateContentForm() {
    if (!draftResume) return;

    // Basics
    if (editName) editName.value = draftResume.basics?.name || '';
    if (editTitle) editTitle.value = draftResume.basics?.title || '';
    if (editSummary) {
      editSummary.value = draftResume.basics?.summary || '';
      updateCharCounter();
    }

    // Contact
    if (inputPhone) inputPhone.value = draftResume.basics?.contact?.phone || '';
    if (inputEmail) inputEmail.value = draftResume.basics?.contact?.email || '';
    if (inputLocation) inputLocation.value = draftResume.basics?.contact?.location || '';
    if (inputGithub) inputGithub.value = draftResume.basics?.contact?.github || '';
    if (inputLinkedin) inputLinkedin.value = draftResume.basics?.contact?.linkedin || '';
    if (inputWebsite) inputWebsite.value = draftResume.basics?.contact?.website || '';

    if (chkContactPhone) chkContactPhone.checked = visibility.contact.phone !== false;
    if (chkContactEmail) chkContactEmail.checked = visibility.contact.email !== false;
    if (chkContactLocation) chkContactLocation.checked = visibility.contact.location !== false;
    if (chkContactGithub) chkContactGithub.checked = visibility.contact.github !== false;
    if (chkContactLinkedin) chkContactLinkedin.checked = visibility.contact.linkedin !== false;
    if (chkContactWebsite) chkContactWebsite.checked = visibility.contact.website !== false;

    // Work Experience
    renderWorkExperienceEditor();

    // Skills
    renderSkillsEditor();

    // Education & Projects
    renderEduAndProjectsEditor();

    // Design & Theme controls
    if (selectFontPairing) selectFontPairing.value = styleConfig.fontPairing || 'editorial';
    if (selectDensity) selectDensity.value = styleConfig.density || 'standard';
    if (selectMargins) selectMargins.value = styleConfig.margins || 'standard';
    updateAccentColorUI(styleConfig.accentColor || '#2b6cb0');

    // Section Headings
    if (headingSummary) headingSummary.value = sectionHeadings.SUMMARY || 'SUMMARY';
    if (headingExperience) headingExperience.value = sectionHeadings.EXPERIENCE || 'EXPERIENCE';
    if (headingEducation) headingEducation.value = sectionHeadings.EDUCATION || 'EDUCATION';
    if (headingSkills) headingSkills.value = sectionHeadings.SKILLS || 'SKILLS';
    if (headingCertifications) headingCertifications.value = sectionHeadings.CERTIFICATIONS || 'CERTIFICATIONS';
    if (headingProjects) headingProjects.value = sectionHeadings.PROJECTS || 'PROJECTS';
    renderSectionOrderController();
  }

  function isValidSectionOrder(order) {
    return Array.isArray(order)
      && order.length === DEFAULT_SECTION_ORDER.length
      && new Set(order).size === DEFAULT_SECTION_ORDER.length
      && order.every((key) => DEFAULT_SECTION_ORDER.includes(key));
  }

  function renderSectionOrderController() {
    if (!sectionOrderList) return;
    sectionOrderList.innerHTML = '';
    sectionOrder.forEach((key, index) => {
      const row = document.createElement('div');
      row.className = 'section-order-item';
      const headingKey = SECTION_HEADING_KEYS[key];
      const label = sectionHeadings[headingKey] || SECTION_LABELS[key];
      row.innerHTML = `
        <span class="section-order-position">${index + 1}.</span>
        <span class="section-order-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <button type="button" class="win-button win-button-sm btn-section-up" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(label)} up">↑</button>
        <button type="button" class="win-button win-button-sm btn-section-down" ${index === sectionOrder.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(label)} down">↓</button>
      `;
      row.querySelector('.btn-section-up')?.addEventListener('click', () => moveSection(index, -1));
      row.querySelector('.btn-section-down')?.addEventListener('click', () => moveSection(index, 1));
      sectionOrderList.appendChild(row);
    });
  }

  function moveSection(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= sectionOrder.length) return;
    [sectionOrder[index], sectionOrder[target]] = [sectionOrder[target], sectionOrder[index]];
    renderSectionOrderController();
    scheduleDebouncedPreview();
  }

  function applySectionOrderPreset(order) {
    sectionOrder = [...order];
    renderSectionOrderController();
    scheduleDebouncedPreview();
  }

  function updateCharCounter() {
    if (!editSummary || !charCounterSummary) return;
    const len = editSummary.value.length;
    charCounterSummary.textContent = `${len} characters`;
  }

  // --- Work Experience Editor UI ---
  function renderWorkExperienceEditor() {
    if (!workItemsContainer) return;
    workItemsContainer.innerHTML = '';

    if (!draftResume.work || draftResume.work.length === 0) {
      workItemsContainer.innerHTML = '<div style="font-size: 10px; color: #777;">No work experience entries found.</div>';
      return;
    }

    draftResume.work.forEach((item, roleIdx) => {
      const isIncluded = visibility.work[roleIdx] !== false;
      const card = document.createElement('div');
      card.className = 'editor-card';

      const header = document.createElement('div');
      header.className = 'editor-card-header';
      header.innerHTML = `
        <label class="win-checkbox-row" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <input type="checkbox" class="chk-work-include" data-idx="${roleIdx}" ${isIncluded ? 'checked' : ''}>
          <span>${item.role || 'Role'} @ ${item.company || 'Company'}</span>
        </label>
        <button type="button" class="win-button win-button-sm btn-card-toggle" title="Expand/Collapse">▾</button>
      `;

      const body = document.createElement('div');
      body.className = 'editor-card-body';

      // Role & Company inputs
      body.innerHTML = `
        <div style="display: flex; gap: 4px;">
          <div style="flex: 1;">
            <label class="form-label" style="font-size: 10px;">Role:</label>
            <input type="text" class="win-input input-work-role" data-idx="${roleIdx}" value="${escapeHtml(item.role || '')}" style="width: 100%;">
          </div>
          <div style="flex: 1;">
            <label class="form-label" style="font-size: 10px;">Company:</label>
            <input type="text" class="win-input input-work-company" data-idx="${roleIdx}" value="${escapeHtml(item.company || '')}" style="width: 100%;">
          </div>
        </div>
        <div style="display: flex; gap: 4px;">
          <div style="flex: 1;">
            <label class="form-label" style="font-size: 10px;">Start:</label>
            <input type="text" class="win-input input-work-start" data-idx="${roleIdx}" value="${escapeHtml(item.start || '')}" style="width: 100%;">
          </div>
          <div style="flex: 1;">
            <label class="form-label" style="font-size: 10px;">End (leave blank for Present):</label>
            <input type="text" class="win-input input-work-end" data-idx="${roleIdx}" value="${escapeHtml(item.end || '')}" style="width: 100%;">
          </div>
        </div>
        <div style="margin-top: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span class="form-label" style="font-size: 10px; font-weight: bold;">Highlights & Bullets:</span>
            <button type="button" class="win-button win-button-sm btn-add-bullet" data-idx="${roleIdx}">+ Add Bullet</button>
          </div>
          <div class="bullets-container" id="bullets-container-${roleIdx}"></div>
        </div>
      `;

      card.appendChild(header);
      card.appendChild(body);
      workItemsContainer.appendChild(card);

      // Populate bullets
      const bulletsContainer = body.querySelector(`#bullets-container-${roleIdx}`);
      renderBulletInputs(bulletsContainer, item.highlights || [], roleIdx);

      // Card Header Toggle
      const toggleBtn = header.querySelector('.btn-card-toggle');
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        body.style.display = body.style.display === 'none' ? 'flex' : 'none';
        toggleBtn.textContent = body.style.display === 'none' ? '▸' : '▾';
      });

      // Include Checkbox listener
      const chkInclude = header.querySelector('.chk-work-include');
      chkInclude.addEventListener('change', (e) => {
        visibility.work[roleIdx] = e.target.checked;
        scheduleDebouncedPreview();
      });

      // Role / Company / Date inputs
      body.querySelector('.input-work-role').addEventListener('input', (e) => {
        item.role = e.target.value;
        scheduleDebouncedPreview();
      });
      body.querySelector('.input-work-company').addEventListener('input', (e) => {
        item.company = e.target.value;
        scheduleDebouncedPreview();
      });
      body.querySelector('.input-work-start').addEventListener('input', (e) => {
        item.start = e.target.value;
        scheduleDebouncedPreview();
      });
      body.querySelector('.input-work-end').addEventListener('input', (e) => {
        item.end = e.target.value.trim() || null;
        scheduleDebouncedPreview();
      });

      // Add Bullet Button
      body.querySelector('.btn-add-bullet').addEventListener('click', () => {
        if (!item.highlights) item.highlights = [];
        item.highlights.push('New key contribution or metric.');
        renderBulletInputs(bulletsContainer, item.highlights, roleIdx);
        scheduleDebouncedPreview();
      });
    });
  }

  function renderBulletInputs(container, highlights, roleIdx) {
    if (!container) return;
    container.innerHTML = '';

    highlights.forEach((bulletText, bIdx) => {
      const bItem = document.createElement('div');
      bItem.className = 'bullet-item';
      bItem.innerHTML = `
        <textarea class="win-textarea bullet-textarea" rows="2">${escapeHtml(bulletText)}</textarea>
        <button type="button" class="win-button btn-icon-only btn-danger btn-del-bullet" title="Delete bullet">×</button>
      `;

      const txt = bItem.querySelector('.bullet-textarea');
      txt.addEventListener('input', (e) => {
        highlights[bIdx] = e.target.value;
        scheduleDebouncedPreview();
      });

      const delBtn = bItem.querySelector('.btn-del-bullet');
      delBtn.addEventListener('click', () => {
        highlights.splice(bIdx, 1);
        renderBulletInputs(container, highlights, roleIdx);
        scheduleDebouncedPreview();
      });

      container.appendChild(bItem);
    });
  }

  // --- Skills Editor UI ---
  function renderSkillsEditor() {
    if (!skillsItemsContainer) return;
    skillsItemsContainer.innerHTML = '';

    if (!draftResume.skills || draftResume.skills.length === 0) {
      skillsItemsContainer.innerHTML = '<div style="font-size: 10px; color: #777;">No skills found.</div>';
      return;
    }

    draftResume.skills.forEach((cat, catIdx) => {
      const catBox = document.createElement('div');
      catBox.className = 'editor-card';

      catBox.innerHTML = `
        <div class="editor-card-header">
          <span>${escapeHtml(cat.category || 'Skill Category')}</span>
        </div>
        <div class="editor-card-body">
          <div class="tags-container" id="tags-container-${catIdx}"></div>
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <input type="text" class="win-input input-new-skill" placeholder="Add skill (e.g. Docker)" style="flex: 1;">
            <button type="button" class="win-button win-button-sm btn-add-skill">+ Add</button>
          </div>
        </div>
      `;

      skillsItemsContainer.appendChild(catBox);

      const tagsContainer = catBox.querySelector(`#tags-container-${catIdx}`);
      renderSkillTags(tagsContainer, cat.items || [], catIdx);

      const inputNewSkill = catBox.querySelector('.input-new-skill');
      const btnAddSkill = catBox.querySelector('.btn-add-skill');

      const addAction = () => {
        const val = inputNewSkill.value.trim();
        if (val) {
          if (!cat.items) cat.items = [];
          cat.items.push(val);
          inputNewSkill.value = '';
          renderSkillTags(tagsContainer, cat.items, catIdx);
          scheduleDebouncedPreview();
        }
      };

      btnAddSkill.addEventListener('click', addAction);
      inputNewSkill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addAction();
        }
      });
    });
  }

  function renderSkillTags(container, items, catIdx) {
    if (!container) return;
    container.innerHTML = '';

    items.forEach((itemText, iIdx) => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.innerHTML = `
        <span>${escapeHtml(itemText)}</span>
        <span class="tag-del-btn" title="Remove">×</span>
      `;

      pill.querySelector('.tag-del-btn').addEventListener('click', () => {
        items.splice(iIdx, 1);
        renderSkillTags(container, items, catIdx);
        scheduleDebouncedPreview();
      });

      container.appendChild(pill);
    });
  }

  // --- Education & Projects Editor UI ---
  function renderEduAndProjectsEditor() {
    if (eduItemsContainer) {
      eduItemsContainer.innerHTML = '<div style="font-weight: bold; font-size: 10px; margin-bottom: 4px;">Education:</div>';
      (draftResume.education || []).forEach((edu, eduIdx) => {
        const isIncluded = visibility.education[eduIdx] !== false;
        const div = document.createElement('div');
        div.style.marginBottom = '4px';
        div.innerHTML = `
          <label class="win-checkbox-row">
            <input type="checkbox" class="chk-edu-include" data-idx="${eduIdx}" ${isIncluded ? 'checked' : ''}>
            <span><b>${escapeHtml(edu.degree || '')}</b> - ${escapeHtml(edu.institution || '')}</span>
          </label>
        `;
        div.querySelector('.chk-edu-include').addEventListener('change', (e) => {
          visibility.education[eduIdx] = e.target.checked;
          scheduleDebouncedPreview();
        });
        eduItemsContainer.appendChild(div);
      });
    }

    if (projItemsContainer) {
      projItemsContainer.innerHTML = '<div style="font-weight: bold; font-size: 10px; margin-bottom: 4px;">Projects:</div>';
      (draftResume.projects || []).forEach((proj, projIdx) => {
        const isIncluded = visibility.projects[projIdx] !== false;
        const div = document.createElement('div');
        div.style.marginBottom = '4px';
        div.innerHTML = `
          <label class="win-checkbox-row">
            <input type="checkbox" class="chk-proj-include" data-idx="${projIdx}" ${isIncluded ? 'checked' : ''}>
            <span><b>${escapeHtml(proj.title || '')}</b></span>
          </label>
        `;
        div.querySelector('.chk-proj-include').addEventListener('change', (e) => {
          visibility.projects[projIdx] = e.target.checked;
          scheduleDebouncedPreview();
        });
        projItemsContainer.appendChild(div);
      });
    }
  }

  // --- Design & Theme UI Sync ---
  function updateAccentColorUI(color) {
    styleConfig.accentColor = color;
    if (inputCustomColor) inputCustomColor.value = color;
    if (inputColorHex) inputColorHex.value = color;

    document.querySelectorAll('.color-swatch-btn').forEach((btn) => {
      if (btn.dataset.color.toLowerCase() === color.toLowerCase()) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  document.querySelectorAll('.color-swatch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.color;
      updateAccentColorUI(col);
      scheduleDebouncedPreview();
    });
  });

  inputCustomColor?.addEventListener('input', (e) => {
    updateAccentColorUI(e.target.value);
    scheduleDebouncedPreview();
  });

  inputColorHex?.addEventListener('change', (e) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      updateAccentColorUI(val);
      scheduleDebouncedPreview();
    }
  });

  selectFontPairing?.addEventListener('change', (e) => {
    styleConfig.fontPairing = e.target.value;
    scheduleDebouncedPreview();
  });

  selectDensity?.addEventListener('change', (e) => {
    styleConfig.density = e.target.value;
    scheduleDebouncedPreview();
  });

  selectMargins?.addEventListener('change', (e) => {
    styleConfig.margins = e.target.value;
    scheduleDebouncedPreview();
  });

  // --- Section Headings Sync ---
  [
    { el: headingSummary, key: 'SUMMARY' },
    { el: headingExperience, key: 'EXPERIENCE' },
    { el: headingEducation, key: 'EDUCATION' },
    { el: headingSkills, key: 'SKILLS' },
    { el: headingCertifications, key: 'CERTIFICATIONS' },
    { el: headingProjects, key: 'PROJECTS' },
  ].forEach(({ el, key }) => {
    el?.addEventListener('input', (e) => {
      sectionHeadings[key] = e.target.value;
      renderSectionOrderController();
      scheduleDebouncedPreview();
    });
  });

  // --- Basics Form Listeners ---
  editName?.addEventListener('input', (e) => {
    if (draftResume?.basics) draftResume.basics.name = e.target.value;
    scheduleDebouncedPreview();
  });

  editTitle?.addEventListener('input', (e) => {
    if (draftResume?.basics) draftResume.basics.title = e.target.value;
    scheduleDebouncedPreview();
  });

  editSummary?.addEventListener('input', (e) => {
    if (draftResume?.basics) draftResume.basics.summary = e.target.value;
    updateCharCounter();
    scheduleDebouncedPreview();
  });

  // Contact inputs & toggles
  inputPhone?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.phone = e.target.value;
    scheduleDebouncedPreview();
  });
  inputEmail?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.email = e.target.value;
    scheduleDebouncedPreview();
  });
  inputLocation?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.location = e.target.value;
    scheduleDebouncedPreview();
  });
  inputGithub?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.github = e.target.value;
    scheduleDebouncedPreview();
  });
  inputLinkedin?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.linkedin = e.target.value;
    scheduleDebouncedPreview();
  });
  inputWebsite?.addEventListener('input', (e) => {
    if (draftResume?.basics?.contact) draftResume.basics.contact.website = e.target.value;
    scheduleDebouncedPreview();
  });

  chkContactPhone?.addEventListener('change', (e) => {
    visibility.contact.phone = e.target.checked;
    scheduleDebouncedPreview();
  });
  chkContactEmail?.addEventListener('change', (e) => {
    visibility.contact.email = e.target.checked;
    scheduleDebouncedPreview();
  });
  chkContactLocation?.addEventListener('change', (e) => {
    visibility.contact.location = e.target.checked;
    scheduleDebouncedPreview();
  });
  chkContactGithub?.addEventListener('change', (e) => {
    visibility.contact.github = e.target.checked;
    scheduleDebouncedPreview();
  });
  chkContactLinkedin?.addEventListener('change', (e) => {
    visibility.contact.linkedin = e.target.checked;
    scheduleDebouncedPreview();
  });
  chkContactWebsite?.addEventListener('change', (e) => {
    visibility.contact.website = e.target.checked;
    scheduleDebouncedPreview();
  });

  // --- Network API Actions ---
  async function extractData() {
    try {
      setStatus('Extracting resume DOM...');
      const sourceType = document.querySelector('input[name="source-type"]:checked')?.value || 'fixture';
      const source = sourceType === 'live'
        ? (inputLiveUrl?.value.trim() || 'https://farisantoni.com')
        : 'fixture';
      const phoneOverride = inputPhone?.value.trim() || undefined;

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
        if (statusAtsBadge) {
          statusAtsBadge.textContent = 'ATS: Error';
          statusAtsBadge.className = 'status-badge badge-error';
        }
        return;
      }

      pristineResume = result.data;

      // If no stored draft, initialize from pristine
      const hasStored = loadStateFromStorage();
      if (!hasStored || !draftResume) {
        draftResume = JSON.parse(JSON.stringify(pristineResume));
      }

      log(`Extraction successful. Loaded ${draftResume.work?.length || 0} work items, ${draftResume.education?.length || 0} education items.`, 'success');

      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((w) => log(`[Warning] ${w}`, 'warn'));
      }

      if (statusAtsBadge) {
        statusAtsBadge.textContent = 'ATS: Ready';
        statusAtsBadge.className = 'status-badge badge-ok';
      }

      populateContentForm();
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
    const payload = buildPayload();
    if (!payload) {
      log('No resume data available. Run extraction first.', 'warn');
      return;
    }

    try {
      setStatus('Compiling Handlebars template...');

      const res = await fetch(getApiUrl('/api/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: payload,
          styleConfig,
          headings: sectionHeadings,
          sectionOrder,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        log(`Rendering failed: ${result.error}`, 'error');
        if (result.issues) {
          result.issues.forEach((i) => log(`[Validation] ${i.path.join('.')}: ${i.message}`, 'warn'));
        }
        setStatus('Render error', 'Error');
        return;
      }

      if (previewFrame) previewFrame.srcdoc = result.html;
      if (placeholderOverlay) placeholderOverlay.style.display = 'none';

      log('Sandboxed preview successfully updated.', 'info');
      updateBudgetIndicator(payload);
    } catch (err) {
      log(`Preview error: ${err.message}`, 'error');
      setStatus('Preview failed', 'Error');
    }
  }

  async function exportPdf() {
    const payload = buildPayload();
    if (!payload) {
      log('Cannot export: No resume data loaded.', 'warn');
      return;
    }

    try {
      setStatus('Generating Playwright PDF (Strict A4)...');
      log('Calling headless Playwright PDF engine...', 'info');

      const res = await fetch(getApiUrl('/api/generate-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: payload,
          styleConfig,
          headings: sectionHeadings,
          sectionOrder,
        }),
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
      a.download = `resume-${payload.basics?.name?.toLowerCase().replace(/\s+/g, '-') || 'farisantoni'}.pdf`;
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

  function resetToPristine() {
    if (!pristineResume) {
      log('No pristine extraction to revert to.', 'warn');
      return;
    }
    if (confirm('Revert all customizations back to pristine extracted data?')) {
      draftResume = JSON.parse(JSON.stringify(pristineResume));
      visibility = {
        contact: { phone: true, email: true, location: true, github: true, linkedin: true, website: true },
        work: {},
        education: {},
        projects: {},
      };
      sectionOrder = [...DEFAULT_SECTION_ORDER];
      saveStateToStorage();
      populateContentForm();
      renderPreview();
      log('Reverted resume to pristine extracted state.', 'info');
    }
  }

  function exportJson() {
    if (!draftResume) {
      log('No data to export.', 'warn');
      return;
    }
    const profile = {
      version: PROFILE_VERSION,
      draftResume,
      visibility,
      styleConfig,
      sectionHeadings,
      sectionOrder,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-${draftResume.basics?.name?.toLowerCase().replace(/\s+/g, '-') || 'draft'}-profile.json`;
    a.click();
    URL.revokeObjectURL(url);
    log('Exported complete tailored profile.', 'info');
  }

  function normalizedVisibility(candidate, resume) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const contactDefaults = { phone: true, email: true, location: true, github: true, linkedin: true, website: true };
    const normalizeMap = (value, length) => {
      const result = {};
      for (let index = 0; index < length; index += 1) {
        result[index] = value?.[index] !== false;
      }
      return result;
    };
    return {
      contact: Object.fromEntries(Object.keys(contactDefaults).map((key) => [key, source.contact?.[key] !== false])),
      work: normalizeMap(source.work, resume.work?.length || 0),
      education: normalizeMap(source.education, resume.education?.length || 0),
      projects: normalizeMap(source.projects, resume.projects?.length || 0),
    };
  }

  function parseImportedProfile(parsed) {
    const isLegacy = parsed && parsed.basics && Array.isArray(parsed.work);
    if (!isLegacy && parsed?.version !== PROFILE_VERSION) {
      throw new Error(`Unsupported profile version: ${parsed?.version ?? 'missing'}`);
    }
    const resume = isLegacy ? parsed : parsed.draftResume;
    if (!resume || !resume.basics || !Array.isArray(resume.work)) {
      throw new Error('Invalid resume profile: missing draftResume, basics, or work');
    }
    const nextStyle = isLegacy ? { fontPairing: 'editorial', accentColor: '#2b6cb0', density: 'standard', margins: 'standard' } : parsed.styleConfig;
    if (!nextStyle
      || !['modern', 'editorial', 'serif'].includes(nextStyle.fontPairing)
      || !['compact', 'standard', 'spacious'].includes(nextStyle.density)
      || !['tight', 'standard', 'spacious'].includes(nextStyle.margins)
      || !/^#[0-9a-fA-F]{6}$/.test(nextStyle.accentColor)) {
      throw new Error('Invalid profile style configuration');
    }
    const nextHeadings = isLegacy ? { SUMMARY: 'SUMMARY', EXPERIENCE: 'EXPERIENCE', EDUCATION: 'EDUCATION', SKILLS: 'SKILLS', CERTIFICATIONS: 'CERTIFICATIONS', PROJECTS: 'PROJECTS' } : parsed.sectionHeadings;
    if (!nextHeadings || Object.values(SECTION_HEADING_KEYS).some((key) => typeof nextHeadings[key] !== 'string')) {
      throw new Error('Invalid profile section headings');
    }
    const nextOrder = isLegacy ? [...DEFAULT_SECTION_ORDER] : parsed.sectionOrder;
    if (!isValidSectionOrder(nextOrder)) throw new Error('Invalid profile section order');
    return {
      isLegacy,
      draftResume: JSON.parse(JSON.stringify(resume)),
      visibility: normalizedVisibility(isLegacy ? null : parsed.visibility, resume),
      styleConfig: { ...nextStyle },
      sectionHeadings: { ...nextHeadings },
      sectionOrder: [...nextOrder],
    };
  }

  async function validateImportedProfile(profile) {
    const res = await fetch(getApiUrl('/api/preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: profile.draftResume,
        styleConfig: profile.styleConfig,
        headings: profile.sectionHeadings,
        sectionOrder: profile.sectionOrder,
      }),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || 'Profile failed server validation');
    }
  }

  function handleImportJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const profile = parseImportedProfile(parsed);
        await validateImportedProfile(profile);
        draftResume = profile.draftResume;
        visibility = profile.visibility;
        styleConfig = profile.styleConfig;
        sectionHeadings = profile.sectionHeadings;
        sectionOrder = profile.sectionOrder;
        saveStateToStorage();
        populateContentForm();
        await renderPreview();
        log(`${profile.isLegacy ? 'Imported legacy resume JSON with default settings' : 'Restored complete tailored profile'} from "${file.name}".`, 'success');
      } catch (err) {
        log(`Failed to import JSON: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function estimateBudgetFill(resume) {
    const summaryLength = resume.basics?.summary?.length || 0;
    const workWeight = (resume.work || []).reduce((total, item) => {
      const highlights = (item.highlights || []).reduce(
        (sum, highlight) => sum + Math.max(2.5, highlight.length / 42),
        0
      );
      return total + 5 + highlights;
    }, 0);
    const educationWeight = (resume.education || []).length * 4;
    const skillsWeight = (resume.skills || []).reduce(
      (total, category) => total + 2.5 + (category.items || []).join(', ').length / 90,
      0
    );
    const projectWeight = (resume.projects || []).reduce(
      (total, project) => total + 4 + (project.description?.length || 0) / 55,
      0
    );
    const certificationWeight = (resume.certifications || []).length ? 3.5 : 0;
    const rawFill = 18 + summaryLength / 45 + workWeight + educationWeight
      + skillsWeight + projectWeight + certificationWeight;
    const densityFactor = { compact: 0.88, standard: 1, spacious: 1.12 }[styleConfig.density] || 1;
    const marginFactor = { tight: 0.93, standard: 1, spacious: 1.08 }[styleConfig.margins] || 1;
    return Math.max(0, rawFill * densityFactor * marginFactor);
  }

  function updateBudgetIndicator(resume) {
    try {
      const fill = estimateBudgetFill(resume);
      const state = fill > 100 ? 'overflow' : fill >= 85 ? 'near' : 'comfortable';
      if (budgetPercent) budgetPercent.textContent = `${Math.round(fill)}%`;
      if (budgetMeterFill) budgetMeterFill.style.width = `${Math.min(fill, 100)}%`;
      if (budgetMeter) budgetMeter.setAttribute('aria-valuenow', String(Math.min(Math.round(fill), 100)));
      if (budgetGuard) budgetGuard.dataset.state = state;
      if (budgetState) {
        budgetState.textContent = state === 'overflow'
          ? 'Overflow likely — generated PDF may exceed one page'
          : state === 'near' ? 'Near the one-page limit' : 'Comfortable fit';
      }
      setStatus('Document rendered in sandbox', state === 'overflow' ? 'Est. 2+ pages' : 'Page 1/1');
      if (state !== currentBudgetState) {
        currentBudgetState = state;
        const enabled = chkOfficeAssistant?.checked !== false;
        if (enabled && (state === 'near' || state === 'overflow') && !dismissedAssistantStates.has(state)) {
          if (assistantTip) assistantTip.textContent = state === 'overflow'
            ? 'Switch to Compact density or Tight margins, then hide a lower-priority item.'
            : 'Consider shortening a bullet before adding more content.';
          if (officeAssistant) officeAssistant.hidden = false;
        } else if (state === 'comfortable' && officeAssistant) {
          officeAssistant.hidden = true;
        }
      }
    } catch (err) {
      log(`Budget estimate unavailable: ${err.message}`, 'warn');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Attach Action Event Listeners ---
  btnExtract?.addEventListener('click', extractData);
  btnResetDraft?.addEventListener('click', resetToPristine);
  btnExportJson?.addEventListener('click', exportJson);
  btnImportJsonTrigger?.addEventListener('click', () => inputImportJson?.click());
  inputImportJson?.addEventListener('change', handleImportJson);
  btnOrderSenior?.addEventListener('click', () => applySectionOrderPreset(['summary', 'experience', 'skills', 'projects', 'education', 'certifications']));
  btnOrderGraduate?.addEventListener('click', () => applySectionOrderPreset(['summary', 'skills', 'projects', 'education', 'experience', 'certifications']));
  btnDismissAssistant?.addEventListener('click', () => {
    dismissedAssistantStates.add(currentBudgetState);
    if (officeAssistant) officeAssistant.hidden = true;
  });
  chkOfficeAssistant?.addEventListener('change', (event) => {
    localStorage.setItem(ASSISTANT_KEY, String(event.target.checked));
    if (!event.target.checked && officeAssistant) officeAssistant.hidden = true;
  });

  btnRenderPreview?.addEventListener('click', renderPreview);
  btnDownloadPdf?.addEventListener('click', exportPdf);

  tbPrint?.addEventListener('click', exportPdf);
  tbPreview?.addEventListener('click', renderPreview);
  tbSave?.addEventListener('click', exportJson);

  // Initial startup
  const statusHost = document.getElementById('status-host');
  if (statusHost && window.location.host) {
    statusHost.textContent = window.location.host;
  }
  if (chkOfficeAssistant) chkOfficeAssistant.checked = localStorage.getItem(ASSISTANT_KEY) !== 'false';
  applyZoom();
  extractData();
})();
