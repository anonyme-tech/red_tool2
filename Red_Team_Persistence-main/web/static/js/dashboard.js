const API = `${window.location.origin}/api`;
let currentAgent = null;
let cachedAgents = [];
let cachedListeners = [];
let cachedListenerProfiles = [];
let cachedAuditReports = [];
let selectedListenerId = null;
let selectedAgentId = null;
let selectedAuditReportId = null;
let selectedAuditReportDetail = null;
let activeCmdkIndex = 0;
let activeAgentQuickFilter = "all";
let activeAuditRiskFilter = "all";
let activeSessionsView = "table";
let bottomHeight = 180;
let sessionsGraphState = null;
let sessionsGraphAssets = null;
const BOTTOM_HEIGHT_KEY = "lab_bottom_height";
const SELECTED_LISTENER_KEY = "lab_selected_listener_id";
const AGENT_OFFLINE_AFTER_SECONDS = 12;
const MODELS_METHODS = ["add", "remove", "check", "list"];
const MODELS_TECHNIQUES = [
    {
        id: "reg",
        label: "reg",
        description: "Persistence through Registry Run and related keys.",
        fields: [
            { id: "key", label: "Registry Key", type: "select", required: true, options: ["hkcurun", "hkcurunonce", "hklmrun", "hklmrunonce", "logonscript", "userinit", "stickynotes"] },
            { id: "value_name", label: "Value Name", type: "text", required: false, placeholder: "UpdaterService" },
            { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
        ]
    },
    {
        id: "service",
        label: "service",
        description: "Windows service-based persistence creation/removal checks.",
        fields: [
            { id: "service_name", label: "Service Name", type: "text", required: false, placeholder: "WindowsUpdateSvc" },
            { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
        ]
    },
    {
        id: "schtask",
        label: "schtask",
        description: "Simulates scheduled task persistence with configurable trigger frequency.",
        fields: [
            { id: "task_name", label: "Task Name", type: "text", required: false, placeholder: "OfficeTelemetryTask" },
            { id: "frequency", label: "Frequency", type: "select", required: false, options: ["", "hourly", "daily", "logon"] },
            { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
        ]
    },
    {
        id: "startupfolder",
        label: "startupfolder",
        description: "Simulates startup folder shortcut-based persistence artifacts.",
        fields: [
            { id: "file_name", label: "File Name", type: "text", required: false, placeholder: "StartupUpdate.lnk" },
            { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
        ]
    },
    {
        id: "phantom",
        label: "phantom",
        description: "Safe simulation of RegisterApplicationRestart-style phantom persistence workflow.",
        fields: [
            { id: "scenario_name", label: "Scenario Name", type: "text", required: false, placeholder: "PhantomLabScenario01" },
            { id: "trigger_mode", label: "Trigger Mode", type: "select", required: false, options: ["all", "restart", "shutdown", "logoff"] },
            { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
        ]
    },

{
    id: "wmisubscription",
    label: "wmisubscription",
    description: "Simulates persistent WMI Event Subscription workflows (Filter / Consumer / Binding).",
    fields: [
        { id: "subscription_name", label: "Subscription Name", type: "text", required: false, placeholder: "WmiSubLab01" },
        { id: "trigger_mode", label: "Trigger Mode", type: "select", required: false, options: ["interval", "logon", "startup", "process"] },
        { 
            id: "interval_seconds", 
            label: "Interval Seconds (for interval trigger)", 
            type: "number", 
            required: false, 
            placeholder: "Enter seconds... (ex: 300)",
            depends_on: { trigger_mode: "interval" }  // ⭐ AJOUTER CECI
        },
        { 
            id: "process_name", 
            label: "Process Name (for process trigger)", 
            type: "text", 
            required: false, 
            placeholder: "Enter process name... (ex: notepad.exe)",
            depends_on: { trigger_mode: "process" }  // ⭐ AJOUTER CECI
        },
        { id: "method", label: "Method", type: "select", required: true, options: MODELS_METHODS }
    ]
}
];
let selectedModelTechniqueId = MODELS_TECHNIQUES[0].id;
let agentHealthStateById = new Map();
let agentHealthStateInitialized = false;
let agentDisplayIdMap = new Map();
let nextAgentDisplayCounter = 1;
const CMDK_ACTIONS = [
    { id: "chat", label: "Switch: Lab Console", run: () => switchBottomTab("chat") },
    { id: "enumeration", label: "Switch: Enumeration Results", run: () => switchBottomTab("enumeration") },
    { id: "listeners", label: "Switch: Listener Lab", run: () => switchBottomTab("listeners") },
    { id: "models", label: "Switch: MODELS", run: () => switchBottomTab("models") },
    { id: "ai", label: "Switch: AI Prediction", run: () => switchBottomTab("ai") },
    { id: "new-listener", label: "Listener: New", run: () => openListenerModal("create") },
    { id: "refresh", label: "Refresh all", run: () => refreshAll() }
];

// ==========================================
// AUTHENTIFICATION - À AJOUTER
// ==========================================

function getAuthToken() {
    return localStorage.getItem('access_token');
}

function isAuthenticated() {
    const token = getAuthToken();
    if (!token) return false;
    
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const exp = payload.exp * 1000;
        if (Date.now() > exp) {
            localStorage.removeItem('access_token');
            return false;
        }
    } catch (e) {
        return false;
    }
    return true;
}

const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    // Log pour debug
    console.log("[FETCH] URL:", url);
    
    if (!url.includes('/login') && 
        !url.includes('/static/') &&
        !url.includes('/api/health') &&
        !url.includes('/api/status')) {
        
        options.headers = options.headers || {};
        const token = getAuthToken();
        console.log("[FETCH] Token présent:", token ? "OUI" : "NON");
        
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
            console.log("[FETCH] Authorization ajouté");
        } else {
            console.log("[FETCH] PAS de token - requête sans auth");
        }
    }
    return originalFetch(url, options);
};

function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

function addLogoutButton() {
    const header = document.querySelector('.top-bar-actions');
    if (header && !document.getElementById('logout-btn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logout-btn';
        logoutBtn.className = 'btn-icon';
        logoutBtn.innerHTML = '🚪';
        logoutBtn.title = 'Déconnexion';
        logoutBtn.onclick = logout;
        header.appendChild(logoutBtn);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // ✅ Vérification du token
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/login';
        return;
    }
    
    selectedListenerId = getStoredSelectedListenerId();
    setupEvents();
    setupSortableTables();
    initBottomResizer();
    tickClock();
    setInterval(tickClock, 1000);
    refreshAll();
    setInterval(refreshAll, 3000);
    addConsoleLog("[*] Defensive Listener Lab UI started (Ctrl+K for palette)", "info");
    
    // ✅ Ajouter le bouton de déconnexion
    addLogoutButton();
});

function setupEvents() {
    const input = document.getElementById("console-input");
    const runBtn = document.getElementById("execute-btn");
    const filter = document.getElementById("agent-filter");
    const chips = document.getElementById("agent-filter-chips");
    const modal = document.getElementById("agent-modal");
    const newListenerBtn = document.getElementById("new-listener-btn");
    const newPayloadBtn = document.getElementById("new-payload-btn");
    const listenerModal = document.getElementById("listener-modal");
    const payloadModal = document.getElementById("payload-modal");
    const tabChat = document.getElementById("tab-chat");
    const tabEnumeration = document.getElementById("tab-enumeration");
    const tabListeners = document.getElementById("tab-listeners");
    const tabModels = document.getElementById("tab-models");
    const tabAi = document.getElementById("tab-ai");
    const listenerAddBtn = document.getElementById("listener-add-btn");
    const listenerRemoveBtn = document.getElementById("listener-remove-btn");
    const listenerEditBtn = document.getElementById("listener-edit-btn");
    const listenerStartBtn = document.getElementById("listener-start-btn");
    const listenerStopBtn = document.getElementById("listener-stop-btn");
    const listenerStatsBtn = document.getElementById("listener-stats-btn");
    const listenerExportBtn = document.getElementById("listener-export-btn");
    const auditRefreshBtn = document.getElementById("audit-refresh-btn");
    const auditDownloadBtn = document.getElementById("audit-download-btn");
    const auditCopyBtn = document.getElementById("audit-copy-btn");
    const auditRiskFilter = document.getElementById("audit-risk-filter");
    const cmdkInput = document.getElementById("cmdk-input");
    const payloadTargetListener = document.getElementById("payload-target-listener");
    const sessionsTabTable = document.getElementById("sessions-tab-table");
    const sessionsTabGraph = document.getElementById("sessions-tab-graph");

    if (runBtn) runBtn.addEventListener("click", executeConsoleCommand);
    if (input) input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") executeConsoleCommand();
    });
    if (filter) filter.addEventListener("input", filterAgentsTable);
    if (chips) {
        chips.querySelectorAll(".agent-chip").forEach((chip) => {
            chip.addEventListener("click", () => {
                activeAgentQuickFilter = chip.dataset.filter || "all";
                chips.querySelectorAll(".agent-chip").forEach((button) => button.classList.remove("active"));
                chip.classList.add("active");
                filterAgentsTable();
            });
        });
    }

    if (newListenerBtn) newListenerBtn.addEventListener("click", () => openListenerModal("create"));
    if (newPayloadBtn) newPayloadBtn.addEventListener("click", () => openPayloadModal("create"));
    if (tabChat) tabChat.addEventListener("click", () => switchBottomTab("chat"));
    if (tabEnumeration) tabEnumeration.addEventListener("click", () => switchBottomTab("enumeration"));
    if (tabListeners) tabListeners.addEventListener("click", () => switchBottomTab("listeners"));
    if (tabModels) tabModels.addEventListener("click", () => switchBottomTab("models"));
    if (tabAi) tabAi.addEventListener("click", () => switchBottomTab("ai"));

    if (listenerAddBtn) listenerAddBtn.addEventListener("click", () => openListenerModal("create"));
    if (listenerEditBtn) listenerEditBtn.addEventListener("click", () => openListenerModal("edit"));
    if (listenerRemoveBtn) listenerRemoveBtn.addEventListener("click", removeSelectedListener);
    if (listenerStartBtn) listenerStartBtn.addEventListener("click", startSelectedListener);
    if (listenerStopBtn) listenerStopBtn.addEventListener("click", stopSelectedListener);
    if (listenerStatsBtn) listenerStatsBtn.addEventListener("click", showSelectedListenerStats);
    if (listenerExportBtn) listenerExportBtn.addEventListener("click", exportSelectedListener);
    if (auditRefreshBtn) auditRefreshBtn.addEventListener("click", loadAuditReports);
    if (auditDownloadBtn) auditDownloadBtn.addEventListener("click", downloadSelectedAuditReportJson);
    if (auditCopyBtn) auditCopyBtn.addEventListener("click", copySelectedAuditReportJson);
    if (auditRiskFilter) {
        auditRiskFilter.addEventListener("change", () => {
            activeAuditRiskFilter = String(auditRiskFilter.value || "all").toLowerCase();
            renderAuditReports();
        });
    }

    if (modal) modal.addEventListener("click", (e) => {
        if (e.target.id === "agent-modal") closeModal();
    });
    if (listenerModal) listenerModal.addEventListener("click", (e) => {
        if (e.target.id === "listener-modal") closeListenerModal();
    });
    if (payloadModal) payloadModal.addEventListener("click", (e) => {
        if (e.target.id === "payload-modal") closePayloadModal();
    });

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openCmdk();
        }
        if (e.key === "Escape") {
            closeCmdk();
        }
    });
    if (cmdkInput) {
        cmdkInput.addEventListener("input", renderCmdkList);
        cmdkInput.addEventListener("keydown", onCmdkKeydown);
    }
    if (payloadTargetListener) {
        payloadTargetListener.addEventListener("change", () => syncPayloadServerIpFromSelectedListener({ force: true }));
    }
    if (sessionsTabTable) sessionsTabTable.addEventListener("click", () => switchSessionsView("table"));
    if (sessionsTabGraph) sessionsTabGraph.addEventListener("click", () => switchSessionsView("graph"));
    initModelsView();
    initAiPredictionView();
    initSessionsGraph();
}

function initBottomResizer() {
    const app = document.querySelector(".lab-app");
    const resizer = document.getElementById("bottom-resizer");
    if (!app || !resizer) return;

    const savedHeight = parseInt(localStorage.getItem(BOTTOM_HEIGHT_KEY) || "180", 10);
    if (!Number.isNaN(savedHeight)) bottomHeight = Math.min(Math.max(savedHeight, 120), 420);
    applyBottomLayout();

    let dragging = false;
    const onMouseMove = (e) => {
        if (!dragging) return;
        const rect = app.getBoundingClientRect();
        const next = rect.bottom - e.clientY;
        bottomHeight = Math.min(Math.max(Math.round(next), 120), 420);
        applyBottomLayout();
    };
    const onMouseUp = () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = "";
        localStorage.setItem(BOTTOM_HEIGHT_KEY, String(bottomHeight));
    };

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        document.body.style.cursor = "row-resize";
    });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", applyBottomLayout);
}

function applyBottomLayout() {
    const app = document.querySelector(".lab-app");
    if (!app) return;
    app.style.gridTemplateRows = `38px 1fr 12px ${bottomHeight}px`;
}

async function refreshAll() {
    const token = getAuthToken();
    if (!token) {
        console.log("[*] Non authentifié - refresh ignoré");
        return;
    }
    
    await loadDashboardStats();
    await loadAgents();
    await loadListenerProfiles();
    await loadListeners();
    renderListenersTable();
    await loadAuditReports({ silent: true });
}

function switchBottomTab(tab) {
    const chatView = document.getElementById("chat-view");
    const enumerationView = document.getElementById("enumeration-view");
    const listenersView = document.getElementById("listeners-view");
    const modelsView = document.getElementById("models-view");
    const aiView = document.getElementById("ai-view");
    const tabChat = document.getElementById("tab-chat");
    const tabEnumeration = document.getElementById("tab-enumeration");
    const tabListeners = document.getElementById("tab-listeners");
    const tabModels = document.getElementById("tab-models");
    const tabAi = document.getElementById("tab-ai");

    // reset views
    if (chatView) chatView.classList.remove("active");
    if (enumerationView) enumerationView.classList.remove("active");
    if (listenersView) listenersView.classList.remove("active");
    if (modelsView) modelsView.classList.remove("active");
    if (aiView) aiView.classList.remove("active");
    if (tabChat) tabChat.classList.remove("active");
    if (tabEnumeration) tabEnumeration.classList.remove("active");
    if (tabListeners) tabListeners.classList.remove("active");
    if (tabModels) tabModels.classList.remove("active");
    if (tabAi) tabAi.classList.remove("active");

    if (tab === "listeners") {
        if (listenersView) listenersView.classList.add("active");
        if (tabListeners) tabListeners.classList.add("active");
        renderListenersTable();
        renderAuditReports();
        return;
    }

    if (tab === "enumeration") {
        if (enumerationView) enumerationView.classList.add("active");
        if (tabEnumeration) tabEnumeration.classList.add("active");
        renderAuditReports();
        renderAuditPreview();
        return;
    }
    if (tab === "models") {
        if (modelsView) modelsView.classList.add("active");
        if (tabModels) tabModels.classList.add("active");
        return;
    }
    if (tab === "ai") {
        if (aiView) aiView.classList.add("active");
        if (tabAi) tabAi.classList.add("active");
        return;
    }

    if (chatView) chatView.classList.add("active");
    if (tabChat) tabChat.classList.add("active");
}

function initAiPredictionView() {
    const analyzeBtn = document.getElementById("ai-analyze-btn");
    const clearBtn = document.getElementById("ai-clear-btn");
    if (analyzeBtn) analyzeBtn.addEventListener("click", runAiPredictionLocal);
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            const input = document.getElementById("ai-enum-json");
            const output = document.getElementById("ai-output-json");
            const summary = document.getElementById("ai-summary");
            const tbody = document.getElementById("ai-results-tbody");
            if (input) input.value = "";
            if (output) output.value = "";
            if (summary) summary.textContent = "No analysis run yet.";
            if (tbody) tbody.innerHTML = '<tr class="loading"><td colspan="4">Run AI analysis to see ranked techniques</td></tr>';
        });
    }
}

function runAiPredictionLocal() {
    const input = document.getElementById("ai-enum-json");
    const output = document.getElementById("ai-output-json");
    const summary = document.getElementById("ai-summary");
    const tbody = document.getElementById("ai-results-tbody");
    if (!input || !output || !summary || !tbody) return;

    let parsed;
    try {
        parsed = JSON.parse(String(input.value || "{}"));
    } catch (error) {
        summary.textContent = "Invalid JSON. Please fix input.";
        tbody.innerHTML = '<tr class="loading"><td colspan="4">Invalid JSON input</td></tr>';
        output.value = JSON.stringify({ status: "error", detail: "Invalid JSON", error: String(error.message || error) }, null, 2);
        return;
    }

    const ranked = scoreTechniquesFromEnumeration(parsed);
    const result = {
        status: "ok",
        mode: "local-heuristic",
        generated_at: new Date().toISOString(),
        total_candidates: ranked.length,
        ranked_techniques: ranked
    };
    output.value = JSON.stringify(result, null, 2);
    summary.textContent = `Analysis complete: ${ranked.length} techniques ranked. Top recommendation: ${ranked[0]?.technique || "n/a"}.`;
    tbody.innerHTML = "";
    ranked.forEach((item, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${item.technique}</td>
            <td>${item.score}</td>
            <td>${item.reason}</td>
        `;
        tbody.appendChild(row);
    });
}

function scoreTechniquesFromEnumeration(report) {
    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const system = report?.system || {};
    const scores = new Map([
        ["reg", 30],
        ["startupfolder", 25],
        ["schtask", 35],
        ["service", 35],
        ["wmisubscription", 28],
        ["phantom", 12]
    ]);
    const reasons = new Map([
        ["reg", "Baseline recommendation for user-context persistence."],
        ["startupfolder", "Simple user-level startup fallback."],
        ["schtask", "Reliable trigger-based execution candidate."],
        ["service", "Fits elevated/system execution scenarios."],
        ["wmisubscription", "Event-driven persistence candidate for advanced workflows."],
        ["phantom", "Experimental event-based persistence option."]
    ]);

    const isAdmin = Boolean(system?.isAdministrator || system?.is_admin);
    if (isAdmin) {
        scores.set("service", (scores.get("service") || 0) + 20);
        scores.set("wmisubscription", (scores.get("wmisubscription") || 0) + 15);
        reasons.set("service", "Admin context detected: service persistence becomes feasible.");
        reasons.set("wmisubscription", "Admin context detected: WMI subscription can be provisioned.");
    } else {
        scores.set("startupfolder", (scores.get("startupfolder") || 0) + 12);
        scores.set("reg", (scores.get("reg") || 0) + 10);
    }

    findings.forEach((f) => {
        const type = String(f?.type || "").toLowerCase();
        if (type.includes("service")) scores.set("service", (scores.get("service") || 0) + 12);
        if (type.includes("task")) scores.set("schtask", (scores.get("schtask") || 0) + 12);
        if (type.includes("registry") || type.includes("run_key")) scores.set("reg", (scores.get("reg") || 0) + 10);
        if (type.includes("startup")) scores.set("startupfolder", (scores.get("startupfolder") || 0) + 10);
        if (type.includes("wmi")) scores.set("wmisubscription", (scores.get("wmisubscription") || 0) + 12);
    });

    return Array.from(scores.entries())
        .map(([technique, score]) => ({ technique, score, reason: reasons.get(technique) || "Heuristic score based on enumeration signals." }))
        .sort((a, b) => b.score - a.score);
}

function initModelsView() {
    renderModelsTechniqueList();
    renderModelsForm();
    const form = document.getElementById("models-form");
    if (form) {
        form.addEventListener("submit", submitModelsSimulation);
    }
}

function getSelectedModelTechnique() {
    return MODELS_TECHNIQUES.find((technique) => technique.id === selectedModelTechniqueId) || MODELS_TECHNIQUES[0];
}

function renderModelsTechniqueList() {
    const container = document.getElementById("models-techniques-list");
    if (!container) return;
    container.innerHTML = "";
    MODELS_TECHNIQUES.forEach((technique) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `models-technique-btn${technique.id === selectedModelTechniqueId ? " active" : ""}`;
        button.innerHTML = `
            <div class="models-technique-title">${technique.label}</div>
            <div class="models-technique-desc">${technique.description}</div>
        `;
        button.addEventListener("click", () => {
            selectedModelTechniqueId = technique.id;
            renderModelsTechniqueList();
            renderModelsForm();
        });
        container.appendChild(button);
    });
}

function createModelsFieldRow(field) {
    const row = document.createElement("div");
    row.className = "detail-row";
    const label = document.createElement("div");
    label.className = "detail-label";
    label.textContent = field.label;
    const value = document.createElement("div");
    value.className = "detail-value";
    const inputId = `models-field-${field.id}`;

    if (field.type === "select") {
        const select = document.createElement("select");
        select.id = inputId;
        select.className = "form-input";
        (field.options || []).forEach((optionValue) => {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue || "none";
            select.appendChild(option);
        });
        if (field.id === "method") select.value = "add";
        value.appendChild(select);
    } else if (field.type === "checkbox") {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = inputId;
        value.appendChild(checkbox);
    } else {
        const input = document.createElement("input");
        input.type = "text";
        input.id = inputId;
        input.className = "form-input";
        input.placeholder = field.placeholder || "";
        value.appendChild(input);
    }

    row.appendChild(label);
    row.appendChild(value);
    return row;
}

function renderModelsForm() {
    const technique = getSelectedModelTechnique();
    const description = document.getElementById("models-description");
    const fieldsContainer = document.getElementById("models-fields");
    if (!description || !fieldsContainer) return;
    
    description.textContent = `${technique.label}: ${technique.description}\nSimulation-only mode: no real persistence action is executed.`;
    fieldsContainer.innerHTML = "";
    
    technique.fields.forEach((field) => {
        fieldsContainer.appendChild(createModelsFieldRow(field));
    });
    
    // 🔥 GESTION DES CHAMPS CONDITIONNELS - Déplacée en dehors du forEach
    const triggerSelect = document.getElementById("models-field-trigger_mode");
    if (triggerSelect) {
        // Supprimer l'ancien event listener pour éviter les doublons
        const newTriggerSelect = triggerSelect.cloneNode(true);
        triggerSelect.parentNode.replaceChild(newTriggerSelect, triggerSelect);
        
        newTriggerSelect.addEventListener("change", () => {
            toggleConditionalFields(technique.fields, newTriggerSelect.value);
        });
        
        // Déclencher immédiatement pour afficher/masquer les champs selon la valeur initiale
        toggleConditionalFields(technique.fields, newTriggerSelect.value);
    }
}
function toggleConditionalFields(fields, triggerValue) {
    console.log("[DEBUG] toggleConditionalFields called with triggerValue:", triggerValue);
    
    fields.forEach(field => {
        if (field.depends_on && field.depends_on.trigger_mode) {
            const row = document.getElementById(`models-field-${field.id}`)?.closest('.detail-row');
            if (row) {
                const shouldShow = field.depends_on.trigger_mode === triggerValue;
                console.log(`[DEBUG] Field ${field.id}: shouldShow = ${shouldShow} (triggerValue=${triggerValue}, expected=${field.depends_on.trigger_mode})`);
                row.style.display = shouldShow ? "flex" : "none";
            }
        }
    });
}

function collectModelsPayload() {
    const technique = getSelectedModelTechnique();
    const payload = {
        technique: technique.id,
        server_url: window.location.origin,
        listener_id: selectedListenerId || "",
        agent_id: selectedAgentId || "",
        fields: {}
    };
    
    technique.fields.forEach((field) => {
        const input = document.getElementById(`models-field-${field.id}`);
        if (!input) return;
        
        if (field.type === "checkbox") {
            payload.fields[field.id] = Boolean(input.checked);
            return;
        }
        
        if (field.type === "number") {
            const numValue = parseInt(input.value, 10);
            // ⚠️ L'utilisateur DOIT entrer une valeur, pas de défaut
            payload.fields[field.id] = isNaN(numValue) ? "" : numValue;
            return;
        }
        
        payload.fields[field.id] = String(input.value || "").trim();
    });
    
    // 🔥 TRAITEMENT SPÉCIAL POUR WMISUBSCRIPTION
    if (technique.id === "wmisubscription") {
        const triggerMode = payload.fields.trigger_mode;
        
        // Pour interval: prendre la valeur entrée par l'utilisateur
        if (triggerMode === "interval") {
            const intervalValue = payload.fields.interval_seconds;
            if (!intervalValue || intervalValue === "") {
                // ⚠️ L'utilisateur n'a pas entré de valeur → on ne construit pas command_arg
                payload.fields.command_arg = "";
                console.warn("⚠️ Interval trigger selected but no interval seconds provided");
            } else {
                payload.fields.command_arg = `interval=${intervalValue}`;
            }
        }
        // Pour process: prendre le nom entré par l'utilisateur
        else if (triggerMode === "process") {
            const processValue = payload.fields.process_name;
            if (!processValue || processValue === "") {
                // ⚠️ L'utilisateur n'a pas entré de nom → on ne construit pas command_arg
                payload.fields.command_arg = "";
                console.warn("⚠️ Process trigger selected but no process name provided");
            } else {
                payload.fields.command_arg = `process=${processValue}`;
            }
        }
        // Pour logon ou startup: pas de paramètre supplémentaire
        else {
            payload.fields.command_arg = "";
        }
    }
    
    return payload;
}

async function submitModelsSimulation(event) {
    event.preventDefault();
    const output = document.getElementById("models-output-json");
    if (!output) return;
    const payload = collectModelsPayload();
    
    // Validation listener et agent
    if (!payload.listener_id) {
        output.value = JSON.stringify({ status: "error", detail: "Select a listener before running MODELS." }, null, 2);
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    if (!payload.agent_id) {
        output.value = JSON.stringify({ status: "error", detail: "Select an agent before running MODELS." }, null, 2);
        addConsoleLog("[-] select an agent first", "error");
        return;
    }
    
    // 🔥 VALIDATION SPÉCIALE POUR WMISUBSCRIPTION
    if (payload.technique === "wmisubscription") {
        const triggerMode = payload.fields.trigger_mode;
        
        // Vérifier que trigger_mode est sélectionné
        if (!triggerMode || triggerMode === "") {
            output.value = JSON.stringify({ 
                status: "error", 
                detail: "⚠️ For WMI Subscription, please select a Trigger Mode (interval, logon, startup, or process)" 
            }, null, 2);
            addConsoleLog("[-] WMI Subscription: Trigger Mode is required", "error");
            return;
        }
        
        // Validation pour interval
        if (triggerMode === "interval") {
            const intervalSeconds = payload.fields.interval_seconds;
            if (!intervalSeconds || intervalSeconds === "") {
                output.value = JSON.stringify({ 
                    status: "error", 
                    detail: "⚠️ For 'interval' trigger, please enter Interval Seconds value (ex: 60, 300, 3600)" 
                }, null, 2);
                addConsoleLog("[-] WMI Subscription: Interval Seconds is required for interval trigger", "error");
                return;
            }
            if (isNaN(parseInt(intervalSeconds, 10)) || parseInt(intervalSeconds, 10) <= 0) {
                output.value = JSON.stringify({ 
                    status: "error", 
                    detail: "⚠️ Interval Seconds must be a positive number (ex: 60, 300, 3600)" 
                }, null, 2);
                addConsoleLog("[-] WMI Subscription: Interval Seconds must be a positive number", "error");
                return;
            }
        }
        
        // Validation pour process
if (triggerMode === "process") {
    const processName = payload.fields.process_name;
    
    // 1. Champ vide
    if (!processName || processName === "") {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name is required (ex: notepad.exe, chrome.exe)" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Process Name is required for process trigger", "error");
        return;
    }
    
    // 2. Doit se terminer par .exe
    if (!processName.toLowerCase().endsWith(".exe")) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name must have .exe extension (ex: notepad.exe)" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Process Name must end with .exe", "error");
        return;
    }
    
    // 3. Rejeter les doubles extensions (.exe.exe)
    const nameWithoutExt = processName.slice(0, -4).toLowerCase();
    if (nameWithoutExt.endsWith(".exe")) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Invalid process name: double .exe extension detected (ex: file.exe.exe is not valid)" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Double .exe extension not allowed", "error");
        return;
    }
    
    // 4. One extension .exe seulement
    const dotCount = (processName.match(/\./g) || []).length;
    if (dotCount > 1) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name can only have one dot (for .exe extension) - multiple dots not allowed" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Multiple dots not allowed", "error");
        return;
    }
    
    // 5. Longueur minimale (ex: a.exe = 5 caractères)
    if (processName.length < 5) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name is too short (minimum: a.exe)" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Process Name too short", "error");
        return;
    }
    
    // 🔥 6. Caractères autorisés (lettres, chiffres, underscore, tiret, point)
    const validCharsRegex = /^[a-zA-Z0-9_.-]+\.exe$/;
    if (!validCharsRegex.test(processName)) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name contains invalid characters. Allowed: letters A-Z, numbers 0-9, underscore _, dash -, dot . (only before .exe)" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Invalid characters in process name", "error");
        return;
    }
    
    // 7. Pas d'espaces
    if (processName.includes(" ")) {
        output.value = JSON.stringify({ 
            status: "error", 
            detail: "⚠️ Process Name cannot contain spaces" 
        }, null, 2);
        addConsoleLog("[-] WMI Subscription: Process Name cannot have spaces", "error");
        return;
    }
}
        
        // Validation subscription_name
        if (payload.fields.method === "add" || payload.fields.method === "remove" || payload.fields.method === "check") {
            if (!payload.fields.subscription_name || payload.fields.subscription_name === "") {
                output.value = JSON.stringify({ 
                    status: "error", 
                    detail: "⚠️ Subscription Name is required for add/remove/check operations" 
                }, null, 2);
                addConsoleLog("[-] WMI Subscription: Subscription Name is required", "error");
                return;
            }
        }
    }
    
    output.value = "Running simulation...";
    try {
        const response = await fetch(`${API}/models/simulate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        output.value = JSON.stringify(data, null, 2);
        if (!response.ok) {
            addConsoleLog(`[-] models simulation failed: ${data.detail || response.statusText}`, "error");
            return;
        }
        const executed = Boolean(data.executed_on_agent);
        const suffix = executed
            ? ` and executed on ${payload.agent_id}`
            : " (validation only)";
        
        // Message plus détaillé pour wmisubscription
        if (payload.technique === "wmisubscription") {
            const triggerMode = payload.fields.trigger_mode;
            let extraInfo = "";
            if (triggerMode === "interval") {
                extraInfo = ` (every ${payload.fields.interval_seconds} seconds)`;
            } else if (triggerMode === "process") {
                extraInfo = ` (on ${payload.fields.process_name} launch)`;
            }
            addConsoleLog(`[+] WMI Subscription ${payload.fields.method}ed: ${payload.fields.subscription_name} [${triggerMode}${extraInfo}]${suffix}`, "success");
        } else {
            addConsoleLog(`[+] models simulation generated (${payload.technique})${suffix}`, "success");
        }
    } catch (error) {
        output.value = JSON.stringify({ status: "error", detail: error.message }, null, 2);
        addConsoleLog(`[-] models simulation error: ${error.message}`, "error");
    }
}

function tickClock() {
    document.getElementById("header-time").textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
}

async function loadDashboardStats() {
    try {
        const res = await fetch(`${API}/health`);
        const data = await res.json();
        const ok = data.status === "healthy" || data.status === "online" || data.status === "operational";
        const statusEl = document.getElementById("server-status");
        statusEl.className = `status-indicator ${ok ? "online" : "offline"}`;
        statusEl.textContent = ok ? "ONLINE" : "OFFLINE";
    } catch (e) {
        const statusEl = document.getElementById("server-status");
        statusEl.className = "status-indicator offline";
        statusEl.textContent = "OFFLINE";
    }
}

function addConsoleLog(message, type = "info") {
    const output = document.getElementById("console-output");
    const line = document.createElement("div");
    line.className = `console-line ${type}`;
    const normalized = String(message ?? "").replace(/\r\n/g, "\n");
    line.textContent = normalized;
    if (normalized.includes("\n")) {
        line.classList.add("multiline");
    }
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    const lines = output.querySelectorAll(".console-line");
    if (lines.length > 600) lines[0].remove();
}


function getAgentHealthSnapshot(agent) {
    const rawStatus = String(agent?.status || "").toLowerCase();
    const lastSeenMs = Date.parse(agent?.last_seen || "");
    const stale = Number.isFinite(lastSeenMs)
        ? (Date.now() - lastSeenMs) > (AGENT_OFFLINE_AFTER_SECONDS * 1000)
        : false;

    if (rawStatus === "dead" || stale) {
        return { state: "offline", label: "offline", dotClass: "dead" };
    }
    if (rawStatus === "sleeping") {
        return { state: "sleeping", label: "sleeping", dotClass: "sleeping" };
    }
    return { state: "responsive", label: "responsive", dotClass: "alive" };
}

function trackAgentHealthTransitions(agents) {
    const nextMap = new Map();
    (agents || []).forEach((agent) => {
        if (!agent?.agent_id) return;
        nextMap.set(agent.agent_id, getAgentHealthSnapshot(agent).state);
    });

    if (agentHealthStateInitialized) {
        nextMap.forEach((currentState, agentId) => {
            const previousState = agentHealthStateById.get(agentId);
            if (!previousState || previousState === currentState) return;

            if (currentState === "offline") {
                addConsoleLog(`[!] ${agentId} appears offline (Target stopped or rebooted )`, "error");
                return;
            }

            if (previousState === "offline" && currentState === "responsive") {
                addConsoleLog(`[+] ${agentId} is back online (shell re-established)`, "success");
                return;
            }

            if (currentState === "sleeping") {
                addConsoleLog(`[*] ${agentId} is now sleeping`, "info");
            }
        });
    }

    agentHealthStateById = nextMap;
    agentHealthStateInitialized = true;
}

function getFilteredAgents() {
    const query = (document.getElementById("agent-filter")?.value || "").toLowerCase().trim();
    return cachedAgents.filter((agent) => {
        const health = getAgentHealthSnapshot(agent);
        const domain = getAgentDomain(agent);
        const text = `${agent.agent_id || ""} ${getAgentTargetIp(agent)} ${getAgentUsername(agent)} ${getAgentMachineName(agent)} ${domain} ${agent.operating_system || ""} ${health.state}`.toLowerCase();
        const matchesSearch = !query || text.includes(query);
        const matchesChip =
            activeAgentQuickFilter === "all" ||
            (activeAgentQuickFilter === "windows" && text.includes("windows")) ||
            (activeAgentQuickFilter === "linux" && text.includes("linux")) ||
            (activeAgentQuickFilter === "alive" && health.state === "responsive") ||
            (activeAgentQuickFilter === "sleeping" && health.state === "sleeping") ||
            (activeAgentQuickFilter === "offline" && health.state === "offline");
        return matchesSearch && matchesChip;
    });
}

function toast(message, type = "info") {
    const box = document.getElementById("toast-container");
    if (!box) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

function showAgentsLoadingSkeleton() {
    const tbody = document.getElementById("agents-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    for (let i = 0; i < 6; i += 1) {
        const tr = document.createElement("tr");
        tr.className = "loading skeleton-row";
        tr.innerHTML = '<td colspan="9"><div class="skeleton-line"></div></td>';
        tbody.appendChild(tr);
    }
}

function getAgentDisplayId(agent) {
    const key = String(agent?.agent_id || "").trim();
    if (!key) return "A-0000";
    if (!agentDisplayIdMap.has(key)) {
        const id = `A-${String(nextAgentDisplayCounter).padStart(4, "0")}`;
        agentDisplayIdMap.set(key, id);
        nextAgentDisplayCounter += 1;
    }
    return agentDisplayIdMap.get(key);
}

function pickAgentValue(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (!text || text.toLowerCase() === "unknown" || text.toLowerCase() === "n/a") continue;
        return text;
    }
    return "-";
}

function getAgentTargetIp(agent) {
    const system = agent?.system_info || {};
    return pickAgentValue(
        agent?.ip_address,
        agent?.target_ip,
        agent?.external_ip,
        system?.ip_address,
        system?.ipAddress,
        system?.public_ip,
        system?.publicIp,
        system?.local_ip,
        system?.localIp
    );
}

function getAgentUsername(agent) {
    const system = agent?.system_info || {};
    return pickAgentValue(
        agent?.username,
        agent?.user,
        agent?.user_name,
        agent?.userName,
        system?.username,
        system?.user_name,
        system?.userName
    );
}

function getAgentMachineName(agent) {
    const system = agent?.system_info || {};
    return pickAgentValue(
        agent?.hostname,
        agent?.machine_name,
        agent?.machineName,
        agent?.computer_name,
        agent?.computerName,
        system?.hostname,
        system?.machine_name,
        system?.machineName,
        system?.computer_name,
        system?.computerName
    );
}

function getAgentDomain(agent) {
    const system = agent?.system_info || {};
    return pickAgentValue(
        agent?.domain,
        agent?.hostname_domain,
        agent?.domain_name,
        agent?.domainName,
        agent?.user_domain,
        agent?.userDomain,
        system?.domain,
        system?.domain_name,
        system?.domainName
    );
}

function showAuditLoadingSkeleton() {
    const tbody = document.getElementById("audit-reports-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    for (let i = 0; i < 4; i += 1) {
        const tr = document.createElement("tr");
        tr.className = "loading skeleton-row";
        tr.innerHTML = '<td colspan="5"><div class="skeleton-line"></div></td>';
        tbody.appendChild(tr);
    }
}

function executeConsoleCommand() {
    const input = document.getElementById("console-input");
    const cmd = input.value.trim();
    if (!cmd) return;
    input.value = "";
    addConsoleLog(`> ${cmd}`, "info");

    const lower = cmd.toLowerCase();
    const localHandled = handleLocalConsoleCommand(lower, cmd);
    if (localHandled) return;

    if (lower.startsWith("shell ")) {
        const shellCommand = cmd.slice(6).trim();
        runAgentShellCommand(shellCommand);
        return;
    }

    // Interactive mode: any unknown command is sent to the selected agent shell.
    // Prefix "/" to force local-only commands in the future.
    runAgentShellCommand(cmd);
}

function handleLocalConsoleCommand(lowerCommand, rawCommand) {
    if (lowerCommand === "help" || lowerCommand === "/help") {
        addConsoleLog("[*] local commands: help, agents, listeners, clear, health", "info");
        addConsoleLog("[*] remote shell: type command directly (ex: whoami, dir, ipconfig)", "info");
        addConsoleLog("[*] legacy format still works: shell <cmd>", "info");
        return true;
    }

    if (lowerCommand === "agents" || lowerCommand === "/agents") {
        addConsoleLog(`[+] sessions: ${cachedAgents.length}`, "success");
        return true;
    }

    if (lowerCommand === "listeners" || lowerCommand === "/listeners") {
        addConsoleLog(`[+] listeners: ${cachedListeners.length}`, "success");
        return true;
    }

    if (lowerCommand === "health" || lowerCommand === "/health") {
        loadDashboardStats();
        addConsoleLog("[*] health refresh requested", "info");
        return true;
    }

    if (lowerCommand === "clear" || lowerCommand === "/clear") {
        document.getElementById("console-output").innerHTML = "";
        return true;
    }

    // Keep "shell" alone as a helpful hint.
    if (lowerCommand === "shell" || rawCommand === "/shell") {
        addConsoleLog("[-] usage: type command directly (interactive) or shell <command>", "error");
        return true;
    }

    return false;
}

async function runAgentShellCommand(command) {
    if (!command) {
        addConsoleLog("[-] shell usage: shell <command>", "error");
        return;
    }
    if (!selectedListenerId) {
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    if (!selectedAgentId) {
        addConsoleLog("[-] select an agent first", "error");
        return;
    }

    addConsoleLog(`[*] queue shell command to ${selectedAgentId}`, "info");
    try {
        const queueRes = await fetch(
            `${API}/listeners/${encodeURIComponent(selectedListenerId)}/agents/${encodeURIComponent(selectedAgentId)}/shell/command`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command })
            }
        );
        const queueData = await queueRes.json();
        if (!queueRes.ok) {
            addConsoleLog(`[-] shell queue failed: ${queueData.detail || queueRes.statusText}`, "error");
            return;
        }

        const commandId = queueData.command_id;
        const shellState = await waitForShellResult(selectedListenerId, selectedAgentId, commandId, 45000, 1000);
        if (!shellState || !shellState.result) {
            if (shellState?.queued) {
                addConsoleLog("[-] command is still queued: agent is not polling shell yet (start MyAgent with --shell)", "error");
            } else {
                addConsoleLog("[-] no shell result yet (agent offline or still executing)", "error");
            }
            return;
        }

        const result = shellState.result;
        const statusPrefix = result.exit_code === 0 && !result.timed_out ? "[+]" : "[-]";
        addConsoleLog(`${statusPrefix} shell exit=${result.exit_code} timeout=${Boolean(result.timed_out)}`, result.exit_code === 0 ? "success" : "error");
        if (result.stdout) addConsoleLog(result.stdout, "info");
        if (result.stderr) addConsoleLog(result.stderr, "error");
    } catch (error) {
        addConsoleLog(`[-] shell command error: ${error.message}`, "error");
    }
}

async function waitForShellResult(listenerId, agentId, commandId, timeoutMs = 30000, pollMs = 1000) {
    const start = Date.now();
    let sawQueuedOnly = false;
    while (Date.now() - start < timeoutMs) {
        const historyRes = await fetch(
            `${API}/listeners/${encodeURIComponent(listenerId)}/agents/${encodeURIComponent(agentId)}/shell/history?limit=80`
        );
        const historyData = await historyRes.json();
        if (historyRes.ok && Array.isArray(historyData.history)) {
            const result = historyData.history.find((entry) => entry.command_id === commandId && entry.status === "completed");
            if (result) {
                return { result, queued: sawQueuedOnly };
            }

            const queued = historyData.history.find((entry) => entry.command_id === commandId && entry.status === "queued");
            if (queued) {
                sawQueuedOnly = true;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return { result: null, queued: sawQueuedOnly };
}

async function loadAgents() {
    const token = getAuthToken();
    if (!token) {
        console.log("[*] Non authentifié - loadAgents ignoré");
        return;
    }
    
    try {
        showAgentsLoadingSkeleton();
        const res = await fetch(`${API}/agents/`);
        const agents = await res.json();
        cachedAgents = Array.isArray(agents) ? agents : [];

        const tbody = document.getElementById("agents-tbody");
        tbody.innerHTML = "";
        if (!cachedAgents.length) {
            tbody.innerHTML = '<tr class="loading"><td colspan="9">No simulated agents</td></tr>';
            renderSessionsGraph();
            return;
        }

        cachedAgents.forEach((agent) => {
            const tr = document.createElement("tr");
            tr.className = "agent-row";
            tr.dataset.agentId = agent.agent_id || "";
            if (selectedAgentId && agent.agent_id === selectedAgentId) {
                tr.classList.add("selected");
            }
            tr.addEventListener("click", () => {
                selectedAgentId = agent.agent_id;
                renderAgentsSelection();
                showAgentDetails(agent.agent_id);
            });
            const health = getAgentHealthSnapshot(agent);
            const osText = (agent.operating_system || "unknown").toString();
            const osLower = osText.toLowerCase();
            const osClass = osLower.includes("win") ? "os-windows" : (osLower.includes("linux") ? "os-linux" : "os-other");
            const healthText = health.label;
            const healthStateClass = health.state === "offline" ? "offline" : health.state;
            const displayId = getAgentDisplayId(agent);
            const targetIp = getAgentTargetIp(agent);
            const username = getAgentUsername(agent);
            const machineName = getAgentMachineName(agent);
            const domain = getAgentDomain(agent);
            tr.innerHTML = `
                <td>${displayId}</td>
                <td>${targetIp}</td>
                <td>${username}</td>
                <td>${machineName}</td>
                <td>${domain}</td>
                <td><span class="agent-badge ${osClass}">${osText}</span></td>
                <td>${agent.process_id ?? "-"}</td>
                <td>${formatTimeAgo(agent.last_seen)}</td>
                <td>
                    <span class="status-cell ${health.dotClass}"></span>
                    <span class="agent-health-badge ${healthStateClass}">${healthText}</span>
                </td>
            `;
            tbody.appendChild(tr);
        });
        trackAgentHealthTransitions(cachedAgents);
        filterAgentsTable();
    } catch (e) {
        addConsoleLog(`[-] agents fetch failed: ${e.message}`, "error");
        renderSessionsGraph();
    }
}

function renderAgentsSelection() {
    document.querySelectorAll(".agent-row").forEach((row) => {
        const rowAgentId = row.dataset.agentId || "";
        row.classList.toggle("selected", selectedAgentId && rowAgentId === selectedAgentId);
    });
}

function filterAgentsTable() {
    const filteredIds = new Set(getFilteredAgents().map((agent) => agent.agent_id));
    document.querySelectorAll(".agent-row").forEach((row) => {
        const rowAgentId = row.dataset.agentId || "";
        const isVisible = rowAgentId && filteredIds.has(rowAgentId);
        row.style.display = isVisible ? "" : "none";
    });
    renderSessionsGraph();
}

function formatTimeAgo(ts) {
    const t = new Date(ts || Date.now());
    const sec = Math.floor((Date.now() - t.getTime()) / 1000);
    if (Number.isNaN(sec)) return "-";
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
}

function formatDateTime(ts) {
    if (!ts) return "-";
    const value = new Date(ts);
    if (Number.isNaN(value.getTime())) return String(ts);
    return value.toLocaleString("en-US", { hour12: false });
}

function getStoredSelectedListenerId() {
    try {
        return localStorage.getItem(SELECTED_LISTENER_KEY) || null;
    } catch (e) {
        return null;
    }
}

function storeSelectedListenerId(listenerId) {
    try {
        if (listenerId) localStorage.setItem(SELECTED_LISTENER_KEY, listenerId);
        else localStorage.removeItem(SELECTED_LISTENER_KEY);
    } catch (e) {
        // ignore storage failures
    }
}

function getListenerPriority(listener) {
    const stats = listener?.stats || {};
    const agentsConnected = Number(listener?.agents_connected ?? stats.agents_connected ?? 0) || 0;
    const heartbeats = Number(stats.heartbeats_received ?? 0) || 0;
    const events = Number(stats.events_recorded ?? 0) || 0;
    const hasActivity = Boolean(stats.last_activity) || agentsConnected > 0 || heartbeats > 0 || events > 0;
    const activityTime = Date.parse(stats.last_activity || listener?.last_modified || listener?.created_at || "") || 0;

    return [hasActivity ? 1 : 0, activityTime, heartbeats, events, agentsConnected];
}

function pickPreferredListenerId(listeners) {
    if (!Array.isArray(listeners) || !listeners.length) return null;

    const storedId = getStoredSelectedListenerId();
    if (storedId && listeners.some((listener) => listener.listener_id === storedId)) {
        return storedId;
    }

    const sorted = [...listeners].sort((left, right) => {
        const leftPriority = getListenerPriority(left);
        const rightPriority = getListenerPriority(right);

        for (let index = 0; index < leftPriority.length; index += 1) {
            if (leftPriority[index] !== rightPriority[index]) {
                return rightPriority[index] - leftPriority[index];
            }
        }

        return String(left?.name || left?.listener_id || "").localeCompare(String(right?.name || right?.listener_id || ""));
    });

    return sorted[0]?.listener_id || null;
}

async function loadListeners() {
    const token = getAuthToken();
    if (!token) {
        console.log("[*] Non authentifié - loadListeners ignoré");
        return;
    }
    
    try {
        const res = await fetch(`${API}/listeners/`);
        const listeners = await res.json();
        cachedListeners = Array.isArray(listeners) ? listeners : [];
        populatePayloadListenerSelect(selectedListenerId);
        renderSessionsGraph();
    } catch (e) {
        addConsoleLog(`[-] listeners fetch failed: ${e.message}`, "error");
        renderSessionsGraph();
    }
}

async function loadAuditReports(options = {}) {
    const { silent = false } = options;

    if (!selectedListenerId) {
        cachedAuditReports = [];
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
        renderAuditReports();
        return;
    }

    const listenerId = selectedListenerId;
    try {
        showAuditLoadingSkeleton();
        const res = await fetch(`${API}/listeners/${encodeURIComponent(listenerId)}/audit-reports`);
        const data = await res.json();

        if (listenerId !== selectedListenerId) {
            return;
        }

        if (!res.ok) {
            cachedAuditReports = [];
            selectedAuditReportId = null;
            selectedAuditReportDetail = null;
            renderAuditReports(data.detail || "Failed to load audit reports.");
            if (!silent) addConsoleLog(`[-] audit reports failed: ${data.detail || res.statusText}`, "error");
            return;
        }

        cachedAuditReports = Array.isArray(data.reports) ? data.reports : [];
        if (selectedAuditReportId && !cachedAuditReports.some((report) => report.report_id === selectedAuditReportId)) {
            selectedAuditReportId = null;
            selectedAuditReportDetail = null;
        }
        if (!selectedAuditReportId && cachedAuditReports[0]?.report_id) {
            selectedAuditReportId = cachedAuditReports[0].report_id;
        }

        renderAuditReports();
        if (!silent) toast("Audit report list loaded", "info");

        if (selectedAuditReportId) {
            await loadAuditReportDetail(selectedAuditReportId, { silent: true });
        } else {
            renderAuditPreview();
        }
    } catch (e) {
        if (listenerId !== selectedListenerId) {
            return;
        }
        cachedAuditReports = [];
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
        renderAuditReports("Unable to load audit reports.");
        if (!silent) addConsoleLog(`[-] audit reports fetch failed: ${e.message}`, "error");
    }
}

async function loadAuditReportDetail(reportId, options = {}) {
    const { silent = false } = options;
    if (!selectedListenerId || !reportId) {
        selectedAuditReportDetail = null;
        renderAuditPreview();
        return;
    }

    const listenerId = selectedListenerId;
    const hasSelectedDetail =
        selectedAuditReportDetail &&
        selectedAuditReportDetail.report_id === reportId &&
        selectedListenerId === listenerId;

    if (!silent || !hasSelectedDetail) {
        selectedAuditReportDetail = null;
        renderAuditPreview();
    }

    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(listenerId)}/audit-reports/${encodeURIComponent(reportId)}`);
        const data = await res.json();

        if (listenerId !== selectedListenerId || reportId !== selectedAuditReportId) {
            return;
        }

        if (!res.ok) {
            selectedAuditReportDetail = null;
            renderAuditPreview(data.detail || "Failed to load report details.");
            if (!silent) addConsoleLog(`[-] audit report detail failed: ${data.detail || res.statusText}`, "error");
            return;
        }

        selectedAuditReportDetail = data;
        renderAuditPreview();
        if (!silent) toast("Audit report loaded", "info");
    } catch (e) {
        if (listenerId !== selectedListenerId || reportId !== selectedAuditReportId) {
            return;
        }
        selectedAuditReportDetail = null;
        renderAuditPreview("Unable to load report details.");
        if (!silent) addConsoleLog(`[-] audit report detail error: ${e.message}`, "error");
    }
}

function renderAuditReports(emptyMessage = "") {
    const titleEl = document.getElementById("audit-panel-title");
    const tbody = document.getElementById("audit-reports-tbody");
    if (!titleEl || !tbody) return;

    const selectedListener = cachedListeners.find((listener) => listener.listener_id === selectedListenerId);
    if (!selectedListenerId || !selectedListener) {
        titleEl.textContent = "Audit Reports";
        tbody.innerHTML = `
            <tr class="loading">
                <td colspan="5">
                    No listener selected.
                    <button id="audit-go-listeners-btn" class="inline-audit-btn" type="button">Go to Listener tab</button>
                </td>
            </tr>
        `;
        const goBtn = document.getElementById("audit-go-listeners-btn");
        if (goBtn) {
            goBtn.addEventListener("click", () => switchBottomTab("listeners"));
        }
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
        renderAuditPreview("No audit report selected.");
        syncAuditButtons();
        return;
    }

    const filteredReports = cachedAuditReports
        .filter((report) => activeAuditRiskFilter === "all" || String(report.risk_level || "").toLowerCase() === activeAuditRiskFilter)
        .sort((left, right) => (Date.parse(right.created_at || "") || 0) - (Date.parse(left.created_at || "") || 0));

    titleEl.textContent = `Audit Reports: ${selectedListener.name || selectedListener.listener_id} [${selectedListener.listener_id}] (${filteredReports.length})`;
    tbody.innerHTML = "";

    if (!filteredReports.length) {
        const baseMessage = cachedAuditReports.length
            ? `No reports yet for the selected risk filter (${activeAuditRiskFilter.toUpperCase()}).`
            : "No reports yet for this listener.";
        const message = emptyMessage || baseMessage;
        tbody.innerHTML = `<tr class="loading"><td colspan="5">${message}</td></tr>`;
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
        renderAuditPreview(`No reports yet for ${selectedListener.name || selectedListener.listener_id} [${selectedListener.listener_id}].`);
        syncAuditButtons();
        return;
    }

    if (selectedAuditReportId && !filteredReports.some((report) => report.report_id === selectedAuditReportId)) {
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
    }
    if (!selectedAuditReportId && filteredReports[0]?.report_id) {
        selectedAuditReportId = filteredReports[0].report_id;
    }

    filteredReports.forEach((report) => {
        const tr = document.createElement("tr");
        tr.className = report.report_id === selectedAuditReportId ? "selected" : "";
        tr.addEventListener("click", async () => {
            selectedAuditReportId = report.report_id;
            renderAuditReports();
            await loadAuditReportDetail(report.report_id, { silent: true });
        });

        const risk = String(report.risk_level || "UNKNOWN").toLowerCase();
        tr.innerHTML = `
            <td title="${report.machine_name ?? "-"}">${report.machine_name ?? "-"}</td>
            <td><span class="audit-risk ${risk}">${(report.risk_level ?? "UNKNOWN").toString()}</span></td>
            <td>${report.finding_count ?? 0}</td>
            <td title="${report.created_at ?? "-"}">${formatDateTime(report.created_at)}</td>
            <td title="${report.report_id ?? "-"}">${report.report_id ?? "-"}</td>
        `;
        tbody.appendChild(tr);
    });

    syncAuditButtons();
}

function renderAuditPreview(message = "") {
    const metaEl = document.getElementById("audit-preview-meta");
    const jsonEl = document.getElementById("audit-preview-json");
    if (!metaEl || !jsonEl) return;

    const selectedListener = cachedListeners.find((listener) => listener.listener_id === selectedListenerId);
    if (!selectedListenerId || !selectedListener) {
        metaEl.textContent = message || "Select a listener to inspect audit reports.";
        jsonEl.value = "";
        syncAuditButtons();
        return;
    }

    if (!selectedAuditReportId) {
        metaEl.textContent = message || `Select an audit report for ${selectedListener.name || selectedListener.listener_id} [${selectedListener.listener_id}].`;
        jsonEl.value = "";
        syncAuditButtons();
        return;
    }

    if (!selectedAuditReportDetail || selectedAuditReportDetail.report_id !== selectedAuditReportId) {
        metaEl.textContent = message || `Loading audit report ${selectedAuditReportId}...`;
        jsonEl.value = "";
        syncAuditButtons();
        return;
    }

    const report = selectedAuditReportDetail;
    metaEl.textContent = [
        `Listener : ${selectedListener.name || selectedListener.listener_id}`,
        `Listener ID : ${selectedListener.listener_id || "-"}`,
        `Report ID : ${report.report_id ?? "-"}`,
        `Host : ${report.machine_name ?? "-"}`,
        `User : ${report.username ?? "-"}`,
        `Risk : ${report.risk_level ?? "UNKNOWN"}`,
        `Findings : ${report.finding_count ?? 0}`,
        `Stored : ${formatDateTime(report.created_at)}`,
        `File : ${report.filename ?? "-"}`,
    ].join("\n");
    jsonEl.value = report.report_json || "";
    syncAuditButtons();
}

function syncAuditButtons() {
    const refreshBtn = document.getElementById("audit-refresh-btn");
    const downloadBtn = document.getElementById("audit-download-btn");
    const copyBtn = document.getElementById("audit-copy-btn");
    const riskFilter = document.getElementById("audit-risk-filter");
    const hasListener = Boolean(selectedListenerId);
    const hasReport = Boolean(selectedAuditReportDetail?.report_json);
    if (refreshBtn) {
        refreshBtn.disabled = !hasListener;
        refreshBtn.title = hasListener ? "Refresh reports for selected listener" : "Select a listener first";
    }
    if (downloadBtn) {
        downloadBtn.disabled = !hasReport;
        downloadBtn.title = hasReport ? "Download selected JSON report" : "Select an audit report first";
    }
    if (copyBtn) {
        copyBtn.disabled = !hasReport;
        copyBtn.title = hasReport ? "Copy selected JSON report" : "Select an audit report first";
    }
    if (riskFilter) {
        riskFilter.disabled = !hasListener;
        riskFilter.title = hasListener ? "Filter reports by risk level" : "Select a listener first";
    }
}

function getSelectedAuditReportFilename() {
    const fallbackReportId = selectedAuditReportDetail?.report_id || selectedAuditReportId || "audit-report";
    const rawName = String(selectedAuditReportDetail?.filename || fallbackReportId).trim();
    if (!rawName) return "audit-report.json";
    return rawName.toLowerCase().endsWith(".json") ? rawName : `${rawName}.json`;
}

function downloadBlobFile(content, filename, contentType = "application/json;charset=utf-8") {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadSelectedAuditReportJson() {
    if (!selectedAuditReportDetail?.report_json) {
        addConsoleLog("[-] select an audit report first", "error");
        return;
    }

    try {
        downloadBlobFile(selectedAuditReportDetail.report_json, getSelectedAuditReportFilename());
        toast("Audit report downloaded", "success");
    } catch (e) {
        addConsoleLog(`[-] download audit JSON failed: ${e.message}`, "error");
    }
}

async function copySelectedAuditReportJson() {
    if (!selectedAuditReportDetail?.report_json) {
        addConsoleLog("[-] select an audit report first", "error");
        return;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(selectedAuditReportDetail.report_json);
            toast("Audit report JSON copied", "success");
            return;
        }

        addConsoleLog("[-] clipboard API unavailable", "error");
    } catch (e) {
        addConsoleLog(`[-] copy audit JSON failed: ${e.message}`, "error");
    }
}

async function loadListenerProfiles() {
    const token = getAuthToken();
    if (!token) {
        console.log("[*] Non authentifié - loadListenerProfiles ignoré");
        return;
    }
    
    try {
        const res = await fetch(`${API}/listeners/profiles/list`);
        const profiles = await res.json();
        cachedListenerProfiles = Array.isArray(profiles) ? profiles : [];
    } catch (e) {
        // keep silent; older API might not have profiles
        cachedListenerProfiles = [];
    }
}

function renderListenersTable() {
    const tbody = document.getElementById("listeners-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!cachedListeners.length) {
        tbody.innerHTML = '<tr class="loading"><td colspan="7">No listeners</td></tr>';
        selectedListenerId = null;
        storeSelectedListenerId(null);
        syncListenerButtons();
        return;
    }

    if (selectedListenerId && !cachedListeners.some((listener) => listener.listener_id === selectedListenerId)) {
        selectedListenerId = null;
        storeSelectedListenerId(null);
    }

    if (!selectedListenerId) {
        selectedListenerId = pickPreferredListenerId(cachedListeners);
        storeSelectedListenerId(selectedListenerId);
    }

    cachedListeners.forEach((l) => {
        const tr = document.createElement("tr");
        tr.className = (l.listener_id && l.listener_id === selectedListenerId) ? "selected" : "";
        tr.addEventListener("click", async () => {
            selectedListenerId = l.listener_id || null;
            storeSelectedListenerId(selectedListenerId);
            selectedAuditReportId = null;
            selectedAuditReportDetail = null;
            renderListenersTable();
            await loadAuditReports({ silent: true });
        });
        const status = (l.status || (l.enabled ? "online" : "offline")).toString().toLowerCase();
        tr.innerHTML = `
            <td>${l.name ?? "-"}</td>
            <td>${l.protocol ?? "-"}</td>
            <td>${l.host ?? "-"}</td>
            <td>${l.port ?? "-"}</td>
            <td>${l.profile ?? "-"}</td>
            <td>${status}</td>
            <td title="${l.listener_id ?? "-"}">${l.listener_id ?? "-"}</td>
        `;
        tbody.appendChild(tr);
    });

    syncListenerButtons();
}

function syncListenerButtons() {
    const removeBtn = document.getElementById("listener-remove-btn");
    const editBtn = document.getElementById("listener-edit-btn");
    const startBtn = document.getElementById("listener-start-btn");
    const stopBtn = document.getElementById("listener-stop-btn");
    const statsBtn = document.getElementById("listener-stats-btn");
    const exportBtn = document.getElementById("listener-export-btn");
    if (!removeBtn || !editBtn || !startBtn || !stopBtn || !statsBtn || !exportBtn) return;
    const enabled = Boolean(selectedListenerId);
    removeBtn.disabled = !enabled;
    editBtn.disabled = !enabled;
    startBtn.disabled = !enabled;
    stopBtn.disabled = !enabled;
    statsBtn.disabled = !enabled;
    exportBtn.disabled = !enabled;
    const disabledTitle = "Select a listener first";
    const activeTitle = "Action available for selected listener";
    removeBtn.title = enabled ? activeTitle : disabledTitle;
    editBtn.title = enabled ? activeTitle : disabledTitle;
    startBtn.title = enabled ? activeTitle : disabledTitle;
    stopBtn.title = enabled ? activeTitle : disabledTitle;
    statsBtn.title = enabled ? activeTitle : disabledTitle;
    exportBtn.title = enabled ? activeTitle : disabledTitle;
    syncAuditButtons();
    renderSessionsGraph();
}

function switchSessionsView(view) {
    activeSessionsView = view === "graph" ? "graph" : "table";
    const tableView = document.getElementById("sessions-table-view");
    const graphView = document.getElementById("sessions-graph-view");
    const tabTable = document.getElementById("sessions-tab-table");
    const tabGraph = document.getElementById("sessions-tab-graph");
    if (tableView) tableView.classList.toggle("active", activeSessionsView === "table");
    if (graphView) graphView.classList.toggle("active", activeSessionsView === "graph");
    if (tabTable) tabTable.classList.toggle("active", activeSessionsView === "table");
    if (tabGraph) tabGraph.classList.toggle("active", activeSessionsView === "graph");
    if (activeSessionsView === "graph") {
        ensureSessionsGraphCanvasSize();
        renderSessionsGraph();
    }
}

function initSessionsGraph() {
    const canvas = document.getElementById("sessions-graph-canvas");
    const wrap = document.getElementById("sessions-graph-canvas-wrap");
    if (!canvas || !wrap) return;

    sessionsGraphState = {
        canvas,
        wrap,
        dpr: Math.max(1, window.devicePixelRatio || 1),
        panX: 0,
        panY: 0,
        scale: 1,
        nodes: [],
        edges: [],
        isDraggingNode: false,
        dragNodeId: null,
        dragOffsetX: 0,
        dragOffsetY: 0,
        nodePositionOverrides: new Map(),
        hasInitialFit: false,
    };
    sessionsGraphAssets = createSessionsGraphAssets();

    const onResize = () => {
        const changed = ensureSessionsGraphCanvasSize();
        if (changed) {
            renderSessionsGraph();
            fitSessionsGraphToView();
        }
    };

    canvas.addEventListener("mousedown", (event) => {
        if (!sessionsGraphState) return;
        const hit = getDraggableNodeAtCanvasPoint(event);
        if (!hit) return;
        sessionsGraphState.isDraggingNode = true;
        sessionsGraphState.dragNodeId = hit.id;
        sessionsGraphState.dragOffsetX = hit.offsetX;
        sessionsGraphState.dragOffsetY = hit.offsetY;
        canvas.classList.add("dragging");
    });

    window.addEventListener("mouseup", () => {
        if (!sessionsGraphState) return;
        sessionsGraphState.isDraggingNode = false;
        sessionsGraphState.dragNodeId = null;
        canvas.classList.remove("dragging");
    });

    window.addEventListener("mousemove", (event) => {
        if (!sessionsGraphState) return;
        if (sessionsGraphState.isDraggingNode && sessionsGraphState.dragNodeId) {
            const point = getCanvasPoint(event);
            if (!point) return;
            const x = point.x - sessionsGraphState.dragOffsetX;
            const y = point.y - sessionsGraphState.dragOffsetY;
            sessionsGraphState.nodePositionOverrides.set(sessionsGraphState.dragNodeId, { x, y });
            renderSessionsGraph();
            return;
        }
        const hit = getDraggableNodeAtCanvasPoint(event);
        canvas.style.cursor = hit ? "grab" : "default";
    });

    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(() => onResize());
    observer.observe(wrap);
    onResize();
}

function ensureSessionsGraphCanvasSize() {
    if (!sessionsGraphState) return false;
    const { canvas, wrap, dpr } = sessionsGraphState;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
    const targetHeight = Math.max(1, Math.floor(rect.height * dpr));
    const changed = canvas.width !== targetWidth || canvas.height !== targetHeight;
    if (changed) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }
    return changed;
}

function resetSessionsGraphView() {
    if (!sessionsGraphState) return;
    sessionsGraphState.nodePositionOverrides.clear();
    sessionsGraphState.scale = 1;
    renderSessionsGraph();
}

function fitSessionsGraphToView() {
    if (!sessionsGraphState) return;
    sessionsGraphState.scale = 1;
    renderSessionsGraph();
}

function buildSessionsGraphModel() {
    const filteredAgents = getFilteredAgents();
    const selectedListener = cachedListeners.find((listener) => listener.listener_id === selectedListenerId) || null;
    const listenerLabel = selectedListener?.name || selectedListener?.listener_id || "Control Server";
    const nodes = [{
        id: "listener-node",
        kind: "listener",
        label: listenerLabel,
        sublabel: selectedListener?.listener_id ? `[${selectedListener.listener_id}]` : "No listener selected",
        x: 110,
        y: 42,
        radius: 28,
    }];
    const edges = [];

    if (!filteredAgents.length) return { nodes, edges };

    const listener = nodes[0];
    const baseX = Math.max(380, (sessionsGraphState?.wrap?.clientWidth || 900) * 0.62);
    const topRowY = listener.y;
    const radiusX = Math.max(150, Math.min(280, filteredAgents.length * 34));
    filteredAgents.forEach((agent, index) => {
        const angle = filteredAgents.length === 1
            ? 0
            : (-Math.PI / 2) + (index * (Math.PI / Math.max(1, filteredAgents.length - 1)));
        const health = getAgentHealthSnapshot(agent);
        const nodeId = `agent-${agent.agent_id || index}`;
        const defaultX = baseX + Math.cos(angle) * radiusX;
        const defaultY = topRowY;
        const override = sessionsGraphState?.nodePositionOverrides?.get(nodeId);
        nodes.push({
            id: nodeId,
            kind: "agent",
            health: health.state,
            os: String(agent.operating_system || "").toLowerCase(),
            label: agent.hostname || agent.username || (agent.agent_id || "agent").slice(0, 8),
            sublabel: `${agent.username || "user"} @ ${agent.operating_system || "unknown"} | ${(agent.agent_id || "").slice(0, 8)}`,
            x: override?.x ?? defaultX,
            y: override?.y ?? defaultY,
            radius: 26,
            draggable: String(agent.operating_system || "").toLowerCase().includes("win"),
        });
        edges.push({
            source: listener.id,
            target: nodeId,
            label: health.state === "sleeping" ? "sleeping session" : "session",
            user: agent.username || "unknown",
            type: health.state,
        });
    });

    return { nodes, edges };
}

function renderSessionsGraph() {
    if (!sessionsGraphState || activeSessionsView !== "graph") return;
    ensureSessionsGraphCanvasSize();
    const { canvas, dpr } = sessionsGraphState;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const model = buildSessionsGraphModel();
    sessionsGraphState.nodes = model.nodes;
    sessionsGraphState.edges = model.edges;
    if (!sessionsGraphState.hasInitialFit && model.nodes.length) {
        sessionsGraphState.hasInitialFit = true;
        fitSessionsGraphToView();
        return;
    }

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawGraphBackdrop(ctx, width, height);
    drawGraphEdges(ctx, model.nodes, model.edges);
    drawGraphNodes(ctx, model.nodes);
    if (model.nodes.length <= 1) {
        ctx.fillStyle = "#9db2d3";
        ctx.font = "12px Segoe UI";
        ctx.textAlign = "left";
        ctx.fillText("No active agent sessions to display.", 12, height - 14);
    }
}

function getCanvasPoint(event) {
    if (!sessionsGraphState?.canvas) return null;
    const rect = sessionsGraphState.canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
}

function getDraggableNodeAtCanvasPoint(event) {
    if (!sessionsGraphState) return null;
    const point = getCanvasPoint(event);
    if (!point) return null;
    for (let i = sessionsGraphState.nodes.length - 1; i >= 0; i -= 1) {
        const node = sessionsGraphState.nodes[i];
        if (!node?.draggable) continue;
        const width = 62;
        const height = 48;
        const left = node.x - width / 2;
        const top = node.y - height / 2;
        const inside = point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
        if (inside) {
            return { id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y };
        }
    }
    return null;
}

function drawGraphBackdrop(ctx, width, height) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(35, 74, 128, 0.22)";
    ctx.lineWidth = 1;
    const gap = 28;
    for (let x = 0; x <= width; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y <= height; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

function drawGraphEdges(ctx, nodes, edges) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;

        const lineColor = edge.type === "offline" ? "#f87171" : (edge.type === "sleeping" ? "#fbbf24" : "#3ae85b");
        ctx.strokeStyle = lineColor;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.fillStyle = "#7ffc81";
        ctx.font = "11px Consolas";
        ctx.textAlign = "center";
        ctx.fillText(edge.user || edge.label, mx, my - 6);
    });
}

function drawGraphNodes(ctx, nodes) {
    nodes.forEach((node) => {
        if (node.kind === "listener") {
            drawIconCardNode(ctx, node, sessionsGraphAssets?.listenerIcon, {
                border: "#ff8d4f",
                glow: "rgba(255, 141, 79, 0.25)",
                fill: "rgba(71, 34, 17, 0.92)",
            });
            return;
        }
        const border = node.health === "offline" ? "#f87171" : (node.health === "sleeping" ? "#fbbf24" : "#54a8ff");
        const glow = node.health === "offline" ? "rgba(248,113,113,0.23)" : (node.health === "sleeping" ? "rgba(251,191,36,0.22)" : "rgba(84,168,255,0.22)");
        const icon = node.os.includes("win")
            ? sessionsGraphAssets?.windowsIcon
            : (node.os.includes("linux") ? sessionsGraphAssets?.linuxIcon : sessionsGraphAssets?.hostIcon);
        drawIconCardNode(ctx, node, icon, {
            border,
            glow,
            fill: "rgba(29, 38, 58, 0.95)",
        });
    });
}

function drawIconCardNode(ctx, node, icon, palette) {
    const cardWidth = node.kind === "listener" ? 58 : 62;
    const cardHeight = node.kind === "listener" ? 44 : 48;
    const x = node.x - cardWidth / 2;
    const y = node.y - cardHeight / 2;

    ctx.save();
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = palette.fill;
    roundRectPath(ctx, x, y, cardWidth, cardHeight, 10);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, cardWidth, cardHeight, 10);
    ctx.stroke();

    if (icon?.complete) {
        const iconSize = node.kind === "listener" ? 22 : 24;
        ctx.drawImage(icon, node.x - (iconSize / 2), node.y - (iconSize / 2), iconSize, iconSize);
    }

    ctx.fillStyle = "#edf4ff";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(node.label || "-", node.x, y + cardHeight + 14);
    if (node.sublabel) {
        ctx.fillStyle = "#95a4bf";
        ctx.font = "10px Consolas";
        ctx.fillText(node.sublabel, node.x, y + cardHeight + 28);
    }
}

function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function createSessionsGraphAssets() {
    const makeSvgImage = (svg) => {
        const img = new Image();
        img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        return img;
    };

    const listenerIcon = makeSvgImage(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect x="6" y="6" width="52" height="52" rx="12" fill="#131722" stroke="#c556ff" stroke-width="2"/>
            <path d="M13 30 C18 16 27 10 32 10 C37 10 46 16 51 30 L44 30 C41 22 36 18 32 18 C28 18 23 22 20 30 Z" fill="#8b3dff"/>
            <path d="M18 31 C18 25 24 20 32 20 C40 20 46 25 46 31 L46 41 C46 46 40 50 32 50 C24 50 18 46 18 41 Z" fill="#1f2634"/>
            <ellipse cx="27" cy="34" rx="2.2" ry="2.6" fill="#7bf7ff"/>
            <ellipse cx="37" cy="34" rx="2.2" ry="2.6" fill="#7bf7ff"/>
            <path d="M26 41 C28 43 36 43 38 41" stroke="#d7e0ff" stroke-width="2" stroke-linecap="round" fill="none"/>
            <path d="M22 30 C24 35 28 37 32 37 C36 37 40 35 42 30" stroke="#b26dff" stroke-width="2" fill="none"/>
            <circle cx="49" cy="15" r="3" fill="#ff4d8d"/>
        </svg>
    `);

    const windowsIcon = makeSvgImage(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect x="10" y="10" width="44" height="44" rx="6" fill="#1f2e4a" stroke="#66b2ff" stroke-width="2"/>
            <path d="M17 20 L30 18 L30 31 L17 31 Z" fill="#6fc3ff"/>
            <path d="M34 17 L47 15 L47 31 L34 31 Z" fill="#90d4ff"/>
            <path d="M17 34 L30 34 L30 47 L17 45 Z" fill="#53b7ff"/>
            <path d="M34 34 L47 34 L47 49 L34 47 Z" fill="#7ac8ff"/>
        </svg>
    `);

    const linuxIcon = makeSvgImage(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect x="10" y="10" width="44" height="44" rx="6" fill="#162335" stroke="#81e6a3" stroke-width="2"/>
            <ellipse cx="32" cy="22" rx="9" ry="10" fill="#111"/>
            <ellipse cx="32" cy="36" rx="13" ry="14" fill="#111"/>
            <ellipse cx="28" cy="21" rx="1.8" ry="2.4" fill="#fff"/>
            <ellipse cx="36" cy="21" rx="1.8" ry="2.4" fill="#fff"/>
            <polygon points="32,26 29,29 35,29" fill="#f5d76e"/>
        </svg>
    `);

    const hostIcon = makeSvgImage(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <rect x="10" y="14" width="44" height="30" rx="4" fill="#253753" stroke="#9eb8dd" stroke-width="2"/>
            <rect x="18" y="48" width="28" height="4" rx="2" fill="#7f94b5"/>
            <circle cx="18" cy="28" r="2" fill="#7fffb2"/>
            <circle cx="24" cy="28" r="2" fill="#7fffb2"/>
            <circle cx="30" cy="28" r="2" fill="#7fffb2"/>
        </svg>
    `);

    return { listenerIcon, windowsIcon, linuxIcon, hostIcon };
}

function openListenerModal(mode = "create") {
    const title = document.getElementById("listener-modal-title");
    const idField = document.getElementById("listener-id");
    const nameEl = document.getElementById("listener-name");
    const protocolEl = document.getElementById("listener-protocol");
    const hostEl = document.getElementById("listener-host");
    const portEl = document.getElementById("listener-port");
    const intervalEl = document.getElementById("listener-interval");
    const uaEl = document.getElementById("listener-ua");
    const configJsonEl = document.getElementById("listener-config-json");
    const modal = document.getElementById("listener-modal");

    if (!title || !idField || !nameEl || !protocolEl || !hostEl || !portEl || !intervalEl || !uaEl || !configJsonEl || !modal) {
        addConsoleLog("[-] listener modal elements missing (hard refresh Ctrl+F5)", "error");
        return;
    }

    if (mode === "edit") {
        const l = cachedListeners.find(x => x.listener_id === selectedListenerId);
        if (!l) {
            addConsoleLog("[-] select a listener first", "error");
            return;
        }
        title.textContent = "Edit Listener";
        idField.value = l.listener_id || "";
        nameEl.value = l.name || "";
        protocolEl.value = (l.protocol || "https").toLowerCase();
        hostEl.value = l.host || "0.0.0.0";
        portEl.value = String(l.port ?? 443);
        intervalEl.value = String(l.beacon_interval ?? 5);
        uaEl.value = l.user_agent || "";
        configJsonEl.value = l.config ? JSON.stringify(l.config, null, 2) : "";
    } else {
        title.textContent = "Create Listener";
        idField.value = "";
        nameEl.value = "";
        protocolEl.value = "https";
        hostEl.value = "127.0.0.1";
        portEl.value = "443";
        intervalEl.value = "5";
        uaEl.value = "LabSimulator/1.0";
        configJsonEl.value = "";
    }

    modal.classList.add("active");
}

function closeListenerModal() {
    document.getElementById("listener-modal").classList.remove("active");
}

// ==========================================
// Payload Builder (safe JSON-only)
// ==========================================
function formatPayloadListenerOption(listener) {
    const name = String(listener?.name || "").trim();
    const listenerId = String(listener?.listener_id || "").trim();
    if (name && listenerId && name !== listenerId) {
        return `${name} (${listenerId})`;
    }
    return name || listenerId || "Unnamed listener";
}

function populatePayloadListenerSelect(preferredListenerId = selectedListenerId) {
    const targetListenerEl = document.getElementById("payload-target-listener");
    if (!targetListenerEl) return;

    const currentValue = targetListenerEl.value;
    const nextValue = preferredListenerId || currentValue || "";
    targetListenerEl.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = cachedListeners.length ? "Select a listener" : "No listeners available";
    targetListenerEl.appendChild(placeholder);

    cachedListeners.forEach((listener) => {
        if (!listener?.listener_id) return;
        const option = document.createElement("option");
        option.value = listener.listener_id;
        option.textContent = formatPayloadListenerOption(listener);
        targetListenerEl.appendChild(option);
    });

    const hasMatch = nextValue && cachedListeners.some((listener) => listener.listener_id === nextValue);
    targetListenerEl.value = hasMatch ? nextValue : "";
    targetListenerEl.disabled = cachedListeners.length === 0;
}

function syncPayloadServerIpFromSelectedListener(options = {}) {
    const { force = false } = options;
    const targetListenerEl = document.getElementById("payload-target-listener");
    const serverIpEl = document.getElementById("payload-server-ip");
    const listenerIdEl = document.getElementById("payload-listener-id");
    const previewEl = document.getElementById("payload-preview-json");
    
    if (!targetListenerEl || !serverIpEl || !listenerIdEl) return;

    const selectedListener = cachedListeners.find((listener) => listener.listener_id === targetListenerEl.value);
    const fallbackHost = (window.location.hostname || "127.0.0.1").trim() || "127.0.0.1";
    const nextIp = String(selectedListener?.host || fallbackHost).trim() || "127.0.0.1";
    const nextListenerId = String(selectedListener?.listener_id || "").trim();

    if (force || !serverIpEl.value.trim()) {
        serverIpEl.value = nextIp;
    }
    
    if (force || !listenerIdEl.value.trim()) {
        listenerIdEl.value = nextListenerId;
    }

    // Mettre à jour le preview
    if (previewEl && serverIpEl.value && listenerIdEl.value) {
        const preview = {
            server_ip: serverIpEl.value,
            listener_id: listenerIdEl.value,
            generated_at: new Date().toISOString()
        };
        previewEl.value = JSON.stringify(preview, null, 2);
    }
}

async function openPayloadModal() {
    const modal = document.getElementById("payload-modal");
    if (!modal) return;

    modal.classList.add("active");
    modal.style.display = "grid";

    if (!cachedListeners.length) {
        await loadListeners();
    }

    const nameEl = document.getElementById("payload-name");
    const targetListenerEl = document.getElementById("payload-target-listener");
    const serverIpEl = document.getElementById("payload-server-ip");
    const listenerIdEl = document.getElementById("payload-listener-id");
    const previewEl = document.getElementById("payload-preview-json");

    if (nameEl) {
        nameEl.value = `Payload-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    }

    populatePayloadListenerSelect(selectedListenerId);

    if (targetListenerEl && selectedListenerId && cachedListeners.some(l => l.listener_id === selectedListenerId)) {
        targetListenerEl.value = selectedListenerId;
        const selectedListener = cachedListeners.find(l => l.listener_id === selectedListenerId);
        if (selectedListener) {
            if (listenerIdEl) {
                listenerIdEl.value = selectedListener.listener_id;
            }
            if (serverIpEl) {
                serverIpEl.value = selectedListener.host || "127.0.0.1";
            }
        }
    } else {
        if (listenerIdEl) listenerIdEl.value = "";
        if (serverIpEl) serverIpEl.value = "";
    }

    // Mettre à jour le preview
    if (previewEl && targetListenerEl && serverIpEl && listenerIdEl) {
        const preview = {
            server_ip: serverIpEl.value,
            listener_id: listenerIdEl.value,
            generated_at: new Date().toISOString()
        };
        previewEl.value = JSON.stringify(preview, null, 2);
    }

    addConsoleLog("[*] Payload modal opened", "info");
}

function closePayloadModal() {
    const modal = document.getElementById("payload-modal");
    if (!modal) return;
    modal.classList.remove("active");
    // In case the modal was force-opened via inline styles
    modal.style.display = "none";
}

function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getAttachmentFilename(response, fallbackName) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return match?.[1] || fallbackName;
}

async function generateDropper() {
    const nameEl = document.getElementById("payload-name");
    const targetListenerEl = document.getElementById("payload-target-listener");
    const serverIpEl = document.getElementById("payload-server-ip");
    const listenerIdEl = document.getElementById("payload-listener-id");

    if (!nameEl || !targetListenerEl || !serverIpEl || !listenerIdEl) {
        addConsoleLog("[-] Missing form fields", "error");
        return;
    }

    const name = (nameEl.value || "").trim();
    const targetListenerId = (targetListenerEl.value || "").trim();
    const serverIp = (serverIpEl.value || "").trim();

    if (!name) {
        addConsoleLog("[-] Payload name is required", "error");
        return;
    }
    if (!targetListenerId) {
        addConsoleLog("[-] Please select a listener", "error");
        return;
    }
    if (!serverIp) {
        addConsoleLog("[-] Server IP is required", "error");
        return;
    }

    // Récupérer le listener ID depuis l'objet listener sélectionné
    const selectedListener = cachedListeners.find(l => l.listener_id === targetListenerId);
    const listenerId = selectedListener ? selectedListener.listener_id : targetListenerId;

    addConsoleLog(`[*] Generating dropper for ${serverIp} / ${listenerId}`, "info");

    try {
        const response = await fetch(`${API}/dropper/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                server_ip: serverIp,
                listener_id: listenerId,
                payload_name: name
            })
        });

        if (!response.ok) {
            let message = response.statusText;
            try {
                const errorText = await response.text();
                if (errorText.trim()) {
                    try {
                        const error = JSON.parse(errorText);
                        message = error.detail || errorText.trim();
                    } catch (parseError) {
                        message = errorText.trim();
                    }
                }
            } catch (parseError) {
                // keep default status text if the response body cannot be read
            }
            addConsoleLog(`[-] Generation failed: ${message}`, "error");
            return;
        }

        // Télécharger le fichier
        const outputType = response.headers.get("X-Dropper-Output-Type") || "exe";
        const reason = response.headers.get("X-Dropper-Reason") || "";
        const fallbackExt = outputType === "source" ? "c" : "exe";
        const fallbackName = `dropper_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.${fallbackExt}`;
        const filename = getAttachmentFilename(response, fallbackName);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        if (outputType === "source") {
            const reasonText = reason ? ` (${reason})` : "";
            addConsoleLog(`[+] Dropper source generated successfully: ${filename}${reasonText}`, "success");
            toast("Compiler missing: C source downloaded", "info");
        } else {
            addConsoleLog(`[+] Dropper generated successfully: ${filename}`, "success");
            toast("Dropper downloaded", "success");
        }
        closePayloadModal();

    } catch (e) {
        addConsoleLog(`[-] Generation error: ${e.message}`, "error");
    }
}

// Ensure functions are available from inline HTML handlers
window.openPayloadModal = openPayloadModal;
window.closePayloadModal = closePayloadModal;
window.createPayloadProfile = createPayloadProfile;

async function createListener() {
    const existingId = (document.getElementById("listener-id").value || "").trim();
    const name = document.getElementById("listener-name").value.trim();
    const protocol = document.getElementById("listener-protocol").value;
    const host = document.getElementById("listener-host").value.trim() || "127.0.0.1";
    const port = parseInt(document.getElementById("listener-port").value, 10);
    const beacon_interval = parseInt(document.getElementById("listener-interval").value, 10);
    const user_agent = document.getElementById("listener-ua").value.trim();
    const configJsonRaw = document.getElementById("listener-config-json").value.trim();
    let config = {};

    if (!name) {
        addConsoleLog("[-] listener name is required", "error");
        return;
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        addConsoleLog("[-] invalid listener port", "error");
        return;
    }
    if (!Number.isInteger(beacon_interval) || beacon_interval <= 0) {
        addConsoleLog("[-] invalid beacon interval", "error");
        return;
    }
    if (configJsonRaw) {
        try {
            config = JSON.parse(configJsonRaw);
        } catch (e) {
            addConsoleLog(`[-] invalid config JSON: ${e.message}`, "error");
            return;
        }
    }

    try {
        const isEdit = Boolean(existingId);
        const url = isEdit ? `${API}/listeners/${encodeURIComponent(existingId)}` : `${API}/listeners/`;
        const method = isEdit ? "PUT" : "POST";
        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                protocol,
                host,
                port,
                beacon_interval,
                user_agent: user_agent || undefined,
                config
            })
        });

        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] listener save failed: ${data.detail || res.statusText}`, "error");
            return;
        }

        addConsoleLog(isEdit ? `[+] listener updated: ${data.name} (${data.listener_id})` : `[+] listener created: ${data.name} (${data.listener_id})`, "success");
        toast(isEdit ? "Listener updated" : "Listener created", "success");
        closeListenerModal();
        selectedListenerId = data.listener_id || selectedListenerId;
        storeSelectedListenerId(selectedListenerId);
        await loadListeners();
        renderListenersTable();
        await loadAuditReports({ silent: true });
        switchBottomTab("listeners");
    } catch (e) {
        addConsoleLog(`[-] create listener error: ${e.message}`, "error");
    }
}
async function startSelectedListener() {
    if (!selectedListenerId) {
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(selectedListenerId)}/start`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] start failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        addConsoleLog(`[+] listener started: ${selectedListenerId}`, "success");
        toast("Listener started", "success");
        await loadListeners();
        renderListenersTable();
        await loadAuditReports({ silent: true });
    } catch (e) {
        addConsoleLog(`[-] start error: ${e.message}`, "error");
    }
}

async function stopSelectedListener() {
    if (!selectedListenerId) {
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(selectedListenerId)}/stop`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] stop failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        addConsoleLog(`[+] listener stopped: ${selectedListenerId}`, "success");
        toast("Listener stopped", "success");
        await loadListeners();
        renderListenersTable();
        await loadAuditReports({ silent: true });
    } catch (e) {
        addConsoleLog(`[-] stop error: ${e.message}`, "error");
    }
}

async function showSelectedListenerStats() {
    if (!selectedListenerId) {
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(selectedListenerId)}/stats`);
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] stats failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        addConsoleLog(`[*] listener stats: ${data.name} (${data.listener_id})`, "info");
        addConsoleLog(`    endpoint: ${data.endpoint}`, "info");
        addConsoleLog(`    stats: ${JSON.stringify(data.stats || {}, null, 2)}`, "info");
    } catch (e) {
        addConsoleLog(`[-] stats error: ${e.message}`, "error");
    }
}

async function exportSelectedListener() {
    if (!selectedListenerId) {
        addConsoleLog("[-] select a listener first", "error");
        return;
    }
    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(selectedListenerId)}/export`);
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] export failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        const txt = data.profile_json || "";
        addConsoleLog(`[*] export (copy/paste):`, "info");
        addConsoleLog(txt, "info");
        if (navigator.clipboard && txt) {
            await navigator.clipboard.writeText(txt);
            toast("Export copied to clipboard", "info");
        }
    } catch (e) {
        addConsoleLog(`[-] export error: ${e.message}`, "error");
    }
}

async function removeSelectedListener() {
    if (!selectedListenerId) return;
    if (!confirm(`Remove listener ${selectedListenerId}?`)) return;
    try {
        const res = await fetch(`${API}/listeners/${encodeURIComponent(selectedListenerId)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] remove failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        addConsoleLog(`[+] listener removed: ${selectedListenerId}`, "success");
        toast("Listener removed", "success");
        selectedListenerId = null;
        storeSelectedListenerId(null);
        selectedAuditReportId = null;
        selectedAuditReportDetail = null;
        await loadListeners();
        renderListenersTable();
        await loadAuditReports({ silent: true });
    } catch (e) {
        addConsoleLog(`[-] remove error: ${e.message}`, "error");
    }
}

async function showAgentDetails(agentId) {
    try {
        const res = await fetch(`${API}/agents/${agentId}`);
        const agent = await res.json();
        currentAgent = agent;
        const body = document.getElementById("modal-body");
        body.innerHTML = `
            <div class="detail-row"><div class="detail-label">Agent ID</div><div class="detail-value">${agent.agent_id ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">Hostname</div><div class="detail-value">${agent.hostname ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">Username</div><div class="detail-value">${agent.username ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">IP</div><div class="detail-value">${agent.ip_address ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">OS</div><div class="detail-value">${agent.operating_system ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${agent.status ?? "-"}</div></div>
            <div class="detail-row"><div class="detail-label">Last seen</div><div class="detail-value">${agent.last_seen ?? "-"}</div></div>
        `;
        document.getElementById("agent-modal").classList.add("active");
    } catch (e) {
        addConsoleLog(`[-] details fetch failed: ${e.message}`, "error");
    }
}

function closeModal() {
    document.getElementById("agent-modal").classList.remove("active");
    currentAgent = null;
}

async function killAgent() {
    if (!currentAgent) return;
    try {
        const res = await fetch(`${API}/agents/${encodeURIComponent(currentAgent.agent_id)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) {
            addConsoleLog(`[-] remove agent failed: ${data.detail || res.statusText}`, "error");
            return;
        }
        addConsoleLog(`[+] simulated agent removed: ${currentAgent.agent_id?.slice(0, 8)}`, "success");
        closeModal();
        await loadAgents();
    } catch (e) {
        addConsoleLog(`[-] remove agent error: ${e.message}`, "error");
    }
}

function setupSortableTables() {
    document.querySelectorAll("table thead th[data-sort-key]").forEach((th) => {
        th.addEventListener("click", () => {
            const table = th.closest("table");
            const key = parseInt(th.dataset.sortKey, 10);
            sortTableByColumn(table, key);
        });
    });
}

function sortTableByColumn(table, column) {
    const tbody = table?.querySelector("tbody");
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.classList.contains("loading"));
    if (!rows.length) return;
    const asc = !(table.dataset.sortAsc === "true");
    rows.sort((a, b) => {
        const av = (a.children[column]?.textContent || "").trim().toLowerCase();
        const bv = (b.children[column]?.textContent || "").trim().toLowerCase();
        const an = Number(av);
        const bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    tbody.innerHTML = "";
    rows.forEach(r => tbody.appendChild(r));
    table.dataset.sortAsc = asc ? "true" : "false";
}

function openCmdk() {
    const modal = document.getElementById("cmdk-modal");
    if (!modal) return;
    modal.classList.add("active");
    const input = document.getElementById("cmdk-input");
    if (input) {
        input.value = "";
        activeCmdkIndex = 0;
        renderCmdkList();
        setTimeout(() => input.focus(), 0);
    }
}

function closeCmdk() {
    const modal = document.getElementById("cmdk-modal");
    if (modal) modal.classList.remove("active");
}

function renderCmdkList() {
    const input = document.getElementById("cmdk-input");
    const list = document.getElementById("cmdk-list");
    if (!input || !list) return;
    const q = input.value.trim().toLowerCase();
    const filtered = CMDK_ACTIONS.filter(a => a.label.toLowerCase().includes(q));
    if (activeCmdkIndex >= filtered.length) activeCmdkIndex = 0;
    list.innerHTML = "";
    filtered.forEach((a, idx) => {
        const item = document.createElement("div");
        item.className = `cmdk-item${idx === activeCmdkIndex ? " active" : ""}`;
        item.textContent = a.label;
        item.addEventListener("click", () => {
            a.run();
            closeCmdk();
            toast(a.label, "info");
        });
        list.appendChild(item);
    });
}

function onCmdkKeydown(e) {
    const input = document.getElementById("cmdk-input");
    const q = (input?.value || "").trim().toLowerCase();
    const filtered = CMDK_ACTIONS.filter(a => a.label.toLowerCase().includes(q));
    if (!filtered.length) return;
    if (e.key === "ArrowDown") {
        e.preventDefault();
        activeCmdkIndex = (activeCmdkIndex + 1) % filtered.length;
        renderCmdkList();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeCmdkIndex = (activeCmdkIndex - 1 + filtered.length) % filtered.length;
        renderCmdkList();
    } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[activeCmdkIndex].run();
        closeCmdk();
        toast(filtered[activeCmdkIndex].label, "info");
    }
}
// ============================================================
// RAPPORT STATISTIQUES - VERSION SIMPLIFIÉE
// ============================================================

// Fonctions globales
window.openReportModal = function() {
    console.log('[RAPPORT] Ouverture...');
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'grid';
        loadReportData();
    }
};

window.closeReportModal = function() {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
};

// Chargement des données
// Chargement des données AVEC GRAPHIQUES
async function loadReportData() {
    const container = document.getElementById('report-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px">📊 Chargement des données...</div>';
    
    try {
        let allFindings = [];
        let systemInfo = {};
        
        // Récupérer les findings depuis selectedAuditReportDetail
        if (selectedAuditReportDetail && selectedAuditReportDetail.report_json) {
            const parsed = typeof selectedAuditReportDetail.report_json === 'string' 
                ? JSON.parse(selectedAuditReportDetail.report_json) 
                : selectedAuditReportDetail.report_json;
            
            if (parsed.findings) {
                allFindings = parsed.findings;
                console.log('[RAPPORT] Findings chargés:', allFindings.length);
            }
            if (parsed.system) {
                systemInfo = parsed.system;
            }
        }
        
        // Afficher le dashboard complet
        renderFullDashboard(allFindings, systemInfo);
        
    } catch (error) {
        console.error('Error:', error);
        container.innerHTML = `<div style="padding:20px;color:red">❌ Erreur: ${error.message}</div>`;
    }
}


function renderFullDashboard(findings, systemInfo) {
    const container = document.getElementById('report-content');
    if (!container) return;
    
    // Compter par sévérité
    const critical = findings.filter(f => (f.severity || '').toUpperCase() === 'CRITICAL').length;
    const high = findings.filter(f => (f.severity || '').toUpperCase() === 'HIGH').length;
    const medium = findings.filter(f => (f.severity || '').toUpperCase() === 'MEDIUM').length;
    const low = findings.filter(f => (f.severity || '').toUpperCase() === 'LOW').length;
    const info = findings.filter(f => !f.severity || (f.severity || '').toUpperCase() === 'INFO').length;
    
    // Grouper par type pour l'arbre et la heatmap
    const byType = {};
    findings.forEach(f => {
        const type = f.type || f.Tipo || 'Unknown';
        const sev = (f.severity || f.Severity || 'LOW').toUpperCase();
        if (!byType[type]) {
            byType[type] = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
        }
        byType[type].total++;
        if (sev === 'CRITICAL') byType[type].critical++;
        else if (sev === 'HIGH') byType[type].high++;
        else if (sev === 'MEDIUM') byType[type].medium++;
        else byType[type].low++;
    });
    
    container.innerHTML = `
        <div style="padding:20px">
            <h2>📊 Vulnerability Intelligence Dashboard</h2>
            
            <!-- System Info -->
            <div style="background:#0f0f23;padding:12px;border-radius:8px;margin-bottom:20px">
                <p><strong>🖥️ Machine:</strong> ${systemInfo.MachineName || systemInfo.hostname || '-'}</p>
                <p><strong>👤 User:</strong> ${systemInfo.UserName || systemInfo.username || '-'} ${systemInfo.IsAdministrator ? '(Administrator)' : '(Standard User)'}</p>
                <p><strong>💿 OS:</strong> ${systemInfo.OsVersion || systemInfo.os || '-'}</p>
            </div>
            
            <!-- KPI Cards -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:15px;margin:20px 0">
                <div style="background:#1a1a2e;padding:15px;border-left:4px solid #ef4444;border-radius:8px">
                    <div style="font-size:32px;font-weight:bold">${critical}</div>
                    <div style="color:#ef4444">🔴 CRITICAL</div>
                </div>
                <div style="background:#1a1a2e;padding:15px;border-left:4px solid #f97316;border-radius:8px">
                    <div style="font-size:32px;font-weight:bold">${high}</div>
                    <div style="color:#f97316">🟠 HIGH</div>
                </div>
                <div style="background:#1a1a2e;padding:15px;border-left:4px solid #eab308;border-radius:8px">
                    <div style="font-size:32px;font-weight:bold">${medium}</div>
                    <div style="color:#eab308">🟡 MEDIUM</div>
                </div>
                <div style="background:#1a1a2e;padding:15px;border-left:4px solid #22c55e;border-radius:8px">
                    <div style="font-size:32px;font-weight:bold">${low}</div>
                    <div style="color:#22c55e">🟢 LOW</div>
                </div>
                <div style="background:#1a1a2e;padding:15px;border-left:4px solid #6b7280;border-radius:8px">
                    <div style="font-size:32px;font-weight:bold">${findings.length}</div>
                    <div style="color:#6b7280">📊 TOTAL</div>
                </div>
            </div>
            
            <!-- Charts -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0">
                <div style="background:#1a1a2e;padding:15px;border-radius:8px">
                    <canvas id="radar-chart" style="width:100%;height:300px"></canvas>
                    <p style="text-align:center;margin-top:8px">🎯 Risk Distribution</p>
                </div>
                <div style="background:#1a1a2e;padding:15px;border-radius:8px">
                    <canvas id="doughnut-chart" style="width:100%;height:300px"></canvas>
                    <p style="text-align:center;margin-top:8px">🥧 Severity Breakdown</p>
                </div>
            </div>
            
            <!-- Attack Surface Tree -->
            <div style="background:#1a1a2e;padding:15px;border-radius:8px;margin:20px 0">
                <h4>🌳 Attack Surface Tree (Top 20)</h4>
                <div id="vuln-tree-container" style="font-family:monospace;font-size:12px;max-height:300px;overflow:auto"></div>
            </div>
            
            <!-- Risk Heatmap -->
            <div style="background:#1a1a2e;padding:15px;border-radius:8px;margin:20px 0">
                <h4>🔥 Risk Heatmap by Category</h4>
                <div id="heatmap-container"></div>
            </div>
            
            <!-- Summary -->
            <div style="margin-top:20px;padding:12px;background:#0f0f23;border-radius:8px">
                <p><strong>📁 Report ID:</strong> ${selectedAuditReportDetail?.report_id || '-'}</p>
                <p><strong>🔍 Total Findings:</strong> ${findings.length}</p>
                <p><strong>🕐 Generated:</strong> ${new Date().toLocaleString()}</p>
            </div>
        </div>
    `;
    
    // Initialiser les graphiques
    setTimeout(() => {
        initCharts(critical, high, medium, low, info);
        buildVulnerabilityTree(byType);
        buildRiskHeatmap(byType);
    }, 100);
}

function initCharts(critical, high, medium, low, info) {
    // Radar Chart
    const radarCanvas = document.getElementById('radar-chart');
    if (radarCanvas && typeof Chart !== 'undefined') {
        if (window.radarChart) window.radarChart.destroy();
        
        window.radarChart = new Chart(radarCanvas, {
            type: 'radar',
            data: {
                labels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
                datasets: [{
                    label: 'Vulnerability Distribution',
                    data: [critical, high, medium, low, info],
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    pointBackgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280']
                }]
            },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }
    
    // Doughnut Chart
    const doughnutCanvas = document.getElementById('doughnut-chart');
    if (doughnutCanvas && typeof Chart !== 'undefined') {
        if (window.doughnutChart) window.doughnutChart.destroy();
        
        window.doughnutChart = new Chart(doughnutCanvas, {
            type: 'doughnut',
            data: {
                labels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
                datasets: [{
                    data: [critical, high, medium, low, info],
                    backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280']
                }]
            },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }
}

function buildVulnerabilityTree(byType) {
    const container = document.getElementById('vuln-tree-container');
    if (!container) return;
    
    const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
    
    let html = '';
    for (const [type, counts] of sorted.slice(0, 20)) {
        const severityIcon = counts.critical > 0 ? '🔴' : (counts.high > 0 ? '🟠' : (counts.medium > 0 ? '🟡' : '🟢'));
        html += `
            <div style="margin-bottom:8px;padding:4px 0;border-left:3px solid ${counts.critical > 0 ? '#ef4444' : (counts.high > 0 ? '#f97316' : (counts.medium > 0 ? '#eab308' : '#22c55e'))};padding-left:12px">
                <strong>${severityIcon} ${type}</strong> (${counts.total})
                <div style="margin-left:16px;font-size:10px">
                    ${counts.critical > 0 ? `<span style="color:#ef4444">Critical: ${counts.critical}</span> ` : ''}
                    ${counts.high > 0 ? `<span style="color:#f97316">High: ${counts.high}</span> ` : ''}
                    ${counts.medium > 0 ? `<span style="color:#eab308">Medium: ${counts.medium}</span> ` : ''}
                    ${counts.low > 0 ? `<span style="color:#22c55e">Low: ${counts.low}</span>` : ''}
                </div>
            </div>
        `;
    }
    container.innerHTML = html || '<p>No vulnerabilities found</p>';
}

function buildRiskHeatmap(byType) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;
    
    const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
    const maxTotal = sorted[0]?.[1]?.total || 1;
    
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';
    for (const [type, counts] of sorted.slice(0, 15)) {
        const percentage = (counts.total / maxTotal) * 100;
        html += `
            <div style="background:#0f0f23;padding:10px;border-radius:8px">
                <div style="font-weight:bold;margin-bottom:8px;font-size:12px">${type.substring(0, 35)}</div>
                <div style="height:6px;background:#2a2a4a;border-radius:3px;overflow:hidden">
                    <div style="height:100%;width:${percentage}%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);border-radius:3px"></div>
                </div>
                <div style="font-size:10px;margin-top:6px">
                    🔴 ${counts.critical} 🟠 ${counts.high} 🟡 ${counts.medium} 🟢 ${counts.low}
                </div>
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}
// Initialiser les graphiques Chart.js
function initCharts(critical, high, medium, low, info) {
    console.log('[CHARTS] Initialisation avec:', { critical, high, medium, low, info });
    
    // Attendre que le DOM soit prêt
    setTimeout(() => {
        // Radar Chart
        const radarCanvas = document.getElementById('radar-chart');
        console.log('[CHARTS] radarCanvas trouvé:', !!radarCanvas);
        
        if (radarCanvas && typeof Chart !== 'undefined') {
            // Nettoyer l'ancien graphique
            if (window.radarChart) {
                window.radarChart.destroy();
            }
            
            const ctx = radarCanvas.getContext('2d');
            window.radarChart = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
                    datasets: [{
                        label: 'Vulnerability Distribution',
                        data: [critical, high, medium, low],
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderColor: '#3b82f6',
                        borderWidth: 2,
                        pointBackgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e'],
                        pointBorderColor: '#fff',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    scales: {
                        r: {
                            beginAtZero: true,
                            ticks: { 
                                stepSize: Math.ceil(Math.max(critical, high, medium, low) / 5),
                                color: '#aaa' 
                            },
                            grid: { color: '#2a2a4a' },
                            pointLabels: { color: '#ddd' }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: '#eee' } },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw}` } }
                    }
                }
            });
            console.log('[CHARTS] Radar chart créé');
        }
        
        // Doughnut Chart
        const doughnutCanvas = document.getElementById('doughnut-chart');
        console.log('[CHARTS] doughnutCanvas trouvé:', !!doughnutCanvas);
        
        if (doughnutCanvas && typeof Chart !== 'undefined') {
            if (window.doughnutChart) {
                window.doughnutChart.destroy();
            }
            
            const ctx2 = doughnutCanvas.getContext('2d');
            window.doughnutChart = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
                    datasets: [{
                        data: [critical, high, medium, low],
                        backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { 
                            position: 'bottom', 
                            labels: { color: '#eee' } 
                        },
                        tooltip: { 
                            callbacks: { 
                                label: (ctx) => `${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw / (critical+high+medium+low) * 100)}%)` 
                            } 
                        }
                    }
                }
            });
            console.log('[CHARTS] Doughnut chart créé');
        }
    }, 200);
}
// Construire l'arbre des vulnérabilités
function buildVulnerabilityTree(byType) {
    const container = document.getElementById('vuln-tree-container');
    if (!container) {
        console.log('[TREE] Container vuln-tree-container non trouvé');
        return;
    }
    
    console.log('[TREE] Construction avec', Object.keys(byType).length, 'types');
    
    const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
    
    if (sorted.length === 0) {
        container.innerHTML = '<p>Aucune vulnérabilité trouvée</p>';
        return;
    }
    
    let html = '';
    for (const [type, counts] of sorted.slice(0, 20)) {
        const severityIcon = counts.critical > 0 ? '🔴' : (counts.high > 0 ? '🟠' : (counts.medium > 0 ? '🟡' : '🟢'));
        html += `
            <div style="margin-bottom:10px;padding:8px 0;border-left:3px solid ${counts.critical > 0 ? '#ef4444' : (counts.high > 0 ? '#f97316' : (counts.medium > 0 ? '#eab308' : '#22c55e'))};padding-left:12px;background:#0f0f23;border-radius:0 8px 8px 0">
                <div style="font-weight:bold;font-size:13px">${severityIcon} ${type}</div>
                <div style="margin-top:5px;margin-left:20px;font-size:11px">
                    ${counts.critical > 0 ? `<span style="color:#ef4444;margin-right:10px">🔴 Critical: ${counts.critical}</span>` : ''}
                    ${counts.high > 0 ? `<span style="color:#f97316;margin-right:10px">🟠 High: ${counts.high}</span>` : ''}
                    ${counts.medium > 0 ? `<span style="color:#eab308;margin-right:10px">🟡 Medium: ${counts.medium}</span>` : ''}
                    ${counts.low > 0 ? `<span style="color:#22c55e">🟢 Low: ${counts.low}</span>` : ''}
                </div>
                <div style="margin-top:5px;margin-left:20px;font-size:11px;color:#aaa">
                    📊 Total: ${counts.total}
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
    console.log('[TREE] Affichage terminé');
}

function buildRiskHeatmap(byType) {
    const container = document.getElementById('heatmap-container');
    if (!container) {
        console.log('[HEATMAP] Container heatmap-container non trouvé');
        return;
    }
    
    console.log('[HEATMAP] Construction avec', Object.keys(byType).length, 'types');
    
    const sorted = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
    const maxTotal = sorted[0]?.[1]?.total || 1;
    
    if (sorted.length === 0) {
        container.innerHTML = '<p>Aucune donnée pour la heatmap</p>';
        return;
    }
    
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">';
    for (const [type, counts] of sorted.slice(0, 15)) {
        const percentage = (counts.total / maxTotal) * 100;
        const totalColor = percentage > 66 ? '#ef4444' : (percentage > 33 ? '#eab308' : '#22c55e');
        
        html += `
            <div style="background:#0f0f23;padding:12px;border-radius:8px;border:1px solid #2a2a4a">
                <div style="font-weight:bold;margin-bottom:8px;font-size:12px;color:#ddd" title="${type}">
                    ${type.length > 35 ? type.substring(0, 32) + '...' : type}
                </div>
                <div style="height:8px;background:#2a2a4a;border-radius:4px;overflow:hidden;margin:8px 0">
                    <div style="height:100%;width:${percentage}%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);border-radius:4px"></div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:8px">
                    <div style="font-size:10px">
                        ${counts.critical > 0 ? `<span style="color:#ef4444">🔴 ${counts.critical}</span>` : ''}
                        ${counts.high > 0 ? `<span style="color:#f97316">🟠 ${counts.high}</span>` : ''}
                        ${counts.medium > 0 ? `<span style="color:#eab308">🟡 ${counts.medium}</span>` : ''}
                        ${counts.low > 0 ? `<span style="color:#22c55e">🟢 ${counts.low}</span>` : ''}
                    </div>
                    <div style="font-size:11px;font-weight:bold;color:${totalColor}">${counts.total}</div>
                </div>
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
    console.log('[HEATMAP] Affichage terminé');
}
// Attacher l'événement au bouton
(function() {
    function attachButton() {
        const btn = document.getElementById('report-btn');
        if (btn) {
            btn.onclick = function(e) {
                e.preventDefault();
                console.log('🖱️ Rapport cliqué!');
                window.openReportModal();
                return false;
            };
            console.log('✅ Bouton Rapport activé');
        } else {
            setTimeout(attachButton, 100);
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachButton);
    } else {
        attachButton();
    }
})();
window.generateSecurityReport = function() {
    // Utiliser la variable globale selectedAuditReportDetail
    var auditReport = selectedAuditReportDetail;
    
    console.log('generateSecurityReport - auditReport:', auditReport);
    
    // Si pas de rapport sélectionné, prendre le premier de cachedAuditReports
    if (!auditReport && cachedAuditReports && cachedAuditReports.length > 0) {
        auditReport = cachedAuditReports[0];
        console.log('Utilisation du premier rapport disponible:', auditReport?.report_id);
    }
    
    if (!auditReport || !auditReport.report_json) {
        console.error('Aucun rapport sélectionné');
        if (typeof toast === 'function') {
            toast('Please select an audit report first (click on a report in Enumeration Results tab)', 'error');
        }
        return;
    }

    try {
        var data = JSON.parse(auditReport.report_json);
        var findings = data.findings || [];
        var system = data.system || {};

        console.log('Rapport chargé - Findings:', findings.length);
        
        // ============================================================
        // GÉNÉRATION DES RECOMMANDATIONS BASÉES SUR LES FINDINGS
        // ============================================================
        var criticalCount = findings.filter(function(f) { return (f.severity || '').toUpperCase() === 'CRITICAL'; }).length;
        var highCount = findings.filter(function(f) { return (f.severity || '').toUpperCase() === 'HIGH'; }).length;
        var mediumCount = findings.filter(function(f) { return (f.severity || '').toUpperCase() === 'MEDIUM'; }).length;
        
        var recommendations = [];
        
        if (criticalCount > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                action: 'Patch or mitigate CRITICAL vulnerabilities immediately',
                details: criticalCount + ' critical findings detected that could lead to full system compromise'
            });
        }
        
        if (highCount > 0) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Address HIGH severity issues within 48 hours',
                details: highCount + ' high-risk findings requiring prompt attention'
            });
        }
        
        var hasScheduledTask = findings.some(function(f) { return (f.category || '').toLowerCase() === 'scheduledtask'; });
        var hasService = findings.some(function(f) { return (f.category || '').toLowerCase() === 'service'; });
        var hasRegistry = findings.some(function(f) { return (f.category || '').toLowerCase() === 'registry'; });
        var hasWMI = findings.some(function(f) { return (f.category || '').toLowerCase() === 'wmi'; });
        var hasStartup = findings.some(function(f) { return (f.category || '').toLowerCase() === 'startup'; });
        
        if (hasScheduledTask) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Review and harden scheduled tasks',
                details: 'Writable scheduled task binaries detected - potential for persistence/privilege escalation'
            });
        }
        
        if (hasService) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Audit Windows service permissions',
                details: 'Writable service binaries detected - review service ACLs and binary paths'
            });
        }
        
        if (hasRegistry) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Restrict registry write access',
                details: 'Writable registry keys detected in sensitive locations (HKLM\\Run)'
            });
        }
        
        if (hasWMI) {
            recommendations.push({
                priority: 'LOW',
                action: 'Review WMI subscriptions',
                details: 'WMI subscriptions detected - verify legitimacy'
            });
        }
        
        if (hasStartup) {
            recommendations.push({
                priority: 'LOW',
                action: 'Review startup folder permissions',
                details: 'Startup folder with weak permissions detected'
            });
        }
        
        // ============================================================
        // MAPPING MITRE DYNAMIQUE basé sur les findings réels
        // ============================================================
        var mitreTechniques = {};
        
        findings.forEach(function(f) {
            var type = (f.type || '').toLowerCase();
            var category = (f.category || '').toLowerCase();
            
            // Mapping des techniques MITRE
            if (type.includes('scheduled task') || category === 'scheduledtask') {
                mitreTechniques['Scheduled Task'] = { tactic: 'Persistence', id: 'T1053.005' };
            }
            if (type.includes('service') || category === 'service') {
                mitreTechniques['Service Modification'] = { tactic: 'Persistence / Privilege Escalation', id: 'T1543.003' };
            }
            if (type.includes('registry') || category === 'registry') {
                mitreTechniques['Registry Run Keys'] = { tactic: 'Persistence', id: 'T1547.001' };
            }
            if (type.includes('wmi') || category === 'wmi') {
                mitreTechniques['WMI Event Subscription'] = { tactic: 'Persistence', id: 'T1546.003' };
            }
            if (type.includes('startup') || category === 'startup') {
                mitreTechniques['Startup Folder'] = { tactic: 'Persistence', id: 'T1547.001' };
            }
            if (type.includes('unquoted') || (f.description || '').toLowerCase().includes('unquoted')) {
                mitreTechniques['Unquoted Service Path'] = { tactic: 'Privilege Escalation', id: 'T1574.009' };
            }
        });
        
        // Générer le tableau MITRE
        var mitreRows = '';
        for (var technique in mitreTechniques) {
            mitreRows += '<tr>' +
                '<td style="padding:6px;border:1px solid #ddd;">' + technique + '</td>' +
                '<td style="padding:6px;border:1px solid #ddd;">' + mitreTechniques[technique].tactic + '</td>' +
                '<td style="padding:6px;border:1px solid #ddd;">' + mitreTechniques[technique].id + '</td>' +
                '</tr>';
        }
        
        if (mitreRows === '') {
            mitreRows = '<tr><td colspan="3" style="padding:6px;text-align:center;color:#666;">No MITRE techniques identified from findings</td></tr>';
        }
        
        // ============================================================
        // COMPTER LES SÉVÉRITÉS
        // ============================================================
        var lowCount = findings.filter(function(f) { return (f.severity || '').toUpperCase() === 'LOW'; }).length;
        var infoCount = findings.filter(function(f) { 
            var sev = (f.severity || '').toUpperCase();
            return sev !== 'CRITICAL' && sev !== 'HIGH' && sev !== 'MEDIUM' && sev !== 'LOW';
        }).length;
        
        // ============================================================
        // GÉNÉRATION DU CONTENU HTML POUR LE PDF
        // ============================================================
        var pdfContent = document.createElement('div');
        pdfContent.style.cssText = 'padding:20px;font-family:Arial,sans-serif;font-size:12px;background:white;color:black;width:800px;max-width:100%;';

        pdfContent.innerHTML = `
            <div style="text-align:center;margin-bottom:20px;">
                <h1 style="color:#333;">🔒 SECURITY ASSESSMENT REPORT</h1>
                <p>Generated: ${new Date().toLocaleString()}</p>
                <hr style="border:1px solid #ccc;">
            </div>
            
            <!-- SYSTEM INFORMATION -->
            <div style="margin-bottom:20px;">
                <h2 style="color:#2563eb;">📋 SYSTEM INFORMATION</h2>
                <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;">
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;"><strong>Machine</strong><tr><td style="padding:8px;border:1px solid #ddd;">${system.MachineName || system.hostname || 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;"><strong>User</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.UserName || system.username || 'N/A'}${system.IsAdministrator ? ' (Administrator)' : ' (Standard User)'}</td></tr>
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;"><strong>Domain</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.Domain || system.Workgroup || 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;"><strong>OS Version</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.OsVersion || system.OperatingSystem || system.os || 'N/A'}</td></tr>
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;"><strong>CPU</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.CpuName || system.CPU || 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;"><strong>RAM</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.TotalMemoryMb || system.RAM || 'N/A'} MB</td></tr>
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;"><strong>IPv4 Addresses</strong></td><td style="padding:8px;border:1px solid #ddd;">${(system.IPv4Addresses || []).join(', ') || 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;"><strong>Last Boot</strong></td><td style="padding:8px;border:1px solid #ddd;">${system.LastBootTime || 'N/A'}</td></tr>
                </table>
            </div>
            
            <!-- VULNERABILITY SUMMARY -->
            <div style="margin-bottom:20px;">
                <h2 style="color:#2563eb;">📊 VULNERABILITY SUMMARY</h2>
                <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;">
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;"><strong>Total Findings</strong></td><td style="padding:8px;border:1px solid #ddd;">${findings.length}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;color:#ef4444;"><strong>🔴 CRITICAL</strong></td><td style="padding:8px;border:1px solid #ddd;">${criticalCount}</td></tr>
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;color:#f97316;"><strong>🟠 HIGH</strong></td><td style="padding:8px;border:1px solid #ddd;">${highCount}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;color:#eab308;"><strong>🟡 MEDIUM</strong></td><td style="padding:8px;border:1px solid #ddd;">${mediumCount}</td></tr>
                    <tr style="background:#f5f5f5;"><td style="padding:8px;border:1px solid #ddd;color:#22c55e;"><strong>🟢 LOW</strong></td><td style="padding:8px;border:1px solid #ddd;">${lowCount}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd;"><strong>ℹ️ INFO</strong></td><td style="padding:8px;border:1px solid #ddd;">${infoCount}</td></tr>
                </table>
            </div>
            
            <!-- RECOMMENDATIONS -->
            <div style="margin-bottom:20px;">
                <h2 style="color:#2563eb;">🎯 RECOMMENDATIONS</h2>
                ${recommendations.map(function(rec) {
                    var bgColor = rec.priority === 'CRITICAL' ? '#fef2f2' : (rec.priority === 'HIGH' ? '#fffbeb' : (rec.priority === 'MEDIUM' ? '#f0fdf4' : '#f8fafc'));
                    var borderColor = rec.priority === 'CRITICAL' ? '#ef4444' : (rec.priority === 'HIGH' ? '#f97316' : (rec.priority === 'MEDIUM' ? '#22c55e' : '#6b7280'));
                    return '<div style="background:' + bgColor + ';padding:10px;margin-bottom:8px;border-radius:6px;border-left:3px solid ' + borderColor + ';">' +
                        '<div style="font-weight:bold;">' + rec.action + '</div>' +
                        '<div style="font-size:11px;color:#475569;">' + rec.details + '</div>' +
                        '</div>';
                }).join('')}
            </div>
            
            <!-- MITRE ATT&CK MAPPING (DYNAMIQUE) -->
            <div style="margin-bottom:20px;">
                <h2 style="color:#2563eb;">🎯 MITRE ATT&amp;CK MAPPING</h2>
                <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;">
                    <thead>
                        <tr style="background:#2563eb;color:white;">
                            <th style="padding:8px;border:1px solid #ddd;">Technique</th>
                            <th style="padding:8px;border:1px solid #ddd;">Tactic</th>
                            <th style="padding:8px;border:1px solid #ddd;">ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${mitreRows}
                    </tbody>
                </table>
            </div>
            
            <!-- DETAILED FINDINGS (limité à 50 pour la lisibilité) -->
            <div style="margin-bottom:20px;">
                <h2 style="color:#2563eb;">🔍 DETAILED FINDINGS</h2>
                <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;font-size:10px;">
                    <thead>
                        <tr style="background:#2563eb;color:white;">
                            <th style="padding:8px;border:1px solid #ddd;">Severity</th>
                            <th style="padding:8px;border:1px solid #ddd;">Type</th>
                            <th style="padding:8px;border:1px solid #ddd;">Target</th>
                            <th style="padding:8px;border:1px solid #ddd;">Evidence Path</th>
                            <th style="padding:8px;border:1px solid #ddd;">Principal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${findings.slice(0, 50).map(function(f, idx) {
                            var sev = (f.severity || '').toUpperCase();
                            var col = sev === 'CRITICAL' ? '#ef4444' : (sev === 'HIGH' ? '#f97316' : (sev === 'MEDIUM' ? '#eab308' : (sev === 'LOW' ? '#22c55e' : '#6b7280')));
                            return '<tr style="background:' + (idx % 2 === 0 ? '#fafafa' : 'white') + ';">' +
                                '<td style="padding:6px;border:1px solid #ddd;text-align:center;color:' + col + ';font-weight:bold;">' + (f.severity || 'INFO') + '</td>' +
                                '<td style="padding:6px;border:1px solid #ddd;">' + (f.type || 'Unknown') + '</td>' +
                                '<td style="padding:6px;border:1px solid #ddd;">' + (f.target || 'N/A') + '</td>' +
                                '<td style="padding:6px;border:1px solid #ddd;font-family:monospace;font-size:9px;word-break:break-all;white-space:normal;">' + (f.evidencePath || f.path || '-') + '</td>' +
                                '<td style="padding:6px;border:1px solid #ddd;text-align:center;">' + (f.principal || '-') + '</td>' +
                                '</tr>';
                        }).join('')}
                    </tbody>
                </table>
                ${findings.length > 50 ? '<p style="margin-top:10px;font-style:italic;color:#666;">... and ' + (findings.length - 50) + ' more findings (see full report in Enumeration Results tab)</p>' : ''}
            </div>
            
            <!-- FOOTER -->
            <div style="margin-top:30px;text-align:center;font-size:10px;color:#666;">
                <hr>
                <p>📄 Report generated by Red Team Persistence Framework - C2 Command & Control</p>
                <p>${new Date().toLocaleString()} - All rights reserved</p>
            </div>`;

        document.body.appendChild(pdfContent);

        // ============================================================
        // GÉNÉRATION PDF
        // ============================================================
        if (typeof html2canvas !== 'undefined' && typeof window.jspdf !== 'undefined') {
            html2canvas(pdfContent, { scale: 2, backgroundColor: '#ffffff' }).then(function(canvas) {
                var imgData = canvas.toDataURL('image/png');
                var { jsPDF } = window.jspdf;
                var pdf = new jsPDF('p', 'mm', 'a4');
                var imgWidth = 210;
                var pageH = 297;
                var imgHeight = (canvas.height * imgWidth) / canvas.width;
                pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
                var left = imgHeight - pageH;
                var pos = -pageH;
                while (left > 0) {
                    pdf.addPage();
                    pdf.addImage(imgData, 'PNG', 0, pos, imgWidth, imgHeight);
                    left -= pageH;
                    pos -= pageH;
                }
                pdf.save('security_report_' + (system.MachineName || 'unknown') + '_' + Date.now() + '.pdf');
                document.body.removeChild(pdfContent);
                if (typeof toast === 'function') toast('✅ PDF Report generated!', 'success');
            }).catch(function(err) {
                console.error(err);
                document.body.removeChild(pdfContent);
                if (typeof toast === 'function') toast('❌ Error generating PDF: ' + err.message, 'error');
            });
        } else {
            var blob = new Blob([pdfContent.innerHTML], { type: 'text/html' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'security_report_' + (system.MachineName || 'unknown') + '_' + Date.now() + '.html';
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(pdfContent);
            if (typeof toast === 'function') toast('📄 HTML report generated (PDF libraries missing)', 'info');
        }
    } catch (error) {
        console.error('Erreur lors de la génération du PDF:', error);
        if (typeof toast === 'function') toast('Error generating report: ' + error.message, 'error');
    }
};


window.exportCSV = function() {
    var auditReport = window.selectedAuditReportDetail;
    if (!auditReport || !auditReport.report_json) { 
        if (typeof toast === 'function') toast('Veuillez sélectionner un rapport d\'audit d\'abord', 'error');
        else alert('Veuillez sélectionner un rapport d\'audit d\'abord'); 
        return; 
    }
    var data = JSON.parse(auditReport.report_json);
    var findings = data.findings || [];
    var csv = 'Severity,Type,Target,Evidence Path\n';
    for (var i = 0; i < findings.length; i++) {
        csv += '"' + (findings[i].severity || '') + '","' + (findings[i].type || '') + '","' + (findings[i].target || '') + '","' + (findings[i].evidencePath || '') + '"\n';
    }
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'vulnerability_report_' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    if (typeof toast === 'function') toast('✅ CSV exported!', 'success');
};

window.copyReportJson = function() {
    var auditReport = window.selectedAuditReportDetail;
    if (!auditReport || !auditReport.report_json) { 
        if (typeof toast === 'function') toast('Veuillez sélectionner un rapport d\'audit d\'abord', 'error');
        else alert('Veuillez sélectionner un rapport d\'audit d\'abord'); 
        return; 
    }
    navigator.clipboard.writeText(auditReport.report_json);
    if (typeof toast === 'function') toast('✅ JSON copied!', 'success');
};
function extractFindingsFromDashboard() {
    let allFindings = [];
    if (selectedAuditReportDetail && selectedAuditReportDetail.report_json) {
        const parsed = typeof selectedAuditReportDetail.report_json === 'string' 
            ? JSON.parse(selectedAuditReportDetail.report_json) 
            : selectedAuditReportDetail.report_json;
        if (parsed.findings) allFindings = parsed.findings;
    }
    return allFindings;
}

// ==========================================
// FIX pour l'erreur createPayloadProfile
// ==========================================
function createPayloadProfile() {
    console.log("[*] Creating payload profile");
    openPayloadModal();
}
window.createPayloadProfile = createPayloadProfile;