import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';

// ============================================================================
// Type Definitions & Interfaces
// ============================================================================

export interface BrowserAppState {
  appId: string;
  type: 'browser';
  status: 'starting' | 'ready' | 'failed' | 'closed';
  sessionId: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  pageUrl?: string;
  title?: string;
  lastAction?: string;
}

export interface BrowserAction {
  type: string;
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  key?: string;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout?: number;
  milliseconds?: number;
  width?: number;
  height?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  filename?: string;
  fullPage?: boolean;
  quality?: number;
  expected?: string;
  [key: string]: any;
}

export interface BrowserNodeConfig {
  headless?: boolean;
  deviceScaleFactor?: number;
  viewport?: { width: number; height: number };
  url?: string;
  actions?: BrowserAction[] | string;
  [key: string]: any;
}

export interface ExtractedDomResult {
  html: string;
  css: string;
  standaloneHtml: string;
}

export interface BrowserExecutionOutput {
  appId: string;
  status: string;
  url?: string;
  title?: string;
  actions: any[];
  path?: string;
  screenshot?: string;
  text?: string;
  html?: string;
  css?: string;
  standaloneHtml?: string;
  [key: string]: any;
}

// ============================================================================
// Browser Runner Service
// ============================================================================

@Injectable()
export class BrowserRunnerService {
  private readonly logger = new Logger(BrowserRunnerService.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  // --------------------------------------------------------------------------
  // Main Execution Method
  // --------------------------------------------------------------------------

  /**
   * Execute a browser workflow node with automated page lifecycle, viewport setup,
   * navigation, and action sequencing.
   */
  public async executeBrowserNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    runId: string,
  ): Promise<BrowserExecutionOutput> {
    const playwright = this.loadPlaywrightRuntime();
    const data = node.data || {};
    const config: BrowserNodeConfig = nodeInput || data.config || {};
    const appId = String(data.appId || data.name || data.nodeName || 'browser');

    // Retrieve or initialize session state
    const appState = await this.getOrCreateBrowserSession(appId, context, config, playwright, runId);
    const page = appState.page!;
    const actions = this.parseBrowserActions(config.actions);
    const results: any[] = [];

    try {
      // 1. Viewport configuration
      if (config.viewport) {
        await page.setViewportSize(config.viewport);
      }

      // 2. Initial page navigation if specified
      if (config.url) {
        const resolvedUrl = String(this.variableResolver.resolveValue(config.url, context));
        await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded' });
        results.push({ action: 'goto', url: resolvedUrl, success: true });
      }

      // 3. Sequential action execution
      for (const action of actions) {
        const actionResult = await this.executeBrowserAction(page, action, context, runId, appId);
        results.push(actionResult);
      }

      // 4. Update session metadata
      appState.pageUrl = page.url();
      appState.title = await page.title().catch(() => undefined);
      appState.lastAction = results[results.length - 1]?.action;
      appState.status = 'ready';

      return this.buildExecutionOutput(appId, appState, results);
    } catch (err: any) {
      appState.status = 'failed';
      this.logger.error(`❌ [Browser Node Error] App: "${appId}" failed: ${err.message}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Action Parser
  // --------------------------------------------------------------------------

  /**
   * Parse actions from either an array or a JSON-encoded string into a typed action array.
   */
  public parseBrowserActions(rawActions: any): BrowserAction[] {
    if (!rawActions) return [];
    if (Array.isArray(rawActions)) return rawActions;
    if (typeof rawActions === 'string') {
      try {
        const parsed = JSON.parse(rawActions);
        if (!Array.isArray(parsed)) {
          throw new Error('Actions must be an array');
        }
        return parsed;
      } catch (error: any) {
        throw new BadRequestException(`Invalid Browser actions JSON: ${error.message}`);
      }
    }
    throw new BadRequestException('Browser actions must be an array');
  }

  // --------------------------------------------------------------------------
  // Action Dispatcher
  // --------------------------------------------------------------------------

  /**
   * Route and execute an individual browser action.
   */
  public async executeBrowserAction(
    page: Page,
    action: BrowserAction,
    context: Record<string, any>,
    runId: string,
    appId: string,
  ): Promise<any> {
    const actionType = String(action?.type || '').toLowerCase();
    const selector = action?.selector
      ? String(this.variableResolver.resolveValue(action.selector, context))
      : undefined;

    switch (actionType) {
      // --- Navigation Actions ---
      case 'goto':
      case 'reload':
      case 'back':
      case 'forward':
        return this.executeNavigationAction(page, actionType, action, context);

      // --- Interaction Actions ---
      case 'click':
      case 'dblclick':
      case 'doubleclick':
      case 'hover':
      case 'fill':
      case 'type':
      case 'press':
        return this.executeInteractionAction(page, actionType, action, selector, context);

      // --- Timing & Viewport Actions ---
      case 'waitforselector':
      case 'waitfortimeout':
      case 'wait':
      case 'sleep':
      case 'setviewport':
        return this.executeTimingOrViewportAction(page, actionType, action, selector);

      // --- Content Inspection Actions ---
      case 'gettext':
      case 'gethtml':
      case 'gettitle':
        return this.executeInspectionAction(page, actionType, selector);

      // --- Extraction & Visual Capture ---
      case 'extractelement':
      case 'extract_element':
      case 'elementextractor':
      case 'element_extractor':
      case 'extractElement':
        return this.executeExtractElementAction(page, selector, action, context, runId);

      case 'screenshot':
        return this.executeScreenshotAction(page, selector, action, context, runId, appId);

      // --- Assertion Actions ---
      case 'assertvisible':
      case 'asserttext':
        return this.executeAssertionAction(page, actionType, selector, action, context);

      default:
        throw new BadRequestException(`Unsupported Browser action: ${actionType || 'unknown'}`);
    }
  }

  // --------------------------------------------------------------------------
  // Modular Action Handlers
  // --------------------------------------------------------------------------

  private async executeNavigationAction(
    page: Page,
    actionType: string,
    action: BrowserAction,
    context: Record<string, any>,
  ): Promise<any> {
    if (actionType === 'goto') {
      const url = String(this.variableResolver.resolveValue(action.url, context));
      await page.goto(url, { waitUntil: action.waitUntil || 'domcontentloaded' });
      return { action: 'goto', url, success: true };
    }
    if (actionType === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      return { action: actionType, url: page.url(), success: true };
    }
    if (actionType === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded' });
      return { action: actionType, url: page.url(), success: true };
    }
    if (actionType === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded' });
      return { action: actionType, url: page.url(), success: true };
    }
  }

  private async executeInteractionAction(
    page: Page,
    actionType: string,
    action: BrowserAction,
    selector: string | undefined,
    context: Record<string, any>,
  ): Promise<any> {
    if (!selector) {
      throw new BadRequestException(`Browser ${actionType} action requires selector`);
    }

    switch (actionType) {
      case 'click':
        await page.click(selector);
        return { action: actionType, selector, success: true };

      case 'dblclick':
      case 'doubleclick':
        await page.dblclick(selector);
        return { action: 'doubleClick', selector, success: true };

      case 'hover':
        await page.hover(selector);
        return { action: actionType, selector, success: true };

      case 'fill':
      case 'type': {
        const textVal = String(
          this.variableResolver.resolveValue(action.text ?? action.value ?? '', context),
        );
        await page.fill(selector, textVal);
        return { action: actionType, selector, success: true };
      }

      case 'press': {
        const key = String(this.variableResolver.resolveValue(action.key, context));
        await page.press(selector, key);
        return { action: actionType, selector, key, success: true };
      }
    }
  }

  private async executeTimingOrViewportAction(
    page: Page,
    actionType: string,
    action: BrowserAction,
    selector: string | undefined,
  ): Promise<any> {
    if (actionType === 'waitforselector') {
      if (!selector) throw new BadRequestException('Browser waitForSelector action requires selector');
      await page.waitForSelector(selector, {
        state: action.state || 'visible',
        timeout: action.timeout || 10000,
      });
      return { action: actionType, selector, success: true };
    }

    if (actionType === 'waitfortimeout' || actionType === 'wait' || actionType === 'sleep') {
      const ms = Number(action.milliseconds || action.timeout || 500);
      await page.waitForTimeout(ms);
      return { action: actionType, success: true };
    }

    if (actionType === 'setviewport') {
      const width = Number(action.width);
      const height = Number(action.height);
      await page.setViewportSize({ width, height });
      return { action: actionType, width, height, success: true };
    }
  }

  private async executeInspectionAction(
    page: Page,
    actionType: string,
    selector: string | undefined,
  ): Promise<any> {
    if (actionType === 'gettext') {
      if (!selector) throw new BadRequestException('Browser getText action requires selector');
      const text = await page.textContent(selector);
      return { action: actionType, selector, text, success: true };
    }

    if (actionType === 'gethtml') {
      const html = selector ? await page.locator(selector).innerHTML() : await page.content();
      return { action: actionType, selector, html, success: true };
    }

    if (actionType === 'gettitle') {
      const title = await page.title();
      return { action: actionType, title, success: true };
    }
  }

  private async executeExtractElementAction(
    page: Page,
    selector: string | undefined,
    action: BrowserAction,
    context: Record<string, any>,
    runId: string,
  ): Promise<any> {
    if (!selector) {
      throw new BadRequestException('Browser extractElement action requires selector');
    }

    let targetSelector = selector.trim();
    let locator = page.locator(targetSelector);
    const count = await locator.count().catch(() => 0);

    // Fallback: If selector is an un-prefixed ID, try `#id`
    if (
      count === 0 &&
      !targetSelector.startsWith('#') &&
      !targetSelector.startsWith('.') &&
      !targetSelector.startsWith('[')
    ) {
      const idLocator = page.locator(`#${targetSelector}`);
      if ((await idLocator.count().catch(() => 0)) > 0) {
        locator = idLocator;
        targetSelector = `#${targetSelector}`;
      }
    }

    // Evaluate DOM element subtree and inline computed CSS styles
    const result: ExtractedDomResult = await locator.first().evaluate((el: HTMLElement) => {
      const matchedRules: string[] = [];
      const ruleSet = new Set<string>();

      // Collect all elements inside the target subtree
      const allElements = [el, ...Array.from(el.querySelectorAll('*'))];

      // Recursively collect CSS rules (including @media, @supports, etc.)
      function getRulesList(ruleList: any): any[] {
        const list: any[] = [];
        for (const rule of Array.from(ruleList || [])) {
          try {
            if (rule instanceof CSSStyleRule) {
              list.push(rule);
            } else if ((rule as any).cssRules && (rule as any).cssRules.length > 0) {
              list.push(...getRulesList((rule as any).cssRules));
            }
          } catch {
            // Ignore access errors on individual rules
          }
        }
        return list;
      }

      // Iterate through loaded styleSheets to match CSS rules
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = getRulesList(sheet.cssRules || (sheet as any).rules || []);
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule && rule.selectorText) {
              const applies = allElements.some((item) => {
                try {
                  if (item.matches(rule.selectorText)) return true;
                } catch {}
                try {
                  const cleaned = rule.selectorText.replace(/::?[a-zA-Z-]+/g, '').trim();
                  if (cleaned && item.matches(cleaned)) return true;
                } catch {}
                return false;
              });

              if (applies && rule.cssText && !ruleSet.has(rule.cssText)) {
                ruleSet.add(rule.cssText);
                matchedRules.push(rule.cssText);
              }
            }
          }
        } catch {
          // Skips cross-origin stylesheets that restrict access
        }
      }

      // Inlining computed styles for standalone HTML export
      function inlineComputedStyles(node: HTMLElement) {
        if (!node || node.nodeType !== 1) return;
        try {
          const computed = window.getComputedStyle(node);
          let cssText = '';
          for (let i = 0; i < computed.length; i++) {
            const prop = computed[i];
            cssText += `${prop}:${computed.getPropertyValue(prop)};`;
          }
          node.setAttribute('style', cssText);
        } catch {}

        Array.from(node.children).forEach((child) =>
          inlineComputedStyles(child as HTMLElement),
        );
      }

      const clone = el.cloneNode(true) as HTMLElement;
      inlineComputedStyles(clone);

      return {
        html: el.outerHTML,
        css: matchedRules.join('\n'),
        standaloneHtml: clone.outerHTML,
      };
    });

    // Write extracted HTML to disk if a filename was requested
    let filePath: string | undefined = undefined;
    const resolvedFilename =
      action.filename !== undefined && action.filename !== null && action.filename !== ''
        ? this.variableResolver.resolveValue(action.filename, context)
        : undefined;

    if (resolvedFilename) {
      const outputDir = this.getExtractedDir(runId);
      await mkdir(outputDir, { recursive: true });

      const baseName = path.basename(String(resolvedFilename));
      const filename = baseName.endsWith('.html') || baseName.endsWith('.htm')
        ? baseName
        : `${baseName}.html`;

      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join(outputDir, safeFilename);

      await writeFile(filePath, result.standaloneHtml || result.html, 'utf-8');
      this.logger.log(`   📄 [Extracted Element HTML Saved] ${filePath}`);
    }

    return {
      action: 'extractElement',
      selector: targetSelector,
      html: result.html,
      css: result.css,
      standaloneHtml: result.standaloneHtml,
      ...(filePath ? { path: filePath } : {}),
      success: true,
    };
  }

  private async executeScreenshotAction(
    page: Page,
    selector: string | undefined,
    action: BrowserAction,
    context: Record<string, any>,
    runId: string,
    appId: string,
  ): Promise<any> {
    const outputDir = this.getScreenshotsDir(runId);
    await mkdir(outputDir, { recursive: true });

    const resolvedFilename =
      action.filename !== undefined && action.filename !== null && action.filename !== ''
        ? this.variableResolver.resolveValue(action.filename, context)
        : undefined;

    const baseName = path.basename(String(resolvedFilename || `${appId}-${Date.now()}.png`));
    const filename =
      baseName.endsWith('.png') || baseName.endsWith('.jpg') || baseName.endsWith('.jpeg')
        ? baseName
        : `${baseName}.png`;

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(outputDir, safeFilename);

    const screenshotOptions: any = {
      path: filePath,
      fullPage: Boolean(action.fullPage),
      animations: 'disabled',
      scale: 'device',
    };

    if (action.quality && (filename.endsWith('.jpg') || filename.endsWith('.jpeg'))) {
      screenshotOptions.quality = Number(action.quality);
    }

    if (selector) {
      await page.locator(selector).screenshot(screenshotOptions);
    } else {
      await page.screenshot(screenshotOptions);
    }

    this.logger.log(`   📸 [High-Res Screenshot Saved] ${filePath}`);
    return { action: 'screenshot', path: filePath, screenshot: filePath, success: true };
  }

  private async executeAssertionAction(
    page: Page,
    actionType: string,
    selector: string | undefined,
    action: BrowserAction,
    context: Record<string, any>,
  ): Promise<any> {
    if (!selector) {
      throw new BadRequestException(`Browser ${actionType} action requires selector`);
    }

    if (actionType === 'assertvisible') {
      const isVisible = await page.locator(selector).isVisible();
      if (!isVisible) {
        throw new Error(`Element is not visible: ${selector}`);
      }
      return { action: actionType, selector, passed: true };
    }

    if (actionType === 'asserttext') {
      const actual = await page.textContent(selector);
      const expected = String(
        this.variableResolver.resolveValue(action.text ?? action.expected, context),
      );
      if (!actual?.includes(expected)) {
        throw new Error(`Expected text "${expected}" in ${selector}`);
      }
      return { action: actionType, selector, expected, actual, passed: true };
    }
  }

  // --------------------------------------------------------------------------
  // Session & Lifecycle Management
  // --------------------------------------------------------------------------

  private async getOrCreateBrowserSession(
    appId: string,
    context: Record<string, any>,
    config: BrowserNodeConfig,
    playwright: any,
    runId: string,
  ): Promise<BrowserAppState> {
    const apps = context.apps || (context.apps = {});
    let appState: BrowserAppState = apps[appId];

    if (!appState) {
      const existingActiveBrowser = Object.values(apps).find(
        (a: any) => a?.type === 'browser' && a?.page,
      ) as BrowserAppState | undefined;

      if (existingActiveBrowser) {
        appState = existingActiveBrowser;
        apps[appId] = appState;
      } else {
        appState = {
          appId,
          type: 'browser',
          status: 'starting',
          sessionId: runId,
        };
        apps[appId] = appState;
      }
    }

    if (!appState.browser || !appState.page) {
      const browser = await playwright.chromium.launch({
        headless: config.headless !== false,
      });

      const deviceScaleFactor = Number(config.deviceScaleFactor || 2);
      const viewport = config.viewport || { width: 1280, height: 720 };
      const browserContext = await browser.newContext({
        deviceScaleFactor,
        viewport,
      });
      const page = await browserContext.newPage();

      appState.browser = browser;
      appState.context = browserContext;
      appState.page = page;
      appState.status = 'ready';
      apps[appId] = appState;
    }

    return appState;
  }

  private buildExecutionOutput(
    appId: string,
    appState: BrowserAppState,
    results: any[],
  ): BrowserExecutionOutput {
    const reversed = results.slice().reverse();
    const lastScreenshot = reversed.find((r) => r.action === 'screenshot' && r.path);
    const lastText = reversed.find((r) => r.text !== undefined)?.text;
    const lastHtml = reversed.find((r) => r.html !== undefined)?.html;
    const lastCss = reversed.find((r) => r.css !== undefined)?.css;
    const lastStandaloneHtml = reversed.find((r) => r.standaloneHtml !== undefined)?.standaloneHtml;
    const lastExtractedPath = reversed.find(
      (r) => (r.action === 'extractElement' || r.action === 'extractelement') && r.path,
    )?.path;

    const outputPayload: BrowserExecutionOutput = {
      appId,
      status: appState.status,
      url: appState.pageUrl,
      title: appState.title,
      actions: results,
    };

    if (lastScreenshot?.path) {
      outputPayload.path = lastScreenshot.path;
      outputPayload.screenshot = lastScreenshot.path;
    } else if (lastExtractedPath) {
      outputPayload.path = lastExtractedPath;
    }

    if (lastText !== undefined) outputPayload.text = lastText;
    if (lastHtml !== undefined) outputPayload.html = lastHtml;
    if (lastCss !== undefined) outputPayload.css = lastCss;
    if (lastStandaloneHtml !== undefined) outputPayload.standaloneHtml = lastStandaloneHtml;

    return outputPayload;
  }

  /**
   * Safely terminate all active browsers and contexts attached to the runtime context.
   */
  public async closeRuntimeApps(context: Record<string, any>): Promise<void> {
    const apps = context.apps || {};
    for (const app of Object.values(apps) as any[]) {
      try {
        if (app?.page?.close) {
          await app.page.close().catch(() => undefined);
        }
        if (app?.context?.close) {
          await app.context.close().catch(() => undefined);
        }
        if (app?.browser?.close) {
          await app.browser.close().catch(() => undefined);
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ Error closing browser app "${app?.appId}": ${err?.message}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Directory & Storage Management
  // --------------------------------------------------------------------------

  public getScreenshotsDir(runId: string): string {
    return this.resolveStorageDirectory('screenshots', runId);
  }

  public getExtractedDir(runId: string): string {
    return this.resolveStorageDirectory('extracted', runId);
  }

  private resolveStorageDirectory(category: 'screenshots' | 'extracted', runId: string): string {
    const candidateDirs = [
      path.resolve(process.cwd(), '..', 'files', category),
      path.resolve(process.cwd(), 'files', category),
      path.resolve(__dirname, '..', '..', '..', '..', 'files', category),
      path.resolve(__dirname, '..', '..', '..', 'files', category),
    ];

    const baseDir =
      candidateDirs.find((dir) => existsSync(dir)) ||
      path.resolve(process.cwd(), '..', 'files', category);

    return path.join(baseDir, runId);
  }

  private loadPlaywrightRuntime(): any {
    try {
      return require('playwright');
    } catch {
      throw new Error('Browser runtime requires the "playwright" package to be installed');
    }
  }
}
