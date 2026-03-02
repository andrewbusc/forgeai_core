const state = {
  user: null,
  organizations: [],
  activeOrgId: "",
  activeWorkspaceId: "",
  templates: [],
  providers: [],
  defaultProviderId: "",
  projects: [],
  activeProject: null,
  tree: [],
  activeFilePath: "",
  commits: [],
  gitDiff: "",
  deployments: [],
  activeDeploymentId: "",
  deploymentLogs: "",
  agentRuns: [],
  runHistoryFilters: {
    search: "",
    tab: "all",
    profile: "all"
  },
  expandedText: {},
  activeRunId: "",
  activeRunDetail: null,
  activeRunValidation: null,
  runDrawerOpen: false,
  sidebarCollapsed: false,
  activeStage: "build"
};
let uiBusy = false;
const SIDEBAR_STORAGE_KEY = "deeprun_sidebar_collapsed_v1";

const el = {
  appShell: document.querySelector(".app-shell"),
  homeScreen: document.getElementById("home-screen"),
  dashboardScreen: document.getElementById("dashboard-screen"),
  sidebarToggle: document.getElementById("sidebar-toggle"),
  sidebarToggleLabel: document.getElementById("sidebar-toggle-label"),
  authGuest: document.getElementById("auth-guest"),
  authUser: document.getElementById("auth-user"),
  authForm: document.getElementById("auth-form"),
  authMode: document.getElementById("auth-mode"),
  authNameWrap: document.getElementById("auth-name-wrap"),
  authOrgWrap: document.getElementById("auth-org-wrap"),
  authWorkspaceWrap: document.getElementById("auth-workspace-wrap"),
  authName: document.getElementById("auth-name"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authOrgName: document.getElementById("auth-org-name"),
  authWorkspaceName: document.getElementById("auth-workspace-name"),
  authUserInfo: document.getElementById("auth-user-info"),
  logoutBtn: document.getElementById("logout-btn"),

  orgCard: document.getElementById("org-card"),
  createForm: document.getElementById("create-project-form"),
  projectsCard: document.getElementById("projects-card"),

  orgSelect: document.getElementById("org-select"),
  workspaceSelect: document.getElementById("workspace-select"),
  createOrgForm: document.getElementById("create-org-form"),
  newOrgName: document.getElementById("new-org-name"),
  createWorkspaceForm: document.getElementById("create-workspace-form"),
  newWorkspaceName: document.getElementById("new-workspace-name"),
  addMemberForm: document.getElementById("add-member-form"),
  memberEmail: document.getElementById("member-email"),
  memberRole: document.getElementById("member-role"),

  projectName: document.getElementById("project-name"),
  projectDescription: document.getElementById("project-description"),
  templateSelect: document.getElementById("template-select"),
  projectList: document.getElementById("project-list"),
  refreshProjects: document.getElementById("refresh-projects"),

  activeProjectName: document.getElementById("active-project-name"),
  activeProjectMeta: document.getElementById("active-project-meta"),
  dashboardMetrics: document.getElementById("dashboard-metrics"),
  stageCaption: document.getElementById("stage-caption"),
  stageNav: document.getElementById("stage-nav"),
  stageViews: Array.from(document.querySelectorAll(".stage-view")),
  providerSelect: document.getElementById("provider-select"),
  modelInput: document.getElementById("model-input"),
  promptInput: document.getElementById("prompt-input"),
  generateBtn: document.getElementById("generate-btn"),
  chatBtn: document.getElementById("chat-btn"),
  deployBtn: document.getElementById("deploy-btn"),
  deployCustomDomain: document.getElementById("deploy-custom-domain"),
  statusLine: document.getElementById("status-line"),
  fileTree: document.getElementById("file-tree"),
  refreshFiles: document.getElementById("refresh-files"),
  editorTitle: document.getElementById("editor-title"),
  fileEditor: document.getElementById("file-editor"),
  saveFile: document.getElementById("save-file"),
  buildOverview: document.getElementById("build-overview"),
  buildLatestActivity: document.getElementById("build-latest-activity"),
  historyList: document.getElementById("history-list"),
  refreshRuns: document.getElementById("refresh-runs"),
  runSearchInput: document.getElementById("run-search-input"),
  runSearchClear: document.getElementById("run-search-clear"),
  runStatusTabs: document.getElementById("run-status-tabs"),
  runProfileFilters: document.getElementById("run-profile-filters"),
  runList: document.getElementById("run-list"),
  validateSummary: document.getElementById("validate-summary"),
  runDetail: document.getElementById("run-detail"),
  validateRun: document.getElementById("validate-run"),
  resumeRun: document.getElementById("resume-run"),
  runDrawerBackdrop: document.getElementById("run-drawer-backdrop"),
  runDrawer: document.getElementById("run-drawer"),
  runDrawerClose: document.getElementById("run-drawer-close"),
  runDrawerTitle: document.getElementById("run-drawer-title"),
  runDrawerSubtitle: document.getElementById("run-drawer-subtitle"),
  runDrawerSummary: document.getElementById("run-drawer-summary"),
  runDrawerValidation: document.getElementById("run-drawer-validation"),
  runDrawerSteps: document.getElementById("run-drawer-steps"),

  refreshGit: document.getElementById("refresh-git"),
  gitList: document.getElementById("git-list"),
  gitDiff: document.getElementById("git-diff"),
  refreshDeployments: document.getElementById("refresh-deployments"),
  deployEligibility: document.getElementById("deploy-eligibility"),
  deploymentList: document.getElementById("deployment-list"),
  deploymentLogs: document.getElementById("deployment-logs"),
  manualCommitForm: document.getElementById("manual-commit-form"),
  manualCommitMessage: document.getElementById("manual-commit-message")
};

let refreshInFlight = null;
let deploymentPollTimer = null;
let deploymentPollInFlight = false;
const stageCopy = {
  build: "Shape the request, choose the model, and queue a governed build.",
  review: "Inspect files, activity, and commits before you trust the result.",
  validate: "Use run detail, validation, and stub debt to judge release readiness.",
  deploy: "Only completed, validated runs should move into production."
};

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function setStatus(text, kind = "info") {
  el.statusLine.textContent = text;

  if (kind === "error") {
    el.statusLine.style.color = "#ff9898";
    return;
  }

  if (kind === "success") {
    el.statusLine.style.color = "#74ffd6";
    return;
  }

  el.statusLine.style.color = "#a7bfd8";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isAuthEndpoint(path) {
  return path.startsWith("/api/auth/");
}

function isRefreshablePath(path) {
  if (!path.startsWith("/api/")) {
    return false;
  }

  if (!isAuthEndpoint(path)) {
    return true;
  }

  return path === "/api/auth/me";
}

async function tryRefreshSession() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Session refresh failed.");
    }

    return true;
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function api(path, options = {}, canRefresh = true) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include"
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && canRefresh && isRefreshablePath(path)) {
      try {
        await tryRefreshSession();
        return api(path, options, false);
      } catch {
        clearSession(false);
      }
    }

    const details = Array.isArray(payload.details) ? ` (${payload.details.join(", ")})` : "";
    throw new Error((payload.error || `Request failed (${response.status})`) + details);
  }

  return payload;
}

function clearSession(resetStatus = true) {
  stopDeploymentPolling();

  state.user = null;
  state.organizations = [];
  state.activeOrgId = "";
  state.activeWorkspaceId = "";
  state.projects = [];
  state.defaultProviderId = "";
  state.activeProject = null;
  state.tree = [];
  state.activeFilePath = "";
  state.commits = [];
  state.gitDiff = "";
  state.deployments = [];
  state.activeDeploymentId = "";
  state.deploymentLogs = "";
  state.agentRuns = [];
  state.runHistoryFilters = {
    search: "",
    tab: "all",
    profile: "all"
  };
  state.expandedText = {};
  state.activeRunId = "";
  state.activeRunDetail = null;
  state.activeRunValidation = null;
  state.runDrawerOpen = false;
  state.activeStage = "build";

  renderAuthMode();
  renderAuthState();
  renderOrgOptions();
  renderStageViews();
  renderProjects();
  renderTree();
  renderHistory();
  renderAgentRuns();
  renderRunDetail();
  renderGit();
  renderDeployments();
  renderDashboardMetrics();
  syncProjectHeader();

  if (resetStatus) {
    setStatus("Signed out.", "info");
  }
}

function getActiveOrganization() {
  return state.organizations.find((item) => item.id === state.activeOrgId) || null;
}

function getActiveWorkspace() {
  const org = getActiveOrganization();
  if (!org) {
    return null;
  }
  return org.workspaces.find((item) => item.id === state.activeWorkspaceId) || null;
}

function loadSidebarCollapsedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsedPreference() {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, state.sidebarCollapsed ? "true" : "false");
  } catch {
    // Ignore localStorage failures.
  }
}

function renderSidebarState() {
  el.appShell?.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  if (el.sidebarToggle) {
    el.sidebarToggle.setAttribute("aria-pressed", state.sidebarCollapsed ? "true" : "false");
  }
  if (el.sidebarToggleLabel) {
    el.sidebarToggleLabel.textContent = state.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar";
  }
}

function getRunExecutionProfile(run) {
  const metadata = run && typeof run.metadata === "object" ? run.metadata : null;
  const executionConfig = metadata && typeof metadata.executionConfig === "object" ? metadata.executionConfig : null;
  return executionConfig?.profile || "full";
}

function getRunStubDebtOpen(run) {
  const value =
    run?.stubDebt?.openCount ??
    run?.stubDebtOpenCount ??
    run?.stubDebt ??
    run?.stubDebtCount ??
    0;

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatStatusLabel(value, fallback = "unknown") {
  const text = String(value || fallback);
  return text.replaceAll("_", " ");
}

function formatStatusClass(value, fallback = "unknown") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");
}

function renderExpandableText(text, key, options = {}) {
  const {
    tag = "p",
    className = "",
    previewLength = 120
  } = options;

  const value = String(text || "").trim();
  if (!value) {
    return `<${tag} class="${className}">-</${tag}>`;
  }

  if (value.length <= previewLength) {
    return `<${tag} class="${className}">${escapeHtml(value)}</${tag}>`;
  }

  const expanded = Boolean(state.expandedText[key]);
  const classes = ["expandable-copy", className].filter(Boolean).join(" ");

  return `<div class="expandable-block ${expanded ? "expanded" : ""}">
    <${tag} class="${classes}">${escapeHtml(value)}</${tag}>
    <button type="button" class="expand-toggle ghost-btn" data-expand-toggle="${escapeHtml(key)}">${expanded ? "Less" : "More"}</button>
  </div>`;
}

function getValidationChip(validationStatus) {
  if (validationStatus === "passed") {
    return {
      label: "validated",
      className: "validation-passed"
    };
  }

  if (validationStatus === "failed") {
    return {
      label: "validation failed",
      className: "validation-failed"
    };
  }

  return {
    label: "not validated",
    className: "validation-pending"
  };
}

function runMatchesTab(run, tab) {
  if (tab === "active") {
    return run.status === "queued" || run.status === "running" || run.status === "paused" || run.status === "planned";
  }

  if (tab === "attention") {
    return run.status === "failed" || run.status === "cancelled" || run.validationStatus === "failed" || getRunStubDebtOpen(run) > 0;
  }

  if (tab === "complete") {
    return run.status === "complete";
  }

  return true;
}

function getFilteredRuns() {
  const search = state.runHistoryFilters.search.trim().toLowerCase();
  return state.agentRuns.filter((run) => {
    if (!runMatchesTab(run, state.runHistoryFilters.tab)) {
      return false;
    }

    if (state.runHistoryFilters.profile !== "all" && getRunExecutionProfile(run) !== state.runHistoryFilters.profile) {
      return false;
    }

    if (!search) {
      return true;
    }

    const goal = String(run.goal || "").toLowerCase();
    const branch = String(run.runBranch || "").toLowerCase();
    const id = String(run.id || "").toLowerCase();
    const status = String(run.status || "").toLowerCase();
    return goal.includes(search) || branch.includes(search) || id.includes(search) || status.includes(search);
  });
}

function setRunDrawerOpen(open) {
  state.runDrawerOpen = open;
  el.runDrawer?.classList.toggle("hidden", !open);
  el.runDrawerBackdrop?.classList.toggle("hidden", !open);
  if (el.runDrawer) {
    el.runDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  }
}

function deploymentIsInProgress(status) {
  return status === "queued" || status === "building" || status === "pushing" || status === "launching";
}

function hasInProgressDeployments() {
  return state.deployments.some((deployment) => deploymentIsInProgress(deployment.status));
}

function stopDeploymentPolling() {
  if (deploymentPollTimer) {
    clearInterval(deploymentPollTimer);
    deploymentPollTimer = null;
  }
}

function syncDeploymentPolling() {
  const shouldPoll = Boolean(state.activeProject) && hasInProgressDeployments();

  if (!shouldPoll) {
    stopDeploymentPolling();
    return;
  }

  if (deploymentPollTimer) {
    return;
  }

  deploymentPollTimer = setInterval(() => {
    void pollDeploymentUpdates();
  }, 4500);
}

async function pollDeploymentUpdates() {
  if (deploymentPollInFlight || !state.activeProject) {
    return;
  }

  deploymentPollInFlight = true;

  try {
    await loadDeployments(true);
  } catch {
    // Ignore transient polling errors and keep UI responsive.
  } finally {
    deploymentPollInFlight = false;
  }
}

function renderAuthMode() {
  const registerMode = el.authMode.value === "register";
  el.authNameWrap.classList.toggle("hidden", !registerMode);
  el.authOrgWrap.classList.toggle("hidden", !registerMode);
  el.authWorkspaceWrap.classList.toggle("hidden", !registerMode);
}

function renderAuthState() {
  const authenticated = Boolean(state.user);

  el.authGuest.classList.toggle("hidden", authenticated);
  el.authUser.classList.toggle("hidden", !authenticated);
  el.orgCard.classList.toggle("hidden", !authenticated);
  el.createForm.classList.toggle("hidden", !authenticated);
  el.projectsCard.classList.toggle("hidden", !authenticated);
  el.homeScreen?.classList.toggle("hidden", authenticated);
  el.dashboardScreen?.classList.toggle("hidden", !authenticated);

  if (authenticated) {
    el.authUserInfo.textContent = `${state.user.name} · ${state.user.email}`;
  } else {
    el.authUserInfo.textContent = "";
  }

  renderDashboardMetrics();
}

function renderOrgOptions() {
  if (!state.user) {
    el.orgSelect.innerHTML = "";
    el.workspaceSelect.innerHTML = "";
    return;
  }

  if (!state.organizations.length) {
    el.orgSelect.innerHTML = "";
    el.workspaceSelect.innerHTML = "";
    return;
  }

  if (!state.organizations.some((org) => org.id === state.activeOrgId)) {
    state.activeOrgId = state.organizations[0].id;
  }

  el.orgSelect.innerHTML = state.organizations
    .map((org) => `<option value="${org.id}">${escapeHtml(org.name)} (${escapeHtml(org.role)})</option>`)
    .join("");
  el.orgSelect.value = state.activeOrgId;

  const org = getActiveOrganization();
  const workspaces = org?.workspaces || [];

  if (!workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) {
    state.activeWorkspaceId = workspaces[0]?.id || "";
  }

  el.workspaceSelect.innerHTML = workspaces
    .map((workspace) => `<option value="${workspace.id}">${escapeHtml(workspace.name)}</option>`)
    .join("");

  if (state.activeWorkspaceId) {
    el.workspaceSelect.value = state.activeWorkspaceId;
  }
}

function renderTemplateOptions() {
  el.templateSelect.innerHTML = state.templates
    .map((template) => `<option value="${template.id}">${template.name}</option>`)
    .join("");

  const selected = state.templates.find((template) => template.id === el.templateSelect.value) || state.templates[0];

  if (selected && !el.promptInput.value.trim()) {
    el.promptInput.value = selected.recommendedPrompt;
  }
}

function renderProviderOptions() {
  if (!state.providers.length) {
    el.providerSelect.innerHTML = "";
    el.modelInput.placeholder = "Optional model override";
    return;
  }

  el.providerSelect.innerHTML = state.providers
    .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
    .join("");

  const selected =
    state.providers.find((provider) => provider.id === el.providerSelect.value) ||
    state.providers.find((provider) => provider.id === state.defaultProviderId) ||
    state.providers[0];

  if (selected) {
    el.providerSelect.value = selected.id;
    el.modelInput.placeholder = selected.defaultModel;
  }
}

function renderProjects() {
  if (!state.user) {
    el.projectList.innerHTML = `<div class="project-card"><small>Sign in to view projects.</small></div>`;
    return;
  }

  if (!state.activeWorkspaceId) {
    el.projectList.innerHTML = `<div class="project-card"><small>Select a workspace.</small></div>`;
    return;
  }

  if (!state.projects.length) {
    el.projectList.innerHTML = `<div class="project-card"><small>No projects yet in this workspace.</small></div>`;
    return;
  }

  el.projectList.innerHTML = state.projects
    .map((project) => {
      const activeClass = state.activeProject?.id === project.id ? "active" : "";
      return `<button class="project-card ${activeClass}" data-project-id="${project.id}">
        <strong>${escapeHtml(project.name)}</strong>
        <small>${escapeHtml(project.templateId)} · ${new Date(project.updatedAt).toLocaleString()}</small>
      </button>`;
    })
    .join("");

  const buttons = el.projectList.querySelectorAll("[data-project-id]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-project-id");
      if (id) {
        void selectProject(id);
      }
    });
  }
}

function setActiveStage(stage) {
  if (!Object.prototype.hasOwnProperty.call(stageCopy, stage)) {
    return;
  }

  state.activeStage = stage;
  renderStageViews();
}

function renderStageViews() {
  if (el.stageCaption) {
    el.stageCaption.textContent = stageCopy[state.activeStage] || stageCopy.build;
  }

  const buttons = el.stageNav ? Array.from(el.stageNav.querySelectorAll("[data-stage]")) : [];
  for (const button of buttons) {
    const isActive = button.getAttribute("data-stage") === state.activeStage;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  for (const panel of el.stageViews) {
    panel.classList.toggle("hidden", panel.id !== `stage-${state.activeStage}`);
  }
}

function flattenTree(nodes, depth = 0, lines = []) {
  for (const node of nodes) {
    lines.push({
      ...node,
      depth
    });

    if (node.type === "directory" && Array.isArray(node.children)) {
      flattenTree(node.children, depth + 1, lines);
    }
  }

  return lines;
}

function renderTree() {
  if (!state.activeProject) {
    el.fileTree.innerHTML = "";
    return;
  }

  const rows = flattenTree(state.tree);

  if (!rows.length) {
    el.fileTree.innerHTML = `<div class="folder-node">No files yet.</div>`;
    return;
  }

  el.fileTree.innerHTML = rows
    .map((row) => {
      const indent = Math.min(row.depth, 4);
      const indentClass = `tree-indent-${indent}`;

      if (row.type === "directory") {
        return `<div class="folder-node ${indentClass}">[DIR] ${escapeHtml(row.path || row.name)}</div>`;
      }

      const activeClass = row.path === state.activeFilePath ? "active" : "";
      return `<div class="file-node ${indentClass} ${activeClass}" data-file-path="${row.path}">${escapeHtml(row.path)}</div>`;
    })
    .join("");

  const fileNodes = el.fileTree.querySelectorAll("[data-file-path]");
  for (const node of fileNodes) {
    node.addEventListener("click", () => {
      const filePath = node.getAttribute("data-file-path");
      if (filePath) {
        void loadFile(filePath);
      }
    });
  }
}

function renderHistory() {
  if (!state.activeProject) {
    el.historyList.innerHTML = "";
    if (el.buildLatestActivity) {
      el.buildLatestActivity.innerHTML = `<div class="history-item empty-state"><p>Select a project to see recent work.</p></div>`;
    }
    return;
  }

  if (!state.activeProject.history.length) {
    const empty = `<div class="history-item empty-state"><p>No activity yet.</p></div>`;
    el.historyList.innerHTML = empty;
    if (el.buildLatestActivity) {
      el.buildLatestActivity.innerHTML = empty;
    }
    return;
  }

  const items = state.activeProject.history;
  const renderItems = (entries) =>
    entries
      .map((item) => {
      const files = item.filesChanged.length ? item.filesChanged.join(", ") : "No file changes";
      const commit = item.commitHash ? `Commit ${item.commitHash}` : "No commit";
      const summaryKey = `history-summary-${item.createdAt}-${item.kind}`;
      const filesKey = `history-files-${item.createdAt}-${item.kind}`;
      return `<article class="history-item">
        <strong>${escapeHtml(item.kind.toUpperCase())} · ${escapeHtml(item.provider)}:${escapeHtml(item.model)}</strong>
        ${renderExpandableText(item.summary, summaryKey, { className: "history-copy", previewLength: 140 })}
        <small>${new Date(item.createdAt).toLocaleString()} · ${escapeHtml(commit)}</small>
        ${renderExpandableText(files, filesKey, { className: "history-copy", previewLength: 120 })}
      </article>`;
      })
      .join("");

  el.historyList.innerHTML = renderItems(items.slice(0, 25));
  if (el.buildLatestActivity) {
    el.buildLatestActivity.innerHTML = renderItems(items.slice(0, 3));
  }
}

function canResumeRun(run) {
  if (!run) {
    return false;
  }

  return run.status === "failed" || run.status === "paused" || run.status === "planned";
}

function getSelectedRunForDeploy() {
  if (!state.activeRunId) {
    return null;
  }

  const detailRun = state.activeRunDetail?.run;
  if (detailRun?.id === state.activeRunId) {
    return detailRun;
  }

  return state.agentRuns.find((run) => run.id === state.activeRunId) || null;
}

function getDeployEligibility() {
  if (!state.activeProject) {
    return { ok: false, reason: "Select a project first.", run: null };
  }

  if (!state.activeRunId) {
    return { ok: false, reason: "Select a run first.", run: null };
  }

  const run = getSelectedRunForDeploy();
  if (!run) {
    return { ok: false, reason: "Select a run first.", run: null };
  }

  if (run.status !== "complete") {
    return { ok: false, reason: "Selected run must be complete before deploy.", run };
  }

  if (run.validationStatus !== "passed") {
    return { ok: false, reason: "Selected run must pass validation before deploy.", run };
  }

  return { ok: true, reason: "", run };
}

function syncDeployButton() {
  el.deployBtn.disabled = uiBusy || !getDeployEligibility().ok;
}

function renderRunHistoryControls() {
  if (el.runSearchInput) {
    el.runSearchInput.value = state.runHistoryFilters.search;
  }

  el.runSearchClear?.classList.toggle("hidden", !state.runHistoryFilters.search.trim());

  const tabButtons = el.runStatusTabs ? Array.from(el.runStatusTabs.querySelectorAll("[data-run-tab]")) : [];
  for (const button of tabButtons) {
    button.classList.toggle("active", button.getAttribute("data-run-tab") === state.runHistoryFilters.tab);
  }

  const profileButtons = el.runProfileFilters ? Array.from(el.runProfileFilters.querySelectorAll("[data-run-profile]")) : [];
  for (const button of profileButtons) {
    button.classList.toggle("active", button.getAttribute("data-run-profile") === state.runHistoryFilters.profile);
  }
}

function renderRunDrawer() {
  if (!el.runDrawer) {
    return;
  }

  const detail = state.activeRunDetail;
  const run = detail?.run || null;
  const steps = Array.isArray(detail?.steps) ? detail.steps.slice(-10) : [];
  const validation = state.activeRunValidation && state.activeRunValidation.runId === run?.id ? state.activeRunValidation.validation : null;
  const stubDebt = detail?.stubDebt || null;

  if (!run) {
    el.runDrawerTitle.textContent = "No run selected";
    el.runDrawerSubtitle.textContent = "Choose a run from Run History.";
    el.runDrawerSummary.innerHTML = `<div class="drawer-empty">Select a run to inspect its profile, validation, debt status, and recent steps.</div>`;
    el.runDrawerValidation.innerHTML = `<div class="drawer-empty">No validation data yet.</div>`;
    el.runDrawerSteps.innerHTML = `<div class="drawer-empty">No step trace yet.</div>`;
    setRunDrawerOpen(false);
    return;
  }

  el.runDrawerTitle.textContent = `Run ${run.id.slice(0, 8)}`;
  el.runDrawerSubtitle.innerHTML = renderExpandableText(run.goal || "No goal recorded for this run.", `drawer-goal-${run.id}`, {
    tag: "span",
    className: "drawer-subtitle-copy",
    previewLength: 180
  });

  const summaryCards = [
    {
      label: "Status",
      value: formatStatusLabel(run.status),
      detail: `Profile ${getRunExecutionProfile(run)}`
    },
    {
      label: "Branch",
      value: run.runBranch || "No branch",
      detail: run.currentCommitHash || "No commit hash yet"
    },
    {
      label: "Validation",
      value: validation ? (validation.ok ? "Passed" : "Failed") : formatStatusLabel(run.validationStatus || "not run"),
      detail: validation?.summary || "No stored validation result."
    },
    {
      label: "Stub Debt",
      value: String(stubDebt?.openCount || 0),
      detail: stubDebt?.lastPaydownAction || "No paydown activity recorded."
    }
  ];

  el.runDrawerSummary.innerHTML = summaryCards
    .map(
      (card) => `<article class="drawer-summary-card">
        <strong>${escapeHtml(card.label)}</strong>
        <p>${escapeHtml(card.value)}</p>
        ${renderExpandableText(card.detail, `drawer-summary-${run.id}-${card.label}`, {
          tag: "small",
          className: "drawer-detail-copy",
          previewLength: 110
        })}
      </article>`
    )
    .join("");

  el.runDrawerValidation.innerHTML = [
    `<article class="drawer-item">
      <div class="drawer-item-head">
        <strong>Validation Summary</strong>
        <span class="status-pill status-${escapeHtml(
          formatStatusClass(validation ? (validation.ok ? "passed" : "failed") : run.validationStatus || "queued")
        )}">${escapeHtml(validation ? (validation.ok ? "passed" : "failed") : formatStatusLabel(run.validationStatus || "not run"))}</span>
      </div>
      ${renderExpandableText(validation?.summary || "Validate Output to persist the latest validation snapshot.", `drawer-validation-${run.id}`, {
        className: "drawer-detail-copy",
        previewLength: 140
      })}
      <small>Current step ${escapeHtml(String(run.currentStepIndex || 0))} · worktree ${escapeHtml(run.worktreePath || "not yet assigned")}</small>
    </article>`,
    `<article class="drawer-item">
      <div class="drawer-item-head">
        <strong>Debt Resolution</strong>
      </div>
      <p>${escapeHtml(String(stubDebt?.openCount || 0))} open debt items</p>
      ${renderExpandableText(stubDebt?.lastStubPath || stubDebt?.lastPaydownAction || "No debt resolution artifact recorded.", `drawer-debt-${run.id}`, {
        tag: "small",
        className: "drawer-detail-copy",
        previewLength: 110
      })}
    </article>`
  ].join("");

  if (!steps.length) {
    el.runDrawerSteps.innerHTML = `<div class="drawer-empty">No step trace recorded for this run yet.</div>`;
  } else {
    el.runDrawerSteps.innerHTML = steps
      .map((step) => {
        const started = step.startedAt || step.started_at || step.createdAt || step.updatedAt || "";
        const tool = step.tool || step.stepId || "step";
        const status = formatStatusLabel(step.status || "pending");
        const commit = step.commitHash ? `commit ${step.commitHash}` : "no commit";
        return `<article class="drawer-item">
          <div class="drawer-item-head">
            <strong>${escapeHtml(tool)}</strong>
            <span class="status-pill status-${escapeHtml(formatStatusClass(step.status || "queued"))}">${escapeHtml(status)}</span>
          </div>
          ${renderExpandableText(commit, `drawer-step-${run.id}-${step.stepIndex || step.stepId || tool}`, {
            className: "drawer-detail-copy",
            previewLength: 90
          })}
          <small>${escapeHtml(started ? new Date(started).toLocaleString() : "No timestamp")} · step ${escapeHtml(String(step.stepIndex ?? "-"))}</small>
        </article>`;
      })
      .join("");
  }

  setRunDrawerOpen(state.runDrawerOpen);
}

function renderAgentRuns() {
  renderRunHistoryControls();

  if (!state.activeProject) {
    el.runList.innerHTML = "";
    renderDashboardMetrics();
    renderBuildOverview();
    renderDeployEligibility();
    syncDeployButton();
    return;
  }

  if (!state.agentRuns.length) {
    el.runList.innerHTML = `<div class="history-item empty-state"><p>No agent runs yet.</p></div>`;
    renderDashboardMetrics();
    renderBuildOverview();
    renderDeployEligibility();
    syncDeployButton();
    return;
  }

  const filteredRuns = getFilteredRuns();
  if (!filteredRuns.length) {
    el.runList.innerHTML = `<div class="history-item empty-state"><p>No runs match the current history filters.</p></div>`;
    renderDashboardMetrics();
    renderBuildOverview();
    renderDeployEligibility();
    syncDeployButton();
    return;
  }

  el.runList.innerHTML = filteredRuns
    .map((run) => {
      const activeClass = run.id === state.activeRunId ? "active" : "";
      const branch = run.runBranch ? ` · ${escapeHtml(run.runBranch)}` : "";
      const updatedAt = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "unknown";
      const currentStep = Number.isFinite(run.currentStepIndex) ? run.currentStepIndex : 0;
      const totalSteps = Array.isArray(run.plan?.steps) ? run.plan.steps.length : 0;
      const stubDebt = getRunStubDebtOpen(run);
      const profile = getRunExecutionProfile(run);
      const validationChip = getValidationChip(run.validationStatus);

      return `<article class="run-card ${activeClass}" data-run-open="${run.id}">
        <div class="run-primary">
          <div>
            <strong>Run ${escapeHtml(run.id.slice(0, 8))}</strong>
            <div class="run-secondary">${updatedAt}${branch}</div>
          </div>
          <span class="status-pill status-${escapeHtml(formatStatusClass(run.status))}">${escapeHtml(formatStatusLabel(run.status))}</span>
        </div>
        <div class="run-chip-row">
          <span class="run-chip">profile ${escapeHtml(profile)}</span>
          <span class="run-chip ${escapeHtml(validationChip.className)}">${escapeHtml(validationChip.label)}</span>
          <span class="run-chip">steps ${escapeHtml(String(currentStep))}/${escapeHtml(String(totalSteps))}</span>
          <span class="run-chip">${escapeHtml(String(stubDebt))} stub debt</span>
        </div>
        <div class="run-meta-row">
          <span>${escapeHtml(run.runBranch || "No dedicated branch")}</span>
        </div>
        ${renderExpandableText(run.goal || "No goal recorded", `run-goal-${run.id}`, {
          className: "run-goal-copy",
          previewLength: 120
        })}
        <div class="run-actions">
          <button type="button" class="ghost-btn" data-run-id="${run.id}">Inspect Run</button>
        </div>
      </article>`;
    })
    .join("");

  const cards = el.runList.querySelectorAll("[data-run-open]");
  for (const card of cards) {
    card.addEventListener("click", () => {
      const runId = card.getAttribute("data-run-open");
      if (runId) {
        void loadAgentRunDetail(runId, false, true);
      }
    });
  }

  const buttons = el.runList.querySelectorAll("[data-run-id]");
  for (const button of buttons) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const runId = button.getAttribute("data-run-id");
      if (runId) {
        void loadAgentRunDetail(runId, false, true);
      }
    });
  }

  renderDashboardMetrics();
  renderBuildOverview();
  renderDeployEligibility();
  syncDeployButton();
}

function renderRunDetail() {
  if (!state.activeProject || !state.activeRunDetail?.run) {
    el.runDetail.textContent = "Select a run to view a quick trace, then open the inspector for the full detail panel.";
    el.validateRun.disabled = true;
    el.resumeRun.disabled = true;
    renderDashboardMetrics();
    renderValidateSummary();
    renderRunDrawer();
    syncDeployButton();
    return;
  }

  const run = state.activeRunDetail.run;
  const steps = Array.isArray(state.activeRunDetail.steps) ? state.activeRunDetail.steps : [];
  const lines = [];

  lines.push(`runId: ${run.id}`);
  lines.push(`status: ${run.status}`);
  lines.push(`goal: ${run.goal}`);
  lines.push(`currentStepIndex: ${run.currentStepIndex}`);
  lines.push(`runBranch: ${run.runBranch || "-"}`);
  lines.push(`profile: ${getRunExecutionProfile(run)}`);
  lines.push(`worktreePath: ${run.worktreePath || "-"}`);
  lines.push(`currentCommitHash: ${run.currentCommitHash || "-"}`);

  const validation =
    state.activeRunValidation && state.activeRunValidation.runId === run.id ? state.activeRunValidation.validation : null;

  if (validation) {
    lines.push("");
    lines.push(`validation.ok: ${validation.ok}`);
    lines.push(`validation.summary: ${validation.summary}`);
    lines.push(`validation.blockingCount: ${validation.blockingCount}`);
    lines.push(`validation.warningCount: ${validation.warningCount}`);
    const checkRows = Array.isArray(validation.checks) ? validation.checks : [];
    for (const check of checkRows) {
      lines.push(`  - ${check.id}: ${check.status} (${check.message})`);
    }
  }

  lines.push("");
  lines.push(`recent steps (${steps.length}):`);

  const recentSteps = steps.slice(-8);
  for (const step of recentSteps) {
    const commitText = step.commitHash ? ` commit=${step.commitHash}` : "";
    lines.push(`  #${step.stepIndex} ${step.stepId} [${step.status}] ${step.tool}${commitText}`);
  }

  el.runDetail.textContent = lines.join("\n");
  el.validateRun.disabled = run.status === "running";
  el.resumeRun.disabled = !canResumeRun(run);
  renderDashboardMetrics();
  renderValidateSummary();
  renderRunDrawer();
  syncDeployButton();
}

function renderGit() {
  if (!state.activeProject) {
    el.gitList.innerHTML = "";
    el.gitDiff.textContent = "";
    return;
  }

  if (!state.commits.length) {
    el.gitList.innerHTML = `<div class="git-item"><p>No commits yet.</p></div>`;
  } else {
    el.gitList.innerHTML = state.commits
      .map(
        (commit) => `<article class="git-item">
        <strong>${escapeHtml(commit.shortHash)} · ${escapeHtml(commit.subject)}</strong>
        <small>${new Date(commit.date).toLocaleString()} · ${escapeHtml(commit.author)}</small>
        <p>
          <button type="button" class="ghost-btn" data-commit-hash="${escapeHtml(commit.hash)}">Show Diff</button>
        </p>
      </article>`
      )
      .join("");

    const buttons = el.gitList.querySelectorAll("[data-commit-hash]");
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const hash = button.getAttribute("data-commit-hash");
        if (hash) {
          void loadDiffForCommit(hash);
        }
      });
    }
  }

  el.gitDiff.textContent = state.gitDiff;
}

function renderDeployments() {
  if (!state.activeProject) {
    el.deploymentList.innerHTML = "";
    el.deploymentLogs.textContent = "";
    renderDashboardMetrics();
    renderDeployEligibility();
    return;
  }

  if (!state.deployments.length) {
    el.deploymentList.innerHTML = `<div class="git-item"><p>No deployments yet.</p></div>`;
    el.deploymentLogs.textContent = "";
    renderDashboardMetrics();
    renderDeployEligibility();
    return;
  }

  el.deploymentList.innerHTML = state.deployments
    .map((deployment) => {
      const activeClass = deployment.id === state.activeDeploymentId ? "active" : "";
      const statusClass = `status-${deployment.status}`;
      const createdAt = new Date(deployment.createdAt).toLocaleString();
      const imageRef = deployment.imageRef || "pending-image";
      const url = deployment.customDomain ? `https://${deployment.customDomain}` : deployment.publicUrl;
      const hostPort = deployment.hostPort ? `localhost:${deployment.hostPort}` : "pending";
      const activeTag = deployment.isActive ? " · active" : "";
      const errorBlock = deployment.errorMessage ? `<p class="deploy-error">${escapeHtml(deployment.errorMessage)}</p>` : "";

      return `<article class="git-item deployment-item ${activeClass}">
        <strong>
          <span class="status-pill ${statusClass}">${escapeHtml(deployment.status)}</span>
          ${escapeHtml(createdAt)}${escapeHtml(activeTag)}
        </strong>
        <small>${escapeHtml(imageRef)}</small>
        <p>${escapeHtml(url)} · ${escapeHtml(hostPort)}</p>
        ${errorBlock}
        <p>
          <button type="button" class="ghost-btn" data-deployment-id="${deployment.id}">Logs</button>
        </p>
      </article>`;
    })
    .join("");

  const buttons = el.deploymentList.querySelectorAll("[data-deployment-id]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const deploymentId = button.getAttribute("data-deployment-id");
      if (deploymentId) {
        void loadDeploymentLogs(deploymentId);
      }
    });
  }

  if (state.activeDeploymentId) {
    el.deploymentLogs.textContent = state.deploymentLogs || "No logs yet.";
  } else {
    el.deploymentLogs.textContent = "Select a deployment to view logs.";
  }

  renderDashboardMetrics();
  renderDeployEligibility();
}

function syncProjectHeader() {
  if (!state.activeProject) {
    el.activeProjectName.textContent = "No project selected";

    if (!state.user) {
      el.activeProjectMeta.textContent = "Authenticate and choose a workspace to begin.";
      renderDashboardMetrics();
      renderBuildOverview();
      renderValidateSummary();
      renderDeployEligibility();
      return;
    }

    const workspace = getActiveWorkspace();
    el.activeProjectMeta.textContent = workspace
      ? `Workspace: ${workspace.name} · Create or select a project.`
      : "Select a workspace to begin.";
    renderDashboardMetrics();
    renderBuildOverview();
    renderValidateSummary();
    renderDeployEligibility();
    return;
  }

  const workspace = getActiveWorkspace();
  const workspaceName = workspace ? workspace.name : "Unknown workspace";

  el.activeProjectName.textContent = state.activeProject.name;
  el.activeProjectMeta.textContent = `${state.activeProject.templateId} • ${workspaceName} • Updated ${new Date(
    state.activeProject.updatedAt
  ).toLocaleString()}`;
  renderDashboardMetrics();
  renderBuildOverview();
  renderValidateSummary();
  renderDeployEligibility();
}

function setBusy(busy) {
  uiBusy = busy;
  el.generateBtn.disabled = busy;
  el.chatBtn.disabled = busy;
  el.saveFile.disabled = busy;
  renderDashboardMetrics();
  renderBuildOverview();
  renderDeployEligibility();
  syncDeployButton();
}

function renderDashboardMetrics() {
  if (!el.dashboardMetrics) {
    return;
  }

  if (!state.user) {
    el.dashboardMetrics.innerHTML = "";
    return;
  }

  const inFlightRuns = state.agentRuns.filter((run) => run.status === "queued" || run.status === "running").length;
  const completedRuns = state.agentRuns.filter((run) => run.status === "complete").length;
  const passedRuns = state.agentRuns.filter((run) => run.validationStatus === "passed").length;
  const openStubDebt = state.activeRunDetail?.stubDebt?.openCount ?? state.agentRuns.reduce((sum, run) => sum + getRunStubDebtOpen(run), 0);
  const deploymentActive = state.deployments.filter((deployment) => deploymentIsInProgress(deployment.status)).length;
  const selectedProfile = state.activeRunDetail?.run ? getRunExecutionProfile(state.activeRunDetail.run) : "—";

  const cards = [
    {
      label: "Queue Pressure",
      value: String(inFlightRuns),
      copy: inFlightRuns ? "Queued or running runs still in flight." : "No queued or running work right now.",
      accent: inFlightRuns ? "amber" : "cyan"
    },
    {
      label: "Validated Runs",
      value: `${passedRuns}/${completedRuns || 0}`,
      copy: completedRuns ? "Completed runs that already passed validation." : "No completed runs in this project yet.",
      accent: passedRuns > 0 ? "green" : "purple"
    },
    {
      label: "Open Stub Debt",
      value: String(openStubDebt),
      copy: openStubDebt ? "Provisionally fixed debt still blocks clean promotion." : "No unresolved stub debt on the current run surface.",
      accent: openStubDebt ? "red" : "green"
    },
    {
      label: "Runtime Surface",
      value: String(deploymentActive),
      copy: state.activeProject
        ? `Selected profile ${selectedProfile}. Active deployments ${deploymentActive}.`
        : "Select a project to inspect queue, validation, and deployment state.",
      accent: deploymentActive ? "purple" : "cyan"
    }
  ];

  el.dashboardMetrics.innerHTML = cards
    .map(
      (card) => `<article class="metric-card">
        <div class="metric-head">
          <strong>${escapeHtml(card.label)}</strong>
          <span class="metric-dot metric-accent-${card.accent}"></span>
        </div>
        <p class="metric-value metric-accent-${card.accent}">${escapeHtml(card.value)}</p>
        <p class="metric-copy">${escapeHtml(card.copy)}</p>
      </article>`
    )
    .join("");
}

function renderBuildOverview() {
  if (!el.buildOverview) {
    return;
  }

  if (!state.activeProject) {
    el.buildOverview.innerHTML = `<div class="overview-card"><strong>No active project</strong><p>Pick a workspace project before launching a build.</p></div>`;
    return;
  }

  const provider = state.providers.find((entry) => entry.id === (el.providerSelect?.value || state.defaultProviderId));
  const latestRun = state.agentRuns[0] || null;
  const latestActivity = state.activeProject.history[0] || null;
  const latestProfile = latestRun ? getRunExecutionProfile(latestRun) : "ci";

  el.buildOverview.innerHTML = [
    `<div class="overview-card"><strong>Project</strong><p>${escapeHtml(state.activeProject.name)}</p><small>${escapeHtml(
      state.activeProject.templateId
    )}</small></div>`,
    `<div class="overview-card"><strong>Provider</strong><p>${escapeHtml(provider?.name || "Not configured")}</p><small>${escapeHtml(
      el.modelInput?.value.trim() || provider?.defaultModel || "Default model"
    )}</small></div>`,
    `<div class="overview-card"><strong>Latest run</strong><p>${escapeHtml(formatStatusLabel(latestRun?.status || "No run yet"))}</p>${renderExpandableText(
      latestRun ? `Run ${latestRun.id.slice(0, 8)} · profile ${latestProfile}` : "Start with a narrow build prompt.",
      `build-latest-run-${latestRun?.id || "empty"}`,
      { tag: "small", className: "overview-copy", previewLength: 90 }
    )}</div>`,
    `<div class="overview-card"><strong>Last activity</strong>${renderExpandableText(
      latestActivity?.summary || "No changes recorded yet.",
      `build-latest-activity-${latestActivity?.createdAt || "empty"}`,
      { className: "overview-copy", previewLength: 120 }
    )}<small>${latestActivity ? new Date(latestActivity.createdAt).toLocaleString() : "Ready"}</small></div>`,
    `<div class="overview-card"><strong>Workspace status</strong><p>${uiBusy ? "Running request" : "Idle"}</p>${renderExpandableText(
      uiBusy ? "A builder request is currently running." : "Queue a build, inspect files, or validate a run.",
      `build-workspace-status-${uiBusy ? "busy" : "idle"}`,
      { tag: "small", className: "overview-copy", previewLength: 90 }
    )}</div>`
  ].join("");
}

function renderValidateSummary() {
  if (!el.validateSummary) {
    return;
  }

  const run = state.activeRunDetail?.run;
  if (!run) {
    el.validateSummary.innerHTML = `<div class="overview-card"><strong>No run selected</strong><p>Select a run to inspect validation and correction history.</p></div>`;
    return;
  }

  const validation =
    state.activeRunValidation && state.activeRunValidation.runId === run.id ? state.activeRunValidation.validation : null;
  const steps = Array.isArray(state.activeRunDetail?.steps) ? state.activeRunDetail.steps : [];
  const stubDebt = state.activeRunDetail?.stubDebt || null;

  el.validateSummary.innerHTML = [
    `<div class="overview-card"><strong>Run status</strong><p>${escapeHtml(formatStatusLabel(run.status))}</p><small>Run ${escapeHtml(
      run.id.slice(0, 8)
    )}</small></div>`,
    `<div class="overview-card"><strong>Validation</strong><p>${escapeHtml(
      validation ? (validation.ok ? "Passed" : "Failed") : run.validationStatus || "Not run"
    )}</p>${renderExpandableText(validation?.summary || "Use Validate Output to persist the latest check.", `validate-summary-${run.id}`, {
      tag: "small",
      className: "overview-copy",
      previewLength: 110
    })}</div>`,
    `<div class="overview-card"><strong>Steps</strong><p>${steps.length}</p><small>Current step ${escapeHtml(
      String(run.currentStepIndex || 0)
    )}</small></div>`,
    `<div class="overview-card"><strong>Stub debt</strong><p>${escapeHtml(String(stubDebt?.openCount || 0))} open</p>${renderExpandableText(
      stubDebt?.lastPaydownAction || "No paydown activity recorded.",
      `validate-stub-debt-${run.id}`,
      { tag: "small", className: "overview-copy", previewLength: 90 }
    )}</div>`
  ].join("");
}

function renderDeployEligibility() {
  if (!el.deployEligibility) {
    return;
  }

  const eligibility = getDeployEligibility();
  const latestDeployment = state.deployments[0] || null;

  if (!state.activeProject) {
    el.deployEligibility.innerHTML = `<div class="overview-card"><strong>No project</strong><p>Select a project before evaluating deployment readiness.</p></div>`;
    return;
  }

  el.deployEligibility.innerHTML = [
    `<div class="overview-card"><strong>Eligibility</strong><p>${eligibility.ok ? "Ready to deploy" : "Not ready"}</p>${renderExpandableText(
      eligibility.reason || "Validated complete run selected.",
      `deploy-eligibility-${eligibility.run?.id || "none"}`,
      { tag: "small", className: "overview-copy", previewLength: 110 }
    )}</div>`,
    `<div class="overview-card"><strong>Selected run</strong><p>${escapeHtml(
      eligibility.run ? eligibility.run.id.slice(0, 8) : "None"
    )}</p><small>${escapeHtml(eligibility.run ? formatStatusLabel(eligibility.run.status) : "Choose a completed validated run.")}</small></div>`,
    `<div class="overview-card"><strong>Latest deployment</strong><p>${escapeHtml(
      formatStatusLabel(latestDeployment?.status || "No deployments yet")
    )}</p>${renderExpandableText(
      latestDeployment?.publicUrl || latestDeployment?.customDomain || "Queue the first deployment when ready.",
      `deploy-latest-${latestDeployment?.id || "none"}`,
      { tag: "small", className: "overview-copy", previewLength: 100 }
    )}</div>`
  ].join("");
}

async function refreshAccount() {
  const payload = await api("/api/auth/me");
  state.user = payload.user;
  state.organizations = payload.organizations || [];

  if (!state.activeOrgId || !state.organizations.some((item) => item.id === state.activeOrgId)) {
    state.activeOrgId = state.organizations[0]?.id || "";
  }

  const activeOrg = getActiveOrganization();
  if (!state.activeWorkspaceId || !activeOrg?.workspaces?.some((item) => item.id === state.activeWorkspaceId)) {
    state.activeWorkspaceId = activeOrg?.workspaces?.[0]?.id || "";
  }

  renderAuthState();
  renderOrgOptions();
}

function applyAuthPayload(payload) {
  state.user = payload.user;
  state.organizations = payload.organizations || [];
  state.activeOrgId = payload.activeOrganizationId || state.organizations[0]?.id || "";

  const activeOrg = getActiveOrganization();
  state.activeWorkspaceId = payload.activeWorkspaceId || activeOrg?.workspaces?.[0]?.id || "";

  renderAuthState();
  renderOrgOptions();
}

async function loadTemplates() {
  const payload = await api("/api/templates");
  state.templates = payload.templates;
  renderTemplateOptions();
}

async function loadProviders() {
  const payload = await api("/api/providers");
  state.providers = Array.isArray(payload.providers) ? payload.providers : [];
  state.defaultProviderId = typeof payload.defaultProviderId === "string" ? payload.defaultProviderId : "";
  renderProviderOptions();
}

async function loadProjects() {
  if (!state.activeWorkspaceId) {
    stopDeploymentPolling();
    state.projects = [];
    state.activeProject = null;
    state.deployments = [];
    state.activeDeploymentId = "";
    state.deploymentLogs = "";
    state.agentRuns = [];
    state.activeRunId = "";
    state.activeRunDetail = null;
    state.activeRunValidation = null;
    state.runDrawerOpen = false;
    renderProjects();
    renderTree();
    renderHistory();
    renderAgentRuns();
    renderRunDetail();
    renderGit();
    renderDeployments();
    syncProjectHeader();
    return;
  }

  const payload = await api(`/api/projects?workspaceId=${encodeURIComponent(state.activeWorkspaceId)}`);
  state.projects = payload.projects;

  if (state.activeProject && !state.projects.some((project) => project.id === state.activeProject.id)) {
    state.activeProject = null;
    state.tree = [];
    state.activeFilePath = "";
    el.fileEditor.value = "";
    state.commits = [];
    state.gitDiff = "";
    state.deployments = [];
    state.activeDeploymentId = "";
    state.deploymentLogs = "";
    state.agentRuns = [];
    state.activeRunId = "";
    state.activeRunDetail = null;
    state.activeRunValidation = null;
    state.runDrawerOpen = false;
    stopDeploymentPolling();
  }

  renderProjects();
  syncProjectHeader();

  if (state.activeProject) {
    await loadDeployments(false);
  } else {
    renderDeployments();
  }
}

async function selectProject(projectId) {
  const payload = await api(`/api/projects/${projectId}`);
  state.activeProject = payload.project;
  state.tree = payload.tree;
  state.activeFilePath = "";
  el.fileEditor.value = "";
  el.editorTitle.textContent = "Editor";
  state.activeRunId = "";
  state.activeRunDetail = null;
  state.activeRunValidation = null;
  state.runDrawerOpen = false;

  syncProjectHeader();
  renderProjects();
  renderTree();
  renderHistory();
  renderAgentRuns();
  renderRunDetail();

  await Promise.all([loadGitHistory(), loadDeployments(true), loadAgentRuns()]);
}

async function refreshActiveProject() {
  if (!state.activeProject) {
    return;
  }

  const activeId = state.activeProject.id;
  const openFile = state.activeFilePath;
  await selectProject(activeId);

  if (openFile) {
    try {
      await loadFile(openFile);
    } catch {
      state.activeFilePath = "";
      el.fileEditor.value = "";
      el.editorTitle.textContent = "Editor";
    }
  }
}

async function loadFile(filePath) {
  if (!state.activeProject) {
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/file?path=${encodeURIComponent(filePath)}`);
  state.activeFilePath = payload.path;
  el.fileEditor.value = payload.content;
  el.editorTitle.textContent = `Editor · ${payload.path}`;
  renderTree();
}

async function loadGitHistory() {
  if (!state.activeProject) {
    state.commits = [];
    state.gitDiff = "";
    renderGit();
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/git/history`);
  state.commits = payload.commits || [];
  if (!state.gitDiff) {
    state.gitDiff = "";
  }
  renderGit();
}

async function loadDeployments(includeLogs = false) {
  if (!state.activeProject) {
    stopDeploymentPolling();
    state.deployments = [];
    state.activeDeploymentId = "";
    state.deploymentLogs = "";
    renderDeployments();
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/deployments`);
  state.deployments = payload.deployments || [];

  if (!state.deployments.some((deployment) => deployment.id === state.activeDeploymentId)) {
    state.activeDeploymentId = state.deployments[0]?.id || "";
    state.deploymentLogs = "";
  }

  renderDeployments();

  if (includeLogs && state.activeDeploymentId) {
    await loadDeploymentLogs(state.activeDeploymentId, true);
  }

  syncDeploymentPolling();
}

async function loadAgentRuns() {
  if (!state.activeProject) {
    state.agentRuns = [];
    state.activeRunId = "";
    state.activeRunDetail = null;
    state.activeRunValidation = null;
    state.runDrawerOpen = false;
    renderAgentRuns();
    renderRunDetail();
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/agent/runs`);
  state.agentRuns = payload.runs || [];

  if (!state.agentRuns.some((run) => run.id === state.activeRunId)) {
    state.activeRunId = state.agentRuns[0]?.id || "";
    state.activeRunDetail = null;
    state.activeRunValidation = null;
    state.runDrawerOpen = false;
  }

  renderAgentRuns();

  if (state.activeRunId) {
    await loadAgentRunDetail(state.activeRunId, true);
  } else {
    renderRunDetail();
  }
}

async function loadAgentRunDetail(runId, silent = false, openDrawer = false) {
  if (!state.activeProject || !runId) {
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/agent/runs/${runId}`);
  state.activeRunId = runId;
  state.activeRunDetail = payload;
  state.runDrawerOpen = openDrawer || state.runDrawerOpen;

  if (state.activeRunValidation && state.activeRunValidation.runId !== runId) {
    state.activeRunValidation = null;
  }

  renderAgentRuns();
  renderRunDetail();

  if (!silent) {
    setStatus(`Loaded run ${runId.slice(0, 8)} details.`, "success");
  }
}

async function handleValidateRunOutput() {
  if (!state.activeProject || !state.activeRunId) {
    setStatus("Select a run first.", "error");
    return;
  }

  try {
    el.validateRun.disabled = true;
    setStatus(`Validating run ${state.activeRunId.slice(0, 8)} output...`);

    const payload = await api(`/api/projects/${state.activeProject.id}/agent/runs/${state.activeRunId}/validate`, {
      method: "POST"
    });

    state.activeRunValidation = {
      runId: state.activeRunId,
      validation: payload.validation
    };

    await loadAgentRuns();
    await loadAgentRunDetail(state.activeRunId, true);

    setStatus(
      payload.validation.ok
        ? `Validation passed: ${payload.validation.summary}`
        : `Validation failed: ${payload.validation.summary}`,
      payload.validation.ok ? "success" : "error"
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    renderRunDetail();
  }
}

async function handleResumeRun() {
  if (!state.activeProject || !state.activeRunId) {
    setStatus("Select a run first.", "error");
    return;
  }

  try {
    el.resumeRun.disabled = true;
    setStatus(`Resuming run ${state.activeRunId.slice(0, 8)}...`);

    const payload = await api(`/api/projects/${state.activeProject.id}/agent/runs/${state.activeRunId}/resume`, {
      method: "POST"
    });

    state.activeRunDetail = payload;
    state.activeRunValidation = null;

    await loadAgentRuns();
    await loadAgentRunDetail(state.activeRunId, true);

    setStatus(`Run ${state.activeRunId.slice(0, 8)} resumed.`, "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    renderRunDetail();
  }
}

async function loadDeploymentLogs(deploymentId, silent = false) {
  if (!state.activeProject || !deploymentId) {
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/deployments/${deploymentId}/logs`);
  state.activeDeploymentId = deploymentId;
  state.deploymentLogs = payload.logs || "";

  if (payload.deployment) {
    const existingIndex = state.deployments.findIndex((deployment) => deployment.id === deploymentId);

    if (existingIndex === -1) {
      state.deployments = [payload.deployment, ...state.deployments];
    } else {
      state.deployments = state.deployments.map((deployment) =>
        deployment.id === deploymentId ? payload.deployment : deployment
      );
    }
  }

  renderDeployments();
  syncDeploymentPolling();

  if (!silent) {
    setStatus("Deployment logs loaded.", "success");
  }
}

async function loadDiff(from, to) {
  if (!state.activeProject) {
    return;
  }

  const payload = await api(
    `/api/projects/${state.activeProject.id}/git/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  state.gitDiff = payload.diff || "";
  renderGit();
}

async function loadDiffForCommit(hash) {
  try {
    setStatus(`Loading diff for ${hash.slice(0, 7)}...`);
    await loadDiff(`${hash}~1`, hash);
    setStatus(`Diff loaded for ${hash.slice(0, 7)}.`, "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = el.authMode.value;
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;

  if (!email || !password) {
    setStatus("Email and password are required.", "error");
    return;
  }

  const body = {
    email,
    password,
    ...(mode === "register"
      ? {
          name: el.authName.value.trim(),
          organizationName: el.authOrgName.value.trim() || undefined,
          workspaceName: el.authWorkspaceName.value.trim() || undefined
        }
      : {})
  };

  if (mode === "register" && !body.name) {
    setStatus("Name is required for registration.", "error");
    return;
  }

  try {
    setStatus(`${mode === "login" ? "Signing in" : "Creating account"}...`);

    const payload = await api(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    applyAuthPayload(payload);
    await Promise.all([loadTemplates(), loadProviders()]);
    await loadProjects();

    if (state.projects.length) {
      await selectProject(state.projects[0].id);
    }

    el.authForm.reset();
    renderAuthMode();

    setStatus(mode === "login" ? "Operator session active." : "Account created and operator session active.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", {
      method: "POST"
    }, false);
  } catch {
    // Ignore logout failures and clear local state regardless.
  }

  clearSession();
}

async function handleCreateOrg(event) {
  event.preventDefault();

  const name = el.newOrgName.value.trim();
  if (!name) {
    setStatus("Organization name is required.", "error");
    return;
  }

  try {
    setStatus("Creating organization...");
    const payload = await api("/api/orgs", {
      method: "POST",
      body: JSON.stringify({
        name
      })
    });

    await refreshAccount();
    state.activeOrgId = payload.organization.id;
    state.activeWorkspaceId = payload.workspace.id;
    renderOrgOptions();

    await loadProjects();
    setStatus("Organization created.", "success");
    el.createOrgForm.reset();
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleCreateWorkspace(event) {
  event.preventDefault();

  if (!state.activeOrgId) {
    setStatus("Select an organization first.", "error");
    return;
  }

  const name = el.newWorkspaceName.value.trim();
  if (!name) {
    setStatus("Workspace name is required.", "error");
    return;
  }

  try {
    setStatus("Creating workspace...");

    const payload = await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        orgId: state.activeOrgId,
        name
      })
    });

    await refreshAccount();
    state.activeWorkspaceId = payload.workspace.id;
    renderOrgOptions();
    await loadProjects();

    el.createWorkspaceForm.reset();
    setStatus("Workspace created.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleAddMember(event) {
  event.preventDefault();

  if (!state.activeOrgId) {
    setStatus("Select an organization first.", "error");
    return;
  }

  const email = el.memberEmail.value.trim();
  const role = el.memberRole.value;

  if (!email) {
    setStatus("Member email is required.", "error");
    return;
  }

  try {
    setStatus("Adding member...");
    await api(`/api/orgs/${state.activeOrgId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role })
    });
    el.addMemberForm.reset();
    setStatus("Member added.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleCreateProject(event) {
  event.preventDefault();

  if (!state.activeWorkspaceId) {
    setStatus("Select a workspace first.", "error");
    return;
  }

  const name = el.projectName.value.trim();
  if (!name) {
    return;
  }

  const description = el.projectDescription.value.trim();
  const templateId = el.templateSelect.value;

  try {
    setStatus("Creating project...");

    const payload = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: state.activeWorkspaceId,
        name,
        description,
        templateId
      })
    });

    await loadProjects();
    const created = state.projects.find((project) => project.id === payload.project.id) || state.projects[0];

    if (created) {
      await selectProject(created.id);
    }

    el.createForm.reset();
    renderTemplateOptions();
    setStatus("Project created.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function runBuilder(mode) {
  if (!state.activeProject) {
    setStatus("Select a project first.", "error");
    return;
  }

  const prompt = el.promptInput.value.trim();
  if (!prompt) {
    setStatus("Prompt is required.", "error");
    return;
  }

  const provider = el.providerSelect.value || state.defaultProviderId || "";
  const model = el.modelInput.value.trim();
  const endpoint = mode === "chat" ? "chat" : "generate";

  try {
    setBusy(true);
    setStatus(`Running ${mode}...`);

    const payload = await api(`/api/projects/${state.activeProject.id}/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({
        prompt,
        message: prompt,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {})
      })
    });

    await loadProjects();
    await refreshActiveProject();

    const commands = payload.result.commands?.length
      ? ` Suggested commands: ${payload.result.commands.join(", ")}`
      : "";
    const commitText = payload.result.commitHash ? ` Commit: ${payload.result.commitHash}.` : "";

    setStatus(`${payload.result.summary}${commands}${commitText}`, "success");

    if (!state.activeFilePath && payload.result.filesChanged?.length) {
      await loadFile(payload.result.filesChanged[0]);
    }
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleDeploy() {
  const eligibility = getDeployEligibility();
  if (!eligibility.ok || !eligibility.run || !state.activeProject) {
    setStatus(eligibility.reason || "Select a valid run to deploy.", "error");
    return;
  }

  const customDomain = el.deployCustomDomain.value.trim();

  try {
    setBusy(true);
    setStatus("Queueing production deployment...");

    const payload = await api(`/api/projects/${state.activeProject.id}/deployments`, {
      method: "POST",
      body: JSON.stringify({
        runId: eligibility.run.id,
        customDomain: customDomain || undefined
      })
    });

    if (payload.deployment) {
      state.activeDeploymentId = payload.deployment.id;
    }

    await loadDeployments(true);

    const targetUrl = payload.deployment?.customDomain
      ? `https://${payload.deployment.customDomain}`
      : payload.deployment?.publicUrl;

    setStatus(
      targetUrl
        ? `Deployment queued. Target URL: ${targetUrl}`
        : "Deployment queued. Open Deployments for status and logs.",
      "success"
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleSaveFile() {
  if (!state.activeProject || !state.activeFilePath) {
    setStatus("Select a file first.", "error");
    return;
  }

  try {
    setStatus(`Saving ${state.activeFilePath}...`);
    const payload = await api(`/api/projects/${state.activeProject.id}/file`, {
      method: "PUT",
      body: JSON.stringify({
        path: state.activeFilePath,
        content: el.fileEditor.value
      })
    });

    await loadProjects();
    await refreshActiveProject();
    const commitText = payload.commitHash ? ` Commit: ${payload.commitHash}.` : "";
    setStatus(`Saved ${state.activeFilePath}.${commitText}`, "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

async function handleManualCommit(event) {
  event.preventDefault();

  if (!state.activeProject) {
    setStatus("Select a project first.", "error");
    return;
  }

  const message = el.manualCommitMessage.value.trim();
  if (!message) {
    setStatus("Commit message is required.", "error");
    return;
  }

  try {
    setStatus("Creating commit...");
    const payload = await api(`/api/projects/${state.activeProject.id}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message })
    });

    await refreshActiveProject();
    await loadGitHistory();

    el.manualCommitForm.reset();
    setStatus(payload.commitHash ? `Commit created: ${payload.commitHash}` : "No changes to commit.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

function bindEvents() {
  el.sidebarToggle?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    persistSidebarCollapsedPreference();
    renderSidebarState();
  });

  const stageButtons = el.stageNav ? Array.from(el.stageNav.querySelectorAll("[data-stage]")) : [];
  for (const button of stageButtons) {
    button.addEventListener("click", () => {
      const stage = button.getAttribute("data-stage");
      if (stage) {
        setActiveStage(stage);
      }
    });
  }

  el.authMode.addEventListener("change", () => {
    renderAuthMode();
  });

  el.authForm.addEventListener("submit", (event) => {
    void handleAuthSubmit(event);
  });

  el.logoutBtn.addEventListener("click", () => {
    void handleLogout();
  });

  el.orgSelect.addEventListener("change", () => {
    state.activeOrgId = el.orgSelect.value;
    renderOrgOptions();
    void loadProjects();
  });

  el.workspaceSelect.addEventListener("change", () => {
    state.activeWorkspaceId = el.workspaceSelect.value;
    void loadProjects();
  });

  el.createOrgForm.addEventListener("submit", (event) => {
    void handleCreateOrg(event);
  });

  el.createWorkspaceForm.addEventListener("submit", (event) => {
    void handleCreateWorkspace(event);
  });

  el.addMemberForm.addEventListener("submit", (event) => {
    void handleAddMember(event);
  });

  el.createForm.addEventListener("submit", (event) => {
    void handleCreateProject(event);
  });

  el.templateSelect.addEventListener("change", () => {
    const template = state.templates.find((entry) => entry.id === el.templateSelect.value);
    if (template && !el.promptInput.value.trim()) {
      el.promptInput.value = template.recommendedPrompt;
    }
  });

  el.providerSelect.addEventListener("change", () => {
    const provider = state.providers.find((entry) => entry.id === el.providerSelect.value);
    if (provider) {
      el.modelInput.placeholder = provider.defaultModel;
    }
    renderBuildOverview();
  });

  el.modelInput.addEventListener("input", () => {
    renderBuildOverview();
  });

  el.refreshProjects.addEventListener("click", () => {
    void loadProjects();
  });

  el.refreshFiles.addEventListener("click", () => {
    void refreshActiveProject();
  });

  el.generateBtn.addEventListener("click", () => {
    void runBuilder("generate");
  });

  el.chatBtn.addEventListener("click", () => {
    void runBuilder("chat");
  });

  el.deployBtn.addEventListener("click", () => {
    void handleDeploy();
  });

  el.saveFile.addEventListener("click", () => {
    void handleSaveFile();
  });

  el.refreshGit.addEventListener("click", () => {
    void loadGitHistory();
  });

  el.refreshDeployments.addEventListener("click", () => {
    void loadDeployments(true);
  });

  el.refreshRuns.addEventListener("click", () => {
    void loadAgentRuns();
  });

  el.runSearchInput?.addEventListener("input", () => {
    state.runHistoryFilters.search = el.runSearchInput.value;
    renderAgentRuns();
  });

  el.runSearchClear?.addEventListener("click", () => {
    state.runHistoryFilters.search = "";
    renderAgentRuns();
  });

  const runTabButtons = el.runStatusTabs ? Array.from(el.runStatusTabs.querySelectorAll("[data-run-tab]")) : [];
  for (const button of runTabButtons) {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-run-tab");
      if (!tab) {
        return;
      }
      state.runHistoryFilters.tab = tab;
      renderAgentRuns();
    });
  }

  const runProfileButtons = el.runProfileFilters
    ? Array.from(el.runProfileFilters.querySelectorAll("[data-run-profile]"))
    : [];
  for (const button of runProfileButtons) {
    button.addEventListener("click", () => {
      const profile = button.getAttribute("data-run-profile");
      if (!profile) {
        return;
      }
      state.runHistoryFilters.profile = profile;
      renderAgentRuns();
    });
  }

  el.validateRun.addEventListener("click", () => {
    void handleValidateRunOutput();
  });

  el.resumeRun.addEventListener("click", () => {
    void handleResumeRun();
  });

  el.manualCommitForm.addEventListener("submit", (event) => {
    void handleManualCommit(event);
  });

  el.runDrawerClose?.addEventListener("click", () => {
    setRunDrawerOpen(false);
  });

  el.runDrawerBackdrop?.addEventListener("click", () => {
    setRunDrawerOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.runDrawerOpen) {
      setRunDrawerOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const toggle = target.closest("[data-expand-toggle]");
    if (!toggle) {
      return;
    }

    const key = toggle.getAttribute("data-expand-toggle");
    if (!key) {
      return;
    }

    state.expandedText[key] = !state.expandedText[key];
    renderHistory();
    renderBuildOverview();
    renderValidateSummary();
    renderDeployEligibility();
    renderAgentRuns();
    renderRunDrawer();
  });
}

async function bootstrapAuthenticated() {
  await refreshAccount();
  await Promise.all([loadTemplates(), loadProviders()]);
  await loadProjects();

  if (state.projects.length) {
    await selectProject(state.projects[0].id);
  }
}

async function bootstrap() {
  state.sidebarCollapsed = loadSidebarCollapsedPreference();
  bindEvents();
  renderSidebarState();
  renderAuthMode();
  renderAuthState();
  renderStageViews();
  renderProjects();
  renderDeployments();
  renderAgentRuns();
  renderRunDetail();
  syncProjectHeader();

  try {
    setStatus("Restoring session...");
    await bootstrapAuthenticated();
    setStatus("DeepRun Factory ready.", "success");
  } catch {
    clearSession(false);
    setStatus("Sign in or register to enter the control room.");
  }
}

void bootstrap();
