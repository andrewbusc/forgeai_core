import { AgentRunService, ExecuteStepOutput } from "./run-service.js";

interface QueueJob {
  projectId: string;
  runId: string;
  requestId: string;
}

function toJobKey(job: QueueJob): string {
  return `${job.projectId}:${job.runId}`;
}

function fromJobKey(key: string): { projectId: string; runId: string } {
  const splitAt = key.indexOf(":");
  if (splitAt < 0) {
    return { projectId: "", runId: key };
  }

  return {
    projectId: key.slice(0, splitAt),
    runId: key.slice(splitAt + 1)
  };
}

export class AgentRunWorker {
  private readonly queued = new Set<string>();
  private readonly requestIds = new Map<string, string>();
  private draining = false;

  constructor(private readonly runService: AgentRunService) {}

  enqueue(job: QueueJob): void {
    const key = toJobKey(job);
    this.queued.add(key);
    this.requestIds.set(key, job.requestId);
    void this.drain();
  }

  async processOnce(job: QueueJob & { expectedStepIndex?: number }): Promise<ExecuteStepOutput> {
    return this.runService.executeNextStep(job);
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;

    try {
      while (this.queued.size > 0) {
        const first = this.queued.values().next();

        if (first.done) {
          break;
        }

        const key = first.value;
        this.queued.delete(key);

        const parsed = fromJobKey(key);
        const requestId = this.requestIds.get(key) || "worker";
        this.requestIds.delete(key);

        const result = await this.runService.executeNextStep({
          projectId: parsed.projectId,
          runId: parsed.runId,
          requestId
        });

        if (result.shouldReenqueue) {
          this.queued.add(key);
          this.requestIds.set(key, requestId);
        }
      }
    } finally {
      this.draining = false;

      if (this.queued.size > 0) {
        void this.drain();
      }
    }
  }
}

