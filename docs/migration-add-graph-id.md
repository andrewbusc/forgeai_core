# Migration: Add graph_id to agent_runs

## SQL to execute

```sql
-- Add graph_id column (nullable initially for backward compatibility)
ALTER TABLE agent_runs 
ADD COLUMN IF NOT EXISTS graph_id UUID REFERENCES execution_graphs(id) ON DELETE CASCADE;

-- Create index for graph_id lookups
CREATE INDEX IF NOT EXISTS idx_agent_runs_graph_id ON agent_runs (graph_id);
```

## After all runs have graph_id populated

```sql
ALTER TABLE agent_runs ALTER COLUMN graph_id SET NOT NULL;
```
