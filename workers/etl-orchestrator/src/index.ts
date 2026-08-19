import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { OrchestratorEnv, WorkflowAParams, WorkflowBParams } from "./env";
import { OutboxDispatcher } from "./outbox-dispatcher";
import { executeWorkflowA } from "./workflow-a";
import { executeWorkflowB } from "./workflow-b";
import { requireInternalToken } from "./internal-auth";
import { reconcileOperationalState } from "./reconciler";

export class WorkflowA extends WorkflowEntrypoint<OrchestratorEnv, WorkflowAParams> {
  async run(event: WorkflowEvent<WorkflowAParams>, step: WorkflowStep): Promise<void> {
    await executeWorkflowA(this.env, event, step);
  }
}

export class WorkflowB extends WorkflowEntrypoint<OrchestratorEnv, WorkflowBParams> {
  async run(event: WorkflowEvent<WorkflowBParams>, step: WorkflowStep): Promise<void> {
    await executeWorkflowB(this.env, event, step);
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: OrchestratorEnv): Promise<void> {
    await reconcileOperationalState(env.DB);
    await new OutboxDispatcher(env).dispatchAvailable();
  },
  async fetch(request: Request, env: OrchestratorEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "hirebeat-etl-orchestrator", status: "ready" });
    }
    if (request.method === "POST" && url.pathname === "/internal/dispatch") {
      try {
        await requireInternalToken(request,env.ORCHESTRATOR_INTERNAL_AUTH_TOKEN);
      } catch {
        return Response.json({error:"unauthorized"},{status:401});
      }
      const reconciled=await reconcileOperationalState(env.DB);
      const count = await new OutboxDispatcher(env).dispatchAvailable();
      return Response.json({ reconciled,dispatched: count });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<OrchestratorEnv>;
