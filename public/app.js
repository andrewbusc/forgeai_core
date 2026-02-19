const state = {
  user: null,
  organizations: [],
  activeOrgId: "",
  activeWorkspaceId: "",
  templates: [],
  providers: [],
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
  activeRunId: "",
  activeRunDetail: null,
  activeRunValidation: null
};

const el = {
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
  historyList: document.getElementById("history-list"),
  refreshRuns: document.getElementById("refresh-runs"),
  runList: document.getElementById("run-list"),
  runDetail: document.getElementById("run-detail"),
  validateRun: document.getElementById("validate-run"),
  resumeRun: document.getElementById("resume-run"),

  refreshGit: document.getElementById("refresh-git"),
  gitList: document.getElementById("git-list"),
  gitDiff: document.getElementById("git-diff"),
  refreshDeployments: document.getElementById("refresh-deployments"),
  deploymentList: document.getElementById("deployment-list"),
  deploymentLogs: document.getElementById("deployment-logs"),
  manualCommitForm: document.getElementById("manual-commit-form"),
  manualCommitMessage: document.getElementById("manual-commit-message")
};

let refreshInFlight = null;
let deploymentPollTimer = null;
let deploymentPollInFlight = false;

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
  state.activeProject = null;
  state.tree = [];
  state.activeFilePath = "";
  state.commits = [];
  state.gitDiff = "";
  state.deployments = [];
  state.activeDeploymentId = "";
  state.deploymentLogs = "";
  state.agentRuns = [];
  state.activeRunId = "";
  state.activeRunDetail = null;
  state.activeRunValidation = null;

  renderAuthMode();
  renderAuthState();
  renderOrgOptions();
  renderProjects();
  renderTree();
  renderHistory();
  renderAgentRuns();
  renderRunDetail();
  renderGit();
  renderDeployments();
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

  if (authenticated) {
    el.authUserInfo.textContent = `${state.user.name} · ${state.user.email}`;
  } else {
    el.authUserInfo.textContent = "";
  }
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
  el.providerSelect.innerHTML = state.providers
    .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
    .join("");

  const selected = state.providers.find((provider) => provider.id === el.providerSelect.value) || state.providers[0];

  if (selected) {
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
    return;
  }

  if (!state.activeProject.history.length) {
    el.historyList.innerHTML = `<div class="history-item"><p>No activity yet.</p></div>`;
    return;
  }

  el.historyList.innerHTML = state.activeProject.history
    .slice(0, 25)
    .map((item) => {
      const files = item.filesChanged.length ? item.filesChanged.join(", ") : "No file changes";
      const commit = item.commitHash ? `Commit ${item.commitHash}` : "No commit";
      return `<article class="history-item">
        <strong>${escapeHtml(item.kind.toUpperCase())} · ${escapeHtml(item.provider)}:${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(item.summary)}</p>
        <small>${new Date(item.createdAt).toLocaleString()} · ${escapeHtml(commit)}</small>
        <p>${escapeHtml(files)}</p>
      </article>`;
    })
    .join("");
}

function canResumeRun(run) {
  if (!run) {
    return false;
  }

  return run.status === "failed" || run.status === "paused" || run.status === "planned";
}

function renderAgentRuns() {
  if (!state.activeProject) {
    el.runList.innerHTML = "";
    return;
  }

  if (!state.agentRuns.length) {
    el.runList.innerHTML = `<div class="git-item"><p>No agent runs yet.</p></div>`;
    return;
  }

  el.runList.innerHTML = state.agentRuns
    .map((run) => {
      const activeClass = run.id === state.activeRunId ? "active" : "";
      const status = escapeHtml(run.status || "unknown");
      const branch = run.runBranch ? ` · ${escapeHtml(run.runBranch)}` : "";
      const updatedAt = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "unknown";
      const currentStep = Number.isFinite(run.currentStepIndex) ? run.currentStepIndex : 0;
      const totalSteps = Array.isArray(run.plan?.steps) ? run.plan.steps.length : 0;

      return `<article class="git-item deployment-item ${activeClass}">
        <strong>${escapeHtml(run.id.slice(0, 8))} · ${status}</strong>
        <small>${updatedAt}${branch}</small>
        <p>Step ${currentStep}/${totalSteps}</p>
        <p><button type="button" class="ghost-btn" data-run-id="${run.id}">View</button></p>
      </article>`;
    })
    .join("");

  const buttons = el.runList.querySelectorAll("[data-run-id]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const runId = button.getAttribute("data-run-id");
      if (runId) {
        void loadAgentRunDetail(runId);
      }
    });
  }
}

function renderRunDetail() {
  if (!state.activeProject || !state.activeRunDetail?.run) {
    el.runDetail.textContent = "Select a run to view step and validation details.";
    el.validateRun.disabled = true;
    el.resumeRun.disabled = true;
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
  lines.push(`steps (${steps.length}):`);

  const recentSteps = steps.slice(-15);
  for (const step of recentSteps) {
    const commitText = step.commitHash ? ` commit=${step.commitHash}` : "";
    lines.push(`  #${step.stepIndex} ${step.stepId} [${step.status}] ${step.tool}${commitText}`);
  }

  el.runDetail.textContent = lines.join("\n");
  el.validateRun.disabled = run.status === "running";
  el.resumeRun.disabled = !canResumeRun(run);
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
    return;
  }

  if (!state.deployments.length) {
    el.deploymentList.innerHTML = `<div class="git-item"><p>No deployments yet.</p></div>`;
    el.deploymentLogs.textContent = "";
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
}

function syncProjectHeader() {
  if (!state.activeProject) {
    el.activeProjectName.textContent = "No project selected";

    if (!state.user) {
      el.activeProjectMeta.textContent = "Authenticate and choose a workspace to begin.";
      return;
    }

    const workspace = getActiveWorkspace();
    el.activeProjectMeta.textContent = workspace
      ? `Workspace: ${workspace.name} · Create or select a project.`
      : "Select a workspace to begin.";
    return;
  }

  const workspace = getActiveWorkspace();
  const workspaceName = workspace ? workspace.name : "Unknown workspace";

  el.activeProjectName.textContent = state.activeProject.name;
  el.activeProjectMeta.textContent = `${state.activeProject.templateId} • ${workspaceName} • Updated ${new Date(
    state.activeProject.updatedAt
  ).toLocaleString()}`;
}

function setBusy(busy) {
  el.generateBtn.disabled = busy;
  el.chatBtn.disabled = busy;
  el.deployBtn.disabled = busy;
  el.saveFile.disabled = busy;
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
  state.providers = payload.providers;
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
  }

  renderAgentRuns();

  if (state.activeRunId) {
    await loadAgentRunDetail(state.activeRunId, true);
  } else {
    renderRunDetail();
  }
}

async function loadAgentRunDetail(runId, silent = false) {
  if (!state.activeProject || !runId) {
    return;
  }

  const payload = await api(`/api/projects/${state.activeProject.id}/agent/runs/${runId}`);
  state.activeRunId = runId;
  state.activeRunDetail = payload;

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

    setStatus(mode === "login" ? "Signed in." : "Account created and signed in.", "success");
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

  const provider = el.providerSelect.value || "mock";
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
        provider,
        model: model || undefined
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
  if (!state.activeProject) {
    setStatus("Select a project first.", "error");
    return;
  }

  const customDomain = el.deployCustomDomain.value.trim();

  try {
    setBusy(true);
    setStatus("Queueing production deployment...");

    const payload = await api(`/api/projects/${state.activeProject.id}/deployments`, {
      method: "POST",
      body: JSON.stringify({
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

  el.validateRun.addEventListener("click", () => {
    void handleValidateRunOutput();
  });

  el.resumeRun.addEventListener("click", () => {
    void handleResumeRun();
  });

  el.manualCommitForm.addEventListener("submit", (event) => {
    void handleManualCommit(event);
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
  bindEvents();
  renderAuthMode();
  renderAuthState();
  renderProjects();
  renderDeployments();
  renderAgentRuns();
  renderRunDetail();
  syncProjectHeader();

  try {
    setStatus("Restoring session...");
    await bootstrapAuthenticated();
    setStatus("ForgeAI ready.", "success");
  } catch {
    clearSession(false);
    setStatus("Sign in or register to start building.");
  }
}

void bootstrap();
