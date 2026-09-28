import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  WebSearchRunnerService,
  WebSearchResult,
} from '../src/runs/services/web-search-runner.service';
import {
  TavilySearchService,
  SAFE_MAX_RESULTS,
  DEFAULT_MAX_RESULTS,
  MIN_RESULTS,
} from '../src/runs/services/tavily-search.service';
import { VariableResolverService } from '../src/runs/services/variable-resolver.service';
import { NodeDefinitionsService } from '../src/node-definitions/node-definitions.service';
import {
  BadRequestException,
  UnauthorizedException,
  HttpException,
  BadGatewayException,
  GatewayTimeoutException,
} from '@nestjs/common';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING WEB SEARCH TOOL SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }
  }

  // Save and restore process.env.TAVILY_API_KEY for tests
  const originalTavilyKey = process.env.TAVILY_API_KEY;

  // =========================================================================
  // 1. Definition Test
  // =========================================================================
  await test('web-search.json tool definition includes query search and crawl inputs/outputs', async () => {
    const service = new NodeDefinitionsService();
    const defs = await service.getAllDefinitions();
    const webSearchDef = defs.find((d) => d.id === 'web-search');
    assert.ok(webSearchDef, 'web-search definition must exist');
    assert.strictEqual(webSearchDef.name, 'Web Search');
    assert.strictEqual(webSearchDef.category, 'Integration');

    // Verify key inputs
    const inputNames = webSearchDef.inputs.map((i) => i.name);
    assert.ok(inputNames.includes('mode'), 'Must have mode selector');
    assert.ok(inputNames.includes('query'), 'Must have query input');
    assert.ok(inputNames.includes('provider'), 'Must have provider input');
    assert.ok(inputNames.includes('maxResults'), 'Must have maxResults input');
    assert.ok(inputNames.includes('searchDepth'), 'Must have searchDepth input');
    assert.ok(inputNames.includes('topic'), 'Must have topic input');
    assert.ok(inputNames.includes('timeRange'), 'Must have timeRange input');
    assert.ok(inputNames.includes('includeDomains'), 'Must have includeDomains input');
    assert.ok(inputNames.includes('excludeDomains'), 'Must have excludeDomains input');
    assert.ok(inputNames.includes('includeAnswer'), 'Must have includeAnswer input');
    assert.ok(inputNames.includes('url'), 'Must have url input');
    assert.ok(inputNames.includes('maxContentLength'), 'Must have maxContentLength input');
    assert.ok(inputNames.includes('engine'), 'Must have engine input');

    // Verify default mode
    const modeInput = webSearchDef.inputs.find((i) => i.name === 'mode');
    assert.strictEqual(modeInput?.defaultValue, 'search', 'Default mode should be search');

    // Verify outputs (event-driven: done and onFailed)
    const outputNames = webSearchDef.outputs.map((o) => o.name);
    assert.ok(outputNames.includes('done'), 'Must have done output handle');
    assert.ok(outputNames.includes('onFailed'), 'Must have onFailed output handle');
    assert.strictEqual(webSearchDef.outputs.length, 2, 'Must have exactly 2 event output handles');
  });

  // =========================================================================
  // 2. Search Option Sanitization and Safe Capping
  // =========================================================================
  await test('TavilySearchService bounds maxResults between 1 and 20 (safe maximum)', async () => {
    const tavily = new TavilySearchService();

    // Oversized maxResults caps to 20
    const over = tavily.sanitizeParams({ query: 'test', maxResults: 100 });
    assert.strictEqual(over.maxResults, SAFE_MAX_RESULTS);

    // Negative or 0 defaults to 5
    const under = tavily.sanitizeParams({ query: 'test', maxResults: 0 });
    assert.strictEqual(under.maxResults, DEFAULT_MAX_RESULTS);

    // Valid number within range is preserved
    const valid = tavily.sanitizeParams({ query: 'test', maxResults: 12 });
    assert.strictEqual(valid.maxResults, 12);

    // Float is floored
    const floored = tavily.sanitizeParams({ query: 'test', maxResults: 7.8 });
    assert.strictEqual(floored.maxResults, 7);

    // Empty query throws BadRequestException
    assert.throws(
      () => tavily.sanitizeParams({ query: '   ' }),
      (err: any) => err instanceof BadRequestException && err.message.includes('required'),
    );
  });

  await test('TavilySearchService sanitizes domain lists and options correctly', async () => {
    const tavily = new TavilySearchService();
    const sanitized = tavily.sanitizeParams({
      query: 'deep learning',
      searchDepth: 'advanced',
      topic: 'news',
      timeRange: 'week',
      includeDomains: 'https://arxiv.org/abs, github.com',
      excludeDomains: ['http://reddit.com/r/all', 'pinterest.com'],
      includeAnswer: 'true',
      includeRawContent: true,
      includeImages: 'true',
      language: 'en',
    });

    assert.strictEqual(sanitized.searchDepth, 'advanced');
    assert.strictEqual(sanitized.topic, 'news');
    assert.strictEqual(sanitized.timeRange, 'week');
    assert.deepStrictEqual(sanitized.includeDomains, ['arxiv.org', 'github.com']);
    assert.deepStrictEqual(sanitized.excludeDomains, ['reddit.com', 'pinterest.com']);
    assert.strictEqual(sanitized.includeAnswer, true);
    assert.strictEqual(sanitized.includeRawContent, true);
    assert.strictEqual(sanitized.includeImages, true);
    assert.strictEqual(sanitized.language, 'en');
  });

  // =========================================================================
  // 3. Tavily API Key Resolution & Missing Key Errors
  // =========================================================================
  await test('TavilySearchService throws BadRequestException when API key is missing without leaking secrets', async () => {
    delete process.env.TAVILY_API_KEY;
    const tavily = new TavilySearchService();

    let threw = false;
    try {
      await tavily.search({ query: 'quantum computing' });
    } catch (err: any) {
      threw = true;
      assert.ok(err instanceof BadRequestException);
      assert.ok(err.message.includes('Tavily API key is missing'));
      assert.ok(!err.message.includes('tvly-'));
    }
    assert.ok(threw, 'Should throw BadRequestException for missing API key');
  });

  // =========================================================================
  // 4. Tavily Response Normalization
  // =========================================================================
  await test('TavilySearchService normalizes provider results accurately without inventing fields', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-mock-key';
    const tavily = new TavilySearchService();

    const mockTavilyApiResponse = {
      query: 'generative ai trends 2026',
      response_time: 0.94,
      answer: 'Generative AI in 2026 focuses on autonomous reasoning agents.',
      images: ['https://example.com/chart.png'],
      results: [
        {
          title: 'Top AI Trends 2026',
          url: 'https://techblog.example/trends',
          content: 'Here are the primary trends in reasoning models and agent orchestration.',
          score: 0.982,
          published_date: '2026-02-15T12:00:00Z',
          favicon: 'https://techblog.example/favicon.ico',
        },
        {
          title: 'Autonomous Systems Overview',
          url: 'https://news.example/autonomous-ai',
          content: 'Analysis of production agent deployments across enterprises.',
          // Score and published_date omitted to test non-invention
        },
      ],
      usage: { credits_used: 1 },
    };

    // Mock global fetch
    const originalFetch = global.fetch;
    (global as any).fetch = async (url: string, init: any) => {
      // Verify Authorization header
      assert.strictEqual(init.headers['Authorization'], 'Bearer tvly-test-mock-key');
      const body = JSON.parse(init.body);
      assert.strictEqual(body.query, 'generative ai trends 2026');
      assert.strictEqual(body.max_results, 5);

      return {
        ok: true,
        status: 200,
        json: async () => mockTavilyApiResponse,
      } as any;
    };

    try {
      const response = await tavily.search({
        query: 'generative ai trends 2026',
        maxResults: 5,
      });

      assert.strictEqual(response.query, 'generative ai trends 2026');
      assert.strictEqual(response.provider, 'tavily');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.resultsCount, 2);
      assert.strictEqual(response.responseTime, 0.94);
      assert.strictEqual(response.answer, 'Generative AI in 2026 focuses on autonomous reasoning agents.');
      assert.deepStrictEqual(response.images, ['https://example.com/chart.png']);
      assert.strictEqual(response.usage?.credits_used, 1);

      // First result checks
      const r1 = response.results[0];
      assert.strictEqual(r1.title, 'Top AI Trends 2026');
      assert.strictEqual(r1.url, 'https://techblog.example/trends');
      assert.strictEqual(r1.content, 'Here are the primary trends in reasoning models and agent orchestration.');
      assert.strictEqual(r1.score, 0.982);
      assert.strictEqual(r1.publishedDate, '2026-02-15T12:00:00Z');
      assert.strictEqual(r1.favicon, 'https://techblog.example/favicon.ico');

      // Second result checks (fields not returned must not be invented)
      const r2 = response.results[1];
      assert.strictEqual(r2.title, 'Autonomous Systems Overview');
      assert.strictEqual(r2.score, undefined, 'Score must not be invented if omitted by provider');
      assert.strictEqual(r2.publishedDate, undefined, 'Published date must not be invented if omitted');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // =========================================================================
  // 5. Provider Error Handling
  // =========================================================================
  await test('TavilySearchService maps HTTP 401/403 to UnauthorizedException without exposing API key', async () => {
    process.env.TAVILY_API_KEY = 'tvly-invalid-secret-key';
    const tavily = new TavilySearchService();

    const originalFetch = global.fetch;
    (global as any).fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: { error: 'Invalid API key provided' } }),
    });

    try {
      await tavily.search({ query: 'test query' });
      assert.fail('Should have thrown UnauthorizedException');
    } catch (err: any) {
      assert.ok(err instanceof UnauthorizedException);
      assert.ok(!err.message.includes('tvly-invalid-secret-key'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('TavilySearchService maps HTTP 429 to HttpException (TOO_MANY_REQUESTS)', async () => {
    process.env.TAVILY_API_KEY = 'tvly-valid-key';
    const tavily = new TavilySearchService();

    const originalFetch = global.fetch;
    (global as any).fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ detail: 'Monthly limit exceeded' }),
    });

    try {
      await tavily.search({ query: 'test query' });
      assert.fail('Should have thrown 429 HttpException');
    } catch (err: any) {
      assert.strictEqual(err.getStatus(), 429);
      assert.ok(err.message.includes('rate limit') || err.message.includes('credit quota'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('TavilySearchService maps HTTP 500 to BadGatewayException', async () => {
    process.env.TAVILY_API_KEY = 'tvly-valid-key';
    const tavily = new TavilySearchService();

    const originalFetch = global.fetch;
    (global as any).fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Temporarily Unavailable',
    });

    try {
      await tavily.search({ query: 'test query' });
      assert.fail('Should have thrown BadGatewayException');
    } catch (err: any) {
      assert.ok(err instanceof BadGatewayException);
      assert.ok(err.message.includes('unavailable'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('TavilySearchService handles malformed non-JSON response cleanly', async () => {
    process.env.TAVILY_API_KEY = 'tvly-valid-key';
    const tavily = new TavilySearchService();

    const originalFetch = global.fetch;
    (global as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    try {
      await tavily.search({ query: 'test query' });
      assert.fail('Should have thrown BadGatewayException for malformed response');
    } catch (err: any) {
      assert.ok(err instanceof BadGatewayException);
      assert.ok(err.message.includes('Malformed response'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  // =========================================================================
  // 6. WebSearchRunnerService Search Mode Execution & Variable Resolution
  // =========================================================================
  await test('WebSearchRunnerService executes search mode and resolves mustache variables', async () => {
    const variableResolver = new VariableResolverService();
    const mockTavily = new TavilySearchService();

    let capturedParams: any = null;
    mockTavily.search = async (params) => {
      capturedParams = params;
      return {
        query: params.query,
        provider: 'tavily',
        status: 200,
        results: [
          {
            title: 'Neural Networks 2026',
            url: 'https://ai.example.org/nn',
            content: 'Latest transformer architectures and benchmark comparisons.',
            score: 0.95,
          },
        ],
        resultsCount: 1,
        responseTime: 0.82,
        answer: 'Neural network architectures have advanced with modular routing.',
      };
    };

    const runner = new WebSearchRunnerService(variableResolver, {} as any, mockTavily);

    const context = {
      input: {
        researchTopic: 'state of deep learning',
        limit: 8,
      },
    };

    const result = await runner.executeWebSearchNode(
      {
        id: 'node-search-1',
        data: {
          config: {
            mode: 'search',
            query: '{{input.researchTopic}}',
            maxResults: '{{input.limit}}',
            provider: 'tavily',
            topic: 'general',
          },
        },
      },
      {},
      context,
      'run-search-1',
    );

    assert.strictEqual(capturedParams.query, 'state of deep learning');
    assert.strictEqual(capturedParams.maxResults, 8);
    assert.strictEqual(result.provider, 'tavily');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.resultsCount, 1);
    assert.strictEqual(result.title, 'Neural Networks 2026', 'Top result title alias exposed');
    assert.strictEqual(result.url, 'https://ai.example.org/nn', 'Top result url alias exposed');
    assert.ok(result.text?.includes('Neural network architectures'), 'Top result text alias exposed');
    assert.strictEqual(result.results?.[0].title, 'Neural Networks 2026');
  });

  await test('WebSearchRunnerService rejects unsupported provider', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    await assert.rejects(
      async () => {
        await runner.executeWebSearchNode(
          {
            id: 'node-search-bad-prov',
            data: {
              config: {
                mode: 'search',
                query: 'test query',
                provider: 'unsupported-engine',
              },
            },
          },
          {},
          {},
          'run-bad-prov',
        );
      },
      (err: any) =>
        err instanceof BadRequestException &&
        err.message.includes('Unsupported web search provider "unsupported-engine"'),
    );
  });

  await test('WebSearchRunnerService rejects empty search query in search mode', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    await assert.rejects(
      async () => {
        await runner.executeWebSearchNode(
          {
            id: 'node-search-empty',
            data: {
              config: {
                mode: 'search',
                query: '',
              },
            },
          },
          {},
          {},
          'run-empty',
        );
      },
      (err: any) =>
        err instanceof BadRequestException &&
        err.message.includes('Web Search query mode requires a valid non-empty "query" parameter'),
    );
  });

  // =========================================================================
  // 7. Regression: URL Crawling & Extraction Modes
  // =========================================================================
  await test('WebSearchRunnerService parses HTML, cleans boilerplate, and extracts absolute links (fetch_and_clean)', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Engineering Blog - Acme Corp</title>
          <script>console.log("tracker code");</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <nav><a href="/home">Home</a></nav>
          <main>
            <h1>Latest Announcements</h1>
            <p>Welcome to our tech updates.</p>
            <article>
              <h2><a href="/blog/ai-future">The Future of AI in 2026</a></h2>
              <p>Large language models continue to evolve rapidly with agentic reasoning.</p>
            </article>
            <article>
              <h2><a href="https://other.com/post-2">Distributed Systems Insights</a></h2>
              <p>Consistency, partition tolerance, and high availability.</p>
            </article>
          </main>
          <footer>Footer copyright info</footer>
        </body>
      </html>
    `;

    (runner as any).httpFetch = async (url: string) => ({
      html: sampleHtml,
      status: 200,
      finalUrl: url,
    });

    const result = await runner.executeWebSearchNode(
      {
        id: 'node-1',
        data: {
          config: {
            url: 'https://acme.org',
            mode: 'fetch_and_clean',
          },
        },
      } as any,
      {},
      {},
      'run-123',
    );

    assert.strictEqual(result.title, 'Engineering Blog - Acme Corp');
    assert.strictEqual(result.status, 200);
    assert.ok((result.links?.length || 0) >= 2, 'Should extract relative and absolute links');
    assert.ok(
      result.links?.some((l) => l.href === 'https://acme.org/blog/ai-future'),
      'Relative links resolved to absolute',
    );
    assert.ok(!result.html?.includes('<script>'), 'Scripts must be stripped');
    assert.ok(!result.html?.includes('<style>'), 'Styles must be stripped');
    assert.ok(result.text?.includes('The Future of AI in 2026'), 'Text should contain article title');
  });

  await test('WebSearchRunnerService article mode focuses on article content (read_article)', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    const articleHtml = `
      <html>
        <head><title>Deep Dive Article</title></head>
        <body>
          <div class="sidebar">Sidebar ads and links</div>
          <article>
            <h1>Architecture Patterns in 2026</h1>
            <p>Here is the full text of the article explaining event-driven microservices.</p>
          </article>
        </body>
      </html>
    `;

    (runner as any).httpFetch = async (url: string) => ({
      html: articleHtml,
      status: 200,
      finalUrl: url,
    });

    const result = await runner.executeWebSearchNode(
      {
        id: 'node-2',
        data: {
          config: {
            url: 'https://acme.org/blog/architecture',
            mode: 'read_article',
          },
        },
      } as any,
      {},
      {},
      'run-456',
    );

    assert.strictEqual(result.title, 'Deep Dive Article');
    assert.ok(result.text?.includes('# Architecture Patterns in 2026'), 'Markdown title formatted');
    assert.ok(result.text?.includes('Here is the full text of the article'), 'Article body present');
  });

  await test('WebSearchRunnerService detects Cloudflare challenge and auto-upgrades to Playwright', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    (runner as any).httpFetch = async (url: string) => ({
      html: '<html><head><title>Just a moment...</title></head><body>cf-mitigated challenge screen</body></html>',
      status: 403,
      finalUrl: url,
    });

    let playwrightCalled = false;
    (runner as any).playwrightFetch = async (url: string) => {
      playwrightCalled = true;
      return {
        html: '<html><head><title>Actual Blog Content</title></head><body><article><h1>Actual Content</h1><p>Bypassed Cloudflare successfully!</p><a href="/blog/post-1">Post 1</a></article></body></html>',
        status: 200,
        title: 'Actual Blog Content',
        finalUrl: url,
      };
    };

    const result = await runner.executeWebSearchNode(
      {
        id: 'node-3',
        data: {
          config: {
            url: 'https://resumegenius.com/blog',
            mode: 'fetch_and_clean',
            engine: 'fetch',
          },
        },
      } as any,
      {},
      {},
      'run-789',
    );

    assert.ok(playwrightCalled, 'Should have triggered playwrightFetch upon detecting Cloudflare challenge');
    assert.strictEqual(result.title, 'Actual Blog Content');
    assert.strictEqual(result.status, 200);
    assert.ok(result.text?.includes('Bypassed Cloudflare successfully!'));
    assert.strictEqual(result.links?.length, 1);
  });

  await test('WebSearchRunnerService rejects missing url in crawl mode', async () => {
    const variableResolver = new VariableResolverService();
    const runner = new WebSearchRunnerService(variableResolver, {} as any);

    await assert.rejects(
      async () => {
        await runner.executeWebSearchNode(
          {
            id: 'node-no-url',
            data: {
              config: {
                mode: 'fetch_and_clean',
                url: '',
              },
            },
          },
          {},
          {},
          'run-no-url',
        );
      },
      (err: any) =>
        err instanceof BadRequestException &&
        err.message.includes('Web Search block requires a valid "url" parameter'),
    );
  });

  // Restore env key
  if (originalTavilyKey !== undefined) {
    process.env.TAVILY_API_KEY = originalTavilyKey;
  } else {
    delete process.env.TAVILY_API_KEY;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
