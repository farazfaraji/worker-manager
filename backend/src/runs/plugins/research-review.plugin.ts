import { Injectable, Optional } from '@nestjs/common';
import { ToolPlugin, ToolExecutionContext } from './tool-plugin.interface';
import { VariableResolverService } from '../services/variable-resolver.service';
import { WebSearchRunnerService } from '../services/web-search-runner.service';
import { reviewResearch } from '../../research/research-review';

@Injectable()
export class ResearchReviewPlugin implements ToolPlugin {
  readonly toolType = 'research-review';

  constructor(
    private readonly variableResolver: VariableResolverService,
    @Optional() private readonly webSearchRunner?: WebSearchRunnerService,
  ) {}

  async run(ctx: ToolExecutionContext): Promise<any> {
    const { node, context, runId } = ctx;
    const config = node?.data?.config || {};

    const value = (field: string) => this.variableResolver.resolveValue(config[field], context);
    const suppliedFindings = value('findings');
    const findings = Array.isArray(suppliedFindings) ? suppliedFindings : suppliedFindings?.findings;
    const sourceChecks: any[] = [];
    const weakSources: any[] = [];

    if (value('verifySources') !== false && value('verifySources') !== 'false') {
      const uniqueSources = new Set<string>();
      for (const finding of Array.isArray(findings) ? findings : []) {
        for (const source of Array.isArray(finding?.sources) ? finding.sources : []) {
          if (source?.url) uniqueSources.add(source.url);
        }
      }
      const maxSources = Math.min(30, Math.max(1, Number(value('maxSources') || 20)));
      const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
      const fetched = new Map<string, { text: string; reason?: string }>();
      const urls = [...uniqueSources].slice(0, maxSources);

      for (let index = 0; index < urls.length; index += 4) {
        await Promise.all(
          urls.slice(index, index + 4).map(async (url) => {
            try {
              const parsed = new URL(url);
              if (
                !['http:', 'https:'].includes(parsed.protocol) ||
                /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/i.test(
                  parsed.hostname,
                )
              ) {
                throw new Error('Source URL is not a public HTTP(S) address');
              }
              if (!this.webSearchRunner) {
                throw new Error('WebSearchRunner is not available');
              }
              const page = await this.webSearchRunner.executeWebSearchNode(
                { id: 'source-check', data: { config: { mode: 'read_article', url, maxContentLength: 50000 } } },
                {},
                context,
                runId,
              );
              if (page.status < 200 || page.status >= 400) {
                throw new Error(`Source returned HTTP ${page.status}`);
              }
              fetched.set(url, { text: normalize(String(page.text || '')) });
            } catch (error: any) {
              fetched.set(url, { text: '', reason: String(error?.message || error).slice(0, 250) });
            }
          }),
        );
      }

      for (const finding of Array.isArray(findings) ? findings : []) {
        for (const source of Array.isArray(finding?.sources) ? finding.sources : []) {
          const page = fetched.get(source.url);
          const evidence = normalize(String(source.evidence || ''));
          const verified = !!page?.text && !!evidence && page.text.includes(evidence);
          const reason =
            page?.reason ||
            (page
              ? verified
                ? 'Evidence found on source page'
                : 'Evidence could not be matched to fetched page text'
              : 'Source verification limit reached');
          sourceChecks.push({ findingId: finding.id, sourceUrl: source.url, verified, reason });
          if (!verified && source.role === 'supports') {
            weakSources.push({ findingId: finding.id, sourceUrl: source.url, reason });
          }
        }
      }
    }

    const suppliedAssessment = value('assessment') || {};
    const assessment = {
      ...suppliedAssessment,
      weakSources: [...(suppliedAssessment.weakSources || []), ...weakSources],
    };
    const cycles = context.__researchReviewCycles || {};
    const configuredCycle = value('reviewCycle');
    const reviewCycle = Math.max(Number(configuredCycle ?? 1), Number(cycles[node.id] || 0) + 1);

    const review = reviewResearch({
      findings: suppliedFindings,
      questions: value('questions'),
      assessment,
      reviewCycle,
      maxReviewCycles: value('maxReviewCycles') === undefined ? undefined : Number(value('maxReviewCycles')),
      evidenceLimit: value('evidenceLimit') === undefined ? undefined : Number(value('evidenceLimit')),
    });

    context.__researchReviewCycles = { ...cycles, [node.id]: reviewCycle };
    const researchResult = {
      ...review,
      findings: Array.isArray(findings) ? findings : [],
      questions: value('questions'),
      sourceChecks,
    };
    return { ...researchResult, result: researchResult };
  }

  getProducedPaths(nodeName: string, _config?: any, _nodeData?: any): Set<string> {
    const paths = new Set<string>();
    const reviewKeys = [
      'decision',
      'feedback',
      'score',
      'quality',
      'missingEvidence',
      'findings',
      'questions',
      'sourceChecks',
    ];
    paths.add(`${nodeName}.result`);
    for (const k of reviewKeys) {
      paths.add(`${nodeName}.${k}`);
      paths.add(`${nodeName}.result.${k}`);
    }
    return paths;
  }
}
