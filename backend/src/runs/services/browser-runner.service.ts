import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { VariableResolverService, RuntimeNode } from './variable-resolver.service';

@Injectable()
export class BrowserRunnerService {
  private readonly logger = new Logger(BrowserRunnerService.name);

  constructor(private readonly variableResolver: VariableResolverService) {}

  async executeBrowserNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    runId: string,
  ): Promise<any> {
    let playwright: any;
    try {
      // Keep Playwright optional at build time; the runtime error below is explicit
      // when the backend has not installed the browser dependency yet.
      playwright = require('playwright');
    } catch {
      throw new Error('Browser runtime requires the "playwright" package to be installed');
    }

    const data = node.data || {};
    const config = nodeInput || data.config || {};
    const appId = data.appId || data.name || data.nodeName || 'browser';
    const apps = context.apps || (context.apps = {});
    let appState = apps[appId];

    if (!appState) {
      // If no specific instance for this appId, check if there's already an active browser session in context
      const existingActiveBrowser = Object.values(apps).find((a: any) => a?.type === 'browser' && a?.page);
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

    const page = appState.page;
    const actions = this.parseBrowserActions(config.actions);
    const results: any[] = [];

    if (config.viewport) {
      await page.setViewportSize(config.viewport);
    }

    if (config.url) {
      const url = this.variableResolver.resolveValue(config.url, context);
      await page.goto(String(url), { waitUntil: 'domcontentloaded' });
      results.push({ action: 'goto', url: String(url), success: true });
    }

    for (const action of actions) {
      results.push(await this.executeBrowserAction(page, action, context, runId, appId));
    }

    appState.pageUrl = page.url();
    appState.title = await page.title().catch(() => undefined);
    appState.lastAction = results[results.length - 1]?.action;
    apps[appId] = {
      ...appState,
      appId,
      type: 'browser',
      status: appState.status,
      sessionId: runId,
      pageUrl: appState.pageUrl,
      title: appState.title,
      lastAction: appState.lastAction,
      browser: appState.browser,
      page: appState.page,
    };

    const lastScreenshot = results.slice().reverse().find((r) => r.action === 'screenshot' && r.path);
    const lastText = results.slice().reverse().find((r) => r.text !== undefined)?.text;
    const lastHtml = results.slice().reverse().find((r) => r.html !== undefined)?.html;
    const lastCss = results.slice().reverse().find((r) => r.css !== undefined)?.css;
    const lastStandaloneHtml = results.slice().reverse().find((r) => r.standaloneHtml !== undefined)?.standaloneHtml;
    const lastExtractedPath = results.slice().reverse().find((r) => (r.action === 'extractElement' || r.action === 'extractelement') && r.path)?.path;

    const outputPayload: Record<string, any> = {
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
    if (lastText !== undefined) {
      outputPayload.text = lastText;
    }
    if (lastHtml !== undefined) {
      outputPayload.html = lastHtml;
    }
    if (lastCss !== undefined) {
      outputPayload.css = lastCss;
    }
    if (lastStandaloneHtml !== undefined) {
      outputPayload.standaloneHtml = lastStandaloneHtml;
    }

    return outputPayload;
  }

  parseBrowserActions(rawActions: any): any[] {
    if (!rawActions) return [];
    if (Array.isArray(rawActions)) return rawActions;
    if (typeof rawActions === 'string') {
      try {
        const parsed = JSON.parse(rawActions);
        if (!Array.isArray(parsed)) throw new Error('Actions must be an array');
        return parsed;
      } catch (error: any) {
        throw new BadRequestException(`Invalid Browser actions JSON: ${error.message}`);
      }
    }
    throw new BadRequestException('Browser actions must be an array');
  }

  async executeBrowserAction(
    page: any,
    action: any,
    context: Record<string, any>,
    runId: string,
    appId: string,
  ): Promise<any> {
    const actionType = String(action?.type || '').toLowerCase();
    const selector = action?.selector ? String(this.variableResolver.resolveValue(action.selector, context)) : undefined;

    switch (actionType) {
      case 'goto': {
        const url = String(this.variableResolver.resolveValue(action.url, context));
        await page.goto(url, { waitUntil: action.waitUntil || 'domcontentloaded' });
        return { action: 'goto', url, success: true };
      }
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded' });
        return { action: actionType, url: page.url(), success: true };
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded' });
        return { action: actionType, url: page.url(), success: true };
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded' });
        return { action: actionType, url: page.url(), success: true };
      case 'click':
        if (!selector) throw new BadRequestException('Browser click action requires selector');
        await page.click(selector);
        return { action: actionType, selector, success: true };
      case 'dblclick':
      case 'doubleclick':
        if (!selector) throw new BadRequestException('Browser doubleClick action requires selector');
        await page.dblclick(selector);
        return { action: 'doubleClick', selector, success: true };
      case 'hover':
        if (!selector) throw new BadRequestException('Browser hover action requires selector');
        await page.hover(selector);
        return { action: actionType, selector, success: true };
      case 'fill':
      case 'type':
        if (!selector) throw new BadRequestException(`Browser ${actionType} action requires selector`);
        await page.fill(selector, String(this.variableResolver.resolveValue(action.text ?? action.value ?? '', context)));
        return { action: actionType, selector, success: true };
      case 'press':
        if (!selector) throw new BadRequestException('Browser press action requires selector');
        await page.press(selector, String(this.variableResolver.resolveValue(action.key, context)));
        return { action: actionType, selector, key: action.key, success: true };
      case 'waitforselector':
        if (!selector) throw new BadRequestException('Browser waitForSelector action requires selector');
        await page.waitForSelector(selector, { state: action.state || 'visible', timeout: action.timeout || 10000 });
        return { action: actionType, selector, success: true };
      case 'waitfortimeout':
      case 'wait':
      case 'sleep':
        await page.waitForTimeout(Number(action.milliseconds || action.timeout || 500));
        return { action: actionType, success: true };
      case 'setviewport':
        await page.setViewportSize({ width: Number(action.width), height: Number(action.height) });
        return { action: actionType, width: Number(action.width), height: Number(action.height), success: true };
      case 'gettext': {
        if (!selector) throw new BadRequestException('Browser getText action requires selector');
        const text = await page.textContent(selector);
        return { action: actionType, selector, text, success: true };
      }
      case 'gethtml': {
        const html = selector ? await page.locator(selector).innerHTML() : await page.content();
        return { action: actionType, selector, html, success: true };
      }
      case 'gettitle':
        return { action: actionType, title: await page.title(), success: true };
      case 'extractelement':
      case 'extract_element':
      case 'elementextractor':
      case 'element_extractor':
      case 'extractElement': {
        if (!selector) throw new BadRequestException('Browser extractElement action requires selector');
        let targetSelector = selector.trim();
        let locator = page.locator(targetSelector);
        const count = await locator.count().catch(() => 0);
        if (count === 0 && !targetSelector.startsWith('#') && !targetSelector.startsWith('.') && !targetSelector.startsWith('[')) {
          const idLocator = page.locator(`#${targetSelector}`);
          if ((await idLocator.count().catch(() => 0)) > 0) {
            locator = idLocator;
            targetSelector = `#${targetSelector}`;
          }
        }

        const result = await locator.first().evaluate((el: HTMLElement) => {
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
              } catch {}
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
              inlineComputedStyles(child as HTMLElement)
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

        let filePath: string | undefined = undefined;
        const resolvedFilename = action.filename !== undefined && action.filename !== null && action.filename !== ''
          ? this.variableResolver.resolveValue(action.filename, context)
          : undefined;

        if (resolvedFilename) {
          const outputDir = this.getExtractedDir(runId);
          await mkdir(outputDir, { recursive: true });
          const rawFilename = String(resolvedFilename);
          const filename = rawFilename.endsWith('.html') || rawFilename.endsWith('.htm')
            ? rawFilename
            : `${rawFilename}.html`;
          filePath = path.join(outputDir, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
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
      case 'screenshot': {
        const outputDir = this.getScreenshotsDir(runId);
        await mkdir(outputDir, { recursive: true });
        const resolvedFilename = action.filename !== undefined && action.filename !== null && action.filename !== ''
          ? this.variableResolver.resolveValue(action.filename, context)
          : undefined;
        const rawFilename = String(resolvedFilename || `${appId}-${Date.now()}.png`);
        const filename = rawFilename.endsWith('.png') || rawFilename.endsWith('.jpg') || rawFilename.endsWith('.jpeg')
          ? rawFilename
          : `${rawFilename}.png`;
        const filePath = path.join(outputDir, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
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
        return { action: actionType, path: filePath, screenshot: filePath, success: true };
      }
      case 'assertvisible':
        if (!selector) throw new BadRequestException('Browser assertVisible action requires selector');
        if (!(await page.locator(selector).isVisible())) throw new Error(`Element is not visible: ${selector}`);
        return { action: actionType, selector, passed: true };
      case 'asserttext': {
        if (!selector) throw new BadRequestException('Browser assertText action requires selector');
        const actual = await page.textContent(selector);
        const expected = String(this.variableResolver.resolveValue(action.text ?? action.expected, context));
        if (!actual?.includes(expected)) throw new Error(`Expected text "${expected}" in ${selector}`);
        return { action: actionType, selector, expected, actual, passed: true };
      }
      default:
        throw new BadRequestException(`Unsupported Browser action: ${actionType || 'unknown'}`);
    }
  }

  getScreenshotsDir(runId: string): string {
    const candidateDirs = [
      path.resolve(process.cwd(), '..', 'files', 'screenshots'),
      path.resolve(process.cwd(), 'files', 'screenshots'),
      path.resolve(__dirname, '..', '..', '..', '..', 'files', 'screenshots'),
      path.resolve(__dirname, '..', '..', '..', 'files', 'screenshots'),
    ];
    const baseScreenshotsDir =
      candidateDirs.find((dir) => existsSync(dir)) ||
      path.resolve(process.cwd(), '..', 'files', 'screenshots');
    return path.join(baseScreenshotsDir, runId);
  }

  getExtractedDir(runId: string): string {
    const candidateDirs = [
      path.resolve(process.cwd(), '..', 'files', 'extracted'),
      path.resolve(process.cwd(), 'files', 'extracted'),
      path.resolve(__dirname, '..', '..', '..', '..', 'files', 'extracted'),
      path.resolve(__dirname, '..', '..', '..', 'files', 'extracted'),
    ];
    const baseExtractedDir =
      candidateDirs.find((dir) => existsSync(dir)) ||
      path.resolve(process.cwd(), '..', 'files', 'extracted');
    return path.join(baseExtractedDir, runId);
  }

  async closeRuntimeApps(context: Record<string, any>): Promise<void> {
    const apps = context.apps || {};
    for (const app of Object.values(apps) as any[]) {
      if (app?.browser?.close) {
        await app.browser.close().catch(() => undefined);
      }
    }
  }
}
