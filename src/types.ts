export type ProjectTemplateId = "canonical-backend" | "saas-web-app" | "agent-workflow" | "chatbot";
export type ProjectTemplateType = "backend" | "web-app" | "workflow";

export type ChangeKind = "generate" | "chat" | "manual-edit";
export type BuilderRole = "system" | "user" | "assistant";
export type FileActionType = "create" | "update" | "delete";
export type MembershipRole = "owner" | "admin" | "member";
export type DeploymentStatus = "queued" | "building" | "pushing" | "launching" | "ready" | "failed";

export interface BuilderMessage {
  role: BuilderRole;
  content: string;
  createdAt: string;
}

export interface GenerationHistoryItem {
  id: string;
  kind: ChangeKind;
  prompt: string;
  summary: string;
  provider: string;
  model: string;
  filesChanged: string[];
  commands: string[];
  commitHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Project {
  id: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  name: string;
  description: string;
  templateId: ProjectTemplateId;
  createdAt: string;
  updatedAt: string;
  history: GenerationHistoryItem[];
  messages: BuilderMessage[];
}

export interface Deployment {
  id: string;
  projectId: string;
  orgId: string;
  workspaceId: string;
  createdByUserId: string;
  runId: string | null;
  commitHash: string | null;
  status: DeploymentStatus;
  imageRepository: string | null;
  imageTag: string | null;
  imageRef: string | null;
  imageDigest: string | null;
  registryHost: string | null;
  containerName: string | null;
  containerId: string | null;
  containerPort: number | null;
  hostPort: number | null;
  subdomain: string;
  publicUrl: string;
  customDomain: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
  logs: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface ProjectTemplate {
  id: ProjectTemplateId;
  type: ProjectTemplateType;
  name: string;
  description: string;
  recommendedPrompt: string;
  starterFiles: Record<string, string>;
}

export interface FileAction {
  action: FileActionType;
  path: string;
  content?: string;
  reason?: string;
}

export interface GenerationResult {
  summary: string;
  files: FileAction[];
  runCommands: string[];
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  defaultModel: string;
  configured: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembership {
  id: string;
  orgId: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}
