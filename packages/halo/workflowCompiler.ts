import type { AgentProfile, ProjectTask } from '../../src/types/os';
import type { WorkflowDefinition } from './types';

export function compileWorkflowToDag(
  workflow: WorkflowDefinition,
  agents: AgentProfile[],
): { tasks: ProjectTask[]; errors: string[] } {
  const errors: string[] = [];
  if (workflow.nodes.length === 0) {
    return { tasks: [], errors: ['Workflow has no nodes.'] };
  }

  // Build adjacency & detect cycles
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of workflow.nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of workflow.edges) {
    if (e.source === e.target) {
      errors.push(`Self-loop detected on node ${e.source}.`);
      continue;
    }
    incoming.get(e.target)?.push(e.source);
    outgoing.get(e.source)?.push(e.target);
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  for (const n of workflow.nodes) {
    const deg = incoming.get(n.id)?.length ?? 0;
    inDegree.set(n.id, deg);
    if (deg === 0) queue.push(n.id);
  }

  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    orderedIds.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  if (orderedIds.length !== workflow.nodes.length) {
    errors.push('Workflow graph contains a cycle and cannot execute.');
    return { tasks: [], errors };
  }

  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
  const defaultAgentId = agents[0]?.id ?? 'agent-aegis';
  const taskIdForNode = (nid: string) => `wf-${workflow.id}-${nid}`;

  const tasks: ProjectTask[] = orderedIds.map((nid) => {
    const node = nodeById.get(nid)!;
    const deps = (incoming.get(nid) ?? []).map(taskIdForNode);
    const requiresApproval =
      node.kind === 'approval' || Boolean(node.config?.requiresApproval);

    return {
      id: taskIdForNode(nid),
      title: node.label || `${node.kind} step`,
      description: String(
        node.config?.description ??
          `Compiled from Automation Studio node "${node.label}" (${node.kind}).`,
      ),
      assignedAgentId: node.agentId || defaultAgentId,
      dependsOn: deps,
      status: 'queued',
      priority: node.kind === 'approval' ? 'critical' : 'medium',
      requiresApproval,
      estimatedMinutes: Number(node.config?.estimatedMinutes ?? 2),
    };
  });

  return { tasks, errors };
}
