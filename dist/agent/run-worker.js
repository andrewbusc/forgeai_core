function toJobKey(job) {
    return `${job.projectId}:${job.runId}`;
}
function fromJobKey(key) {
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
    runService;
    queued = new Set();
    requestIds = new Map();
    draining = false;
    constructor(runService) {
        this.runService = runService;
    }
    enqueue(job) {
        const key = toJobKey(job);
        this.queued.add(key);
        this.requestIds.set(key, job.requestId);
        void this.drain();
    }
    async processOnce(job) {
        return this.runService.executeNextStep(job);
    }
    async drain() {
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
        }
        finally {
            this.draining = false;
            if (this.queued.size > 0) {
                void this.drain();
            }
        }
    }
}
