import { Injectable, Logger } from '@nestjs/common';
import { interrupt } from '@langchain/langgraph';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';

@Injectable()
export class HumanGatePlugin implements ToolPlugin {
  readonly toolType = ['human-gate', 'humangate'];
  private readonly logger = new Logger(HumanGatePlugin.name);

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, nodeInput, context, runId } = ctx;
    const config = node?.data?.config || {};

    // Check if we are running in a LangGraph execution context
    const useInterrupt = context.__useLangGraphInterrupt !== false;
    if (useInterrupt) {
      try {
        const question =
          config.question || nodeInput?.question || 'Awaiting human decision / approval';
        const options = config.options || ['Approve', 'Reject'];

        this.logger.log(`⏸️ [HumanGatePlugin] Calling LangGraph interrupt for node "${node.id}" ($${node.data?.name || node.id})`);

        const decision: any = interrupt({
          nodeId: node.id,
          nodeName: node.data?.name || node.id,
          question,
          options,
          data: { ...config, ...nodeInput },
          runId,
        });

        // Resume payload received via Command({ resume: decision })
        const approved = Boolean(
          decision?.approved ??
            (typeof decision === 'string' && decision.toLowerCase() === 'approve') ??
            (typeof decision === 'object' && decision?.value === 'Approve'),
        );
        const feedback = decision?.feedback || (typeof decision === 'string' ? decision : '');

        this.logger.log(`▶️ [HumanGatePlugin] Resumed node "${node.id}" with decision approved=${approved}`);

        return {
          approved,
          feedback,
          value: decision,
          result: {
            approved,
            feedback,
            ...(typeof decision === 'object' ? decision : { decision }),
          },
        };
      } catch (err: any) {
        // If not inside a StateGraph execution, fall back to self-contained execution
        if (!err.message?.includes('Called interrupt() outside the context of a graph')) {
          throw err;
        }
      }
    }

    // Fallback: direct self-contained execution
    const payload: any = { ...config, ...nodeInput, ...(context.__resumeDecision || {}) };
    const hasResumed =
      payload.decision !== undefined ||
      payload.approved !== undefined ||
      payload.value !== undefined ||
      payload.formValues !== undefined ||
      payload.__resumed === true;

    if (hasResumed) {
      const approved = payload.approved !== undefined
        ? Boolean(payload.approved)
        : (payload.decision !== undefined ? Boolean(payload.decision) : true);
      const value = payload.value !== undefined
        ? payload.value
        : (payload.formValues !== undefined
        ? payload.formValues
        : (payload.decision !== undefined ? payload.decision : payload.feedback));
      const formValues = payload.formValues || (typeof value === 'object' && value !== null ? value : { value });
      const feedback = payload.feedback || (typeof value === 'string' ? value : '');
      const draft = payload.draft !== undefined ? payload.draft : config.draft;

      return {
        status: 'completed',
        result: {
          approved,
          decision: payload.decision !== undefined ? payload.decision : approved,
          value,
          formValues,
          feedback,
          draft,
          inputType: config.inputType || 'approval',
          submittedAt: new Date().toISOString(),
        },
        approved,
        value,
      };
    }

    // Waiting state
    const inputType = config.inputType || 'approval';
    const rawOptions = config.options;
    let options = Array.isArray(rawOptions)
      ? rawOptions
      : (typeof rawOptions === 'string' ? rawOptions.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
    if (!options.length && (inputType === 'select' || inputType === 'radio')) {
      options = ['Approve', 'Request Changes', 'Reject'];
    }

    let formFields = Array.isArray(config.formFields) ? config.formFields : [];
    if (!formFields.length && inputType === 'form') {
      formFields = [
        { name: 'decision', label: 'Decision', type: 'radio', options: ['Approve', 'Reject'], required: true },
        { name: 'feedback', label: 'Review Feedback', type: 'textarea', required: false },
      ];
    }

    const responseType = config.responseType || 'panel';

    return {
      status: 'waiting',
      result: {
        approvalRequired: true,
        token: payload.token || `approval-${Date.now()}`,
        question: config.question || 'Please review this request and provide your response.',
        responseType,
        chatId: config.chatId || payload.chatId,
        botToken: config.botToken || payload.botToken,
        messageThreadId: config.messageThreadId || payload.messageThreadId,
        updateMode: config.updateMode || 'polling',
        pollIntervalSeconds: Number(config.pollIntervalSeconds || 2),
        inputType,
        options,
        formFields,
        draft: config.draft !== undefined ? config.draft : payload.draft,
        allowDraftEdit: config.allowDraftEdit === true || config.allowDraftEdit === 'true',
        timeoutMs: Number(config.timeoutMs || 86400000),
      },
    };
  }

  getValidHandles(_config?: any, _outputs?: any[], _nodeData?: any, _nodeName?: string): Set<string> {
    return new Set(['approved', 'rejected', 'result', 'value']);
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const gateKeys = ['approved', 'feedback', 'status', 'data', 'action', 'value', 'draft', 'timestamp'];
    for (const k of gateKeys) {
      paths.add(`${nodeName}.${k}`);
      paths.add(`${nodeName}.result.${k}`);
    }
    return paths;
  }

  isWaitingGate(_config?: any): boolean {
    return true;
  }
}
