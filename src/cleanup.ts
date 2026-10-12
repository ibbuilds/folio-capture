import type { Frame, Page } from 'playwright';
import type { CaptureSettings, Intervention } from './types.ts';

type Candidate = { id: string; label: string; nuisance: string; confidence: 'known' | 'high'; button?: string; modal: boolean; stableSelector?: string };
export type CleanupResult = { removed: number; unresolved: string[]; warnings: string[]; snapshots: unknown[] };

async function activeFrame(frame: Frame, page: Page, preserve: string[]): Promise<boolean> {
  if (frame.isDetached()) return false;
  if (frame === page.mainFrame()) return true;
  try {
    const element = await frame.frameElement();
    const box = await element.boundingBox(), viewport = page.viewportSize();
    const protectedFrame = await element.evaluate((el, selectors) => selectors.some(selector => {
      try { return el instanceof Element && (el.matches(selector) || !!el.closest(selector)); } catch { return false; }
    }), preserve);
    await element.dispose();
    return !protectedFrame && !!box && box.width > 0 && box.height > 0 && box.x + box.width > 0 && box.y + box.height > 0 && (!viewport || box.y < viewport.height && box.x < viewport.width);
  } catch { return false; }
}

async function cleanupState(frame: Frame, preserve: string[]) {
  return frame.evaluate(preserve => {
    const roots: Array<Document | ShadowRoot> = [document];
    for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    return {
      main: roots.flatMap(root => Array.from(root.querySelectorAll('main, [role="main"]')).map(el => ({ inert: el.hasAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden'), filter: getComputedStyle(el).filter }))),
      roots: [document.documentElement, document.body].map(el => ({ tag: el.tagName, overflow: getComputedStyle(el).overflowY, position: getComputedStyle(el).position })),
      protected: preserve.flatMap(selector => roots.flatMap(root => { try { return Array.from(root.querySelectorAll(selector)).map(el => { const r = el.getBoundingClientRect(); return { selector, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }); } catch { return []; } })),
    };
  }, preserve);
}

/** Only dismiss known nuisance UI. Application dialogs, navigation and gates survive. */
export async function sweepCleanup(page: Page, settings: CaptureSettings, log: Intervention[], beforeIntervention?: () => Promise<void>): Promise<CleanupResult> {
  const deadline = Date.now() + settings.cleanupTimeoutMs;
  let removed = 0;
  const warnings: string[] = [], snapshots: unknown[] = [];
  for (let pass = 0; pass < settings.cleanupPasses && Date.now() < deadline; pass++) {
    let acted = false;
    for (const frame of page.frames()) {
      if (Date.now() >= deadline) break;
      if (!await activeFrame(frame, page, settings.preserveSelectors)) continue;
      const candidates = await frame.evaluate(({ preserve, dismiss, token }) => {
        const all: Element[] = [];
        const visit = (root: Document | ShadowRoot) => {
          for (const element of root.querySelectorAll('*')) {
            all.push(element);
            if (element.shadowRoot) visit(element.shadowRoot);
          }
        };
        visit(document);
        const matches = (el: Element, selectors: string[]) => selectors.some(selector => {
          try { return el.matches(selector); } catch { return false; }
        });
        const preserved = preserve.length ? all.filter(el => matches(el, preserve)) : [];
        const protectedElement = (el: Element) => {
          if (!preserved.length) return false;
          let ancestor: Element | null = el;
          while (ancestor) {
            if (preserved.includes(ancestor)) return true;
            ancestor = ancestor.parentElement ?? (ancestor.getRootNode() instanceof ShadowRoot ? (ancestor.getRootNode() as ShadowRoot).host : null);
          }
          return preserved.some(child => {
            let ancestor: Element | null = child;
            while (ancestor) {
              if (ancestor === el) return true;
              ancestor = ancestor.parentElement ?? (ancestor.getRootNode() instanceof ShadowRoot ? (ancestor.getRootNode() as ShadowRoot).host : null);
            }
            return false;
          });
        };
        const visible = (el: Element) => {
          const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        const gate = /(?:captcha|verify (?:that )?you are human|security check|access denied|paywall|sign in to continue|log in to continue|subscribe to (?:continue|read|unlock))/i;
        const cookie = /(?:cookies?|consent preferences|privacy preferences|tracking technologies|your privacy choices)/i;
        const promotion = /(?:newsletter|subscribe to (?:our|the)|(?:get|receive) .{0,20}(?:discount|off your)|(?:join|sign up for) .{0,25}(?:updates|newsletter)|(?:special|exclusive) offer)/i;
        const chat = /(?:chat with us|how can we help|talk to (?:us|sales)|start a conversation)/i;
        const results: Candidate[] = [];
        let index = 0;
        for (const element of all) {
          if (!visible(element) || protectedElement(element) || /^(HTML|BODY|MAIN)$/.test(element.tagName)) continue;
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          const text = [((element as HTMLElement).innerText ?? '').trim(), element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' ').slice(0, 3000);
          const knownCookie = /^(?:onetrust-banner-sdk|onetrust-consent-sdk|onetrust-pc-sdk|CybotCookiebotDialog|CookiebotWidget)$/.test(element.id);
          const knownChat = /^(?:intercom-container|intercom-frame|crisp-chatbox|tawk-bubble-container|hubspot-messages-iframe-container)$/.test(element.id) ||
            (element.tagName === 'IFRAME' && /(?:intercom|crisp\.chat|tawk\.to|hs-messages)/i.test(element.getAttribute('src') ?? ''));
          const explicit = matches(element, dismiss);
          const isModal = element.matches('dialog[open], [role="dialog"], [aria-modal="true"]');
          const overlay = (style.position === 'fixed' || isModal) && rect.width * rect.height > 2000;
          if (!(knownCookie || knownChat || explicit || overlay) || gate.test(text)) continue;
          // A fixed page shell containing ordinary content is not a nuisance overlay.
          if (!explicit && !knownCookie && !knownChat && element.querySelector('main')) continue;
          const nuisance = explicit ? 'configured' : knownCookie || cookie.test(text) ? 'cookie' : knownChat || chat.test(text) ? 'chat' : promotion.test(text) ? 'promotion' : '';
          if (!nuisance) continue;
          const id = `${token}-${index++}`;
          element.setAttribute('data-folio-cleanup-id', id);
          const controls: Element[] = [];
          const visitControls = (root: Element | ShadowRoot) => {
            for (const button of root.querySelectorAll('button, [role="button"], input[type="button"], a')) controls.push(button);
            for (const child of root.querySelectorAll('*')) if (child.shadowRoot) visitControls(child.shadowRoot);
          };
          visitControls(element);
          const name = (button: Element) => [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent, button.getAttribute('value')].filter(Boolean).join(' ').trim();
          const knownReject = document.querySelector('#onetrust-reject-all-handler, #CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll');
          if (knownReject && element.contains(knownReject)) controls.unshift(knownReject);
          const reject = /(?:reject (?:all|cookies)|decline (?:all|cookies)|deny (?:all|cookies)|necessary only|only (?:necessary|essential)|continue without accepting|refuse all|rechazar|solo necesarias|tout refuser|alle ablehnen)/i;
          const close = /^(?:close(?: (?:dialog|modal|popup|window|chat|banner))?|dismiss|no thanks|not now|maybe later|x|×|✕|cerrar|fermer|schließen)$/i;
          const control = controls.find(button => visible(button) && (nuisance === 'cookie' ? reject.test(name(button)) : close.test(name(button))));
          let buttonId: string | undefined;
          if (control) { buttonId = `${id}-button`; control.setAttribute('data-folio-cleanup-id', buttonId); }
          results.push({ id, label: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}: ${text.slice(0, 100)}`, nuisance,
            confidence: knownCookie || knownChat || explicit ? 'known' : 'high', button: buttonId,
            modal: isModal || rect.width * rect.height > innerWidth * innerHeight * 0.4,
            stableSelector: element.id ? `#${CSS.escape(element.id)}` : undefined });
        }
        // Keep outer nuisance roots; avoid acting twice on nested containers.
        return results.filter(candidate => {
          const element = all.find(el => el.getAttribute('data-folio-cleanup-id') === candidate.id);
          return !results.some(other => other.id !== candidate.id && all.find(el => el.getAttribute('data-folio-cleanup-id') === other.id)?.contains(element ?? null));
        }).slice(0, 8);
      }, { preserve: settings.preserveSelectors, dismiss: settings.dismissSelectors, token: `fc-${Date.now()}-${pass}` }).catch(() => [] as Candidate[]);

      for (const candidate of candidates) {
        if (Date.now() >= deadline) break;
        await beforeIntervention?.();
        const before = await cleanupState(frame, settings.preserveSelectors);
        const target = `[data-folio-cleanup-id="${candidate.id}"]`;
        let verified = false, consentVerified = false, method = 'scoped-dismiss-control', consentNote: string | undefined;
        if (candidate.button) {
          try {
            await frame.locator(`[data-folio-cleanup-id="${candidate.button}"]`).click({ timeout: Math.min(900, Math.max(1, deadline - Date.now())) });
            await frame.locator(target).waitFor({ state: 'hidden', timeout: Math.min(600, Math.max(1, deadline - Date.now())) });
            verified = true;
          } catch { /* A stale or recurrent overlay is handled by the targeted fallback. */ }
        }
        if (!verified && candidate.nuisance === 'cookie' && candidate.confidence === 'known') {
          // Official public CMP opt-out methods, used only for a positively identified provider.
          // https://www.cookiebot.com/us/developer/ ; https://developer.onetrust.com/onetrust/docs/javascript-api
          const provider = await frame.evaluate(selector => {
            const host = window as unknown as {
              Cookiebot?: { submitCustomConsent?: (preferences: boolean, statistics: boolean, marketing: boolean) => void };
              OneTrust?: { RejectAll?: () => void };
            };
            if (/^#(?:CybotCookiebot|Cookiebot)/.test(selector) && typeof host.Cookiebot?.submitCustomConsent === 'function') {
              host.Cookiebot.submitCustomConsent(false, false, false); return 'Cookiebot';
            }
            if (/^#onetrust-/.test(selector) && typeof host.OneTrust?.RejectAll === 'function') { host.OneTrust.RejectAll(); return 'OneTrust'; }
            return null;
          }, candidate.stableSelector ?? '').catch(() => null);
          if (provider) {
            const until = Math.min(deadline, Date.now() + 700);
            while (Date.now() < until && !consentVerified) {
              consentVerified = await frame.evaluate(provider => {
                const host = window as unknown as {
                  Cookiebot?: { hasResponse?: boolean; consent?: { preferences?: boolean; statistics?: boolean; marketing?: boolean } };
                  OnetrustActiveGroups?: string;
                };
                if (provider === 'Cookiebot') return host.Cookiebot?.hasResponse === true && host.Cookiebot.consent?.preferences === false && host.Cookiebot.consent?.statistics === false && host.Cookiebot.consent?.marketing === false;
                // Standard OneTrust category IDs only; custom necessary groups remain unverified.
                return typeof host.OnetrustActiveGroups === 'string' && host.OnetrustActiveGroups.split(',').filter(Boolean).every(group => group === 'C0001');
              }, provider).catch(() => false);
              if (!consentVerified) await new Promise(resolve => setTimeout(resolve, 50));
            }
            verified = await frame.locator(target).isHidden().catch(() => true);
            method = 'known-cmp-reject-api';
            consentNote = `${provider} opt-out ${consentVerified ? 'verified from provider state' : 'could not be verified from provider state'}.`;
            if (!consentVerified) warnings.push(`The ${provider} opt-out API was called, but its resulting consent state could not be verified.`);
          }
        }
        if (!verified) {
          method = consentVerified ? 'known-cmp-reject-api-and-hide' : 'targeted-nuisance-hide';
          verified = await frame.evaluate(({ id, modal, preserve }) => {
            const find = (root: Document | ShadowRoot): HTMLElement | null => {
              const element = root.querySelector<HTMLElement>(`[data-folio-cleanup-id="${id}"]`);
              if (element) return element;
              for (const child of root.querySelectorAll('*')) if (child.shadowRoot) { const found = find(child.shadowRoot); if (found) return found; }
              return null;
            };
            const element = find(document);
            if (!element) return true;
            if (preserve.some(selector => { try { return element.matches(selector) || !!element.closest(selector) || !!element.querySelector(selector); } catch { return false; } })) return false;
            // Removing display alone does not release a native dialog's top layer or inert document.
            if (element instanceof HTMLDialogElement && element.open) element.close();
            element.style.setProperty('display', 'none', 'important');
            if (modal) {
              // Hide only an empty, adjacent backdrop belonging to the dismissed root.
              for (const sibling of [element.previousElementSibling, element.nextElementSibling]) {
                if (!(sibling instanceof HTMLElement) || sibling.textContent?.trim() || !/(?:backdrop|overlay|scrim)/i.test(`${sibling.className} ${sibling.id}`)) continue;
                const style = getComputedStyle(sibling);
                if (style.position === 'fixed' && !preserve.some(selector => { try { return sibling.matches(selector); } catch { return false; } })) sibling.style.setProperty('display', 'none', 'important');
              }
            }
            return getComputedStyle(element).display === 'none';
          }, { id: candidate.id, modal: candidate.modal, preserve: settings.preserveSelectors }).catch(() => false);
        }
        log.push({ at: new Date().toISOString(), frameUrl: frame.url(), action: candidate.nuisance === 'cookie' && (method === 'scoped-dismiss-control' || consentVerified) ? 'reject-cookies' : `dismiss-${candidate.nuisance}`,
          target: candidate.label, method, verified, note: consentNote ?? (method === 'targeted-nuisance-hide' ? 'Capture-only DOM intervention; no consent acceptance or access-gate removal.' : undefined) });
        if (verified) {
          acted = true; removed++;
          if (candidate.stableSelector) await frame.evaluate(({ selector, target, nuisance, preserve }) => {
            type CleanupState = { rules: Array<{ selector: string; target: string; nuisance: string }>; events: Array<{ at: string; action: string; target: string }> };
            const host = window as unknown as { __folioCleanupState?: CleanupState };
            if (!host.__folioCleanupState) {
              const state: CleanupState = { rules: [], events: [] };
              host.__folioCleanupState = state;
              const apply = () => {
                const roots: Array<Document | ShadowRoot> = [document];
                for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
                for (const rule of state.rules) for (const root of roots) for (const el of root.querySelectorAll<HTMLElement>(rule.selector)) {
                  if (preserve.some(saved => { try { return el.matches(saved) || !!el.closest(saved) || !!el.querySelector(saved); } catch { return false; } })) continue;
                  if (/(?:captcha|verify (?:that )?you are human|access denied|paywall|sign in to continue|log in to continue|subscribe to (?:continue|read|unlock))/i.test(el.innerText ?? '')) continue;
                  if (getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0) {
                    if (el instanceof HTMLDialogElement && el.open) el.close();
                    el.style.setProperty('display', 'none', 'important');
                    if (state.events.length < 100) state.events.push({ at: new Date().toISOString(), action: `dismiss-recurrent-${rule.nuisance}`, target: rule.target });
                  }
                }
              };
              const observer = new MutationObserver(apply);
              observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open'] });
              for (const el of document.querySelectorAll('*')) if (el.shadowRoot) observer.observe(el.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open'] });
            }
            const state = host.__folioCleanupState;
            if (!state.rules.some(rule => rule.selector === selector)) state.rules.push({ selector, target, nuisance });
          }, { selector: candidate.stableSelector, target: candidate.label, nuisance: candidate.nuisance, preserve: settings.preserveSelectors }).catch(() => {});
        }
        const after = await cleanupState(frame, settings.preserveSelectors);
        snapshots.push({ target: candidate.label, frameUrl: frame.url(), before, after });
        if (JSON.stringify(before.protected) !== JSON.stringify(after.protected)) warnings.push('Protected element geometry changed while dismissing a nuisance.');
      }
    }
    if (!acted) break;
  }

  const unresolved: string[] = [];
  for (const frame of page.frames()) {
    if (!await activeFrame(frame, page, settings.preserveSelectors)) continue;
    const recurrence = await frame.evaluate(() => {
      const host = window as unknown as { __folioCleanupState?: { events: Array<{ at: string; action: string; target: string }> } };
      return host.__folioCleanupState?.events.splice(0) ?? [];
    }).catch(() => []);
    for (const event of recurrence) log.push({ ...event, frameUrl: frame.url(), method: 'confirmed-nuisance-recurrence-observer', verified: true });
    if (removed > 0 || recurrence.length > 0) {
      const residual = await frame.evaluate(() => {
        const warnings: string[] = [];
        for (const main of document.querySelectorAll('main, [role="main"]')) {
          if (main.hasAttribute('inert') || main.getAttribute('aria-hidden') === 'true') warnings.push('Content remains inert/hidden after nuisance dismissal.');
          if (Array.from(getComputedStyle(main).filter.matchAll(/blur\(([^)]+)\)/g)).some(match => Number.parseFloat(match[1]) > 0)) warnings.push('Content remains blurred after nuisance dismissal.');
        }
        if (Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) > innerHeight + 2 && [document.body, document.documentElement].some(el => getComputedStyle(el).overflowY === 'hidden' || getComputedStyle(el).position === 'fixed')) warnings.push('A page scroll lock remains after nuisance dismissal; its ownership is unknown.');
        return warnings;
      }).catch(() => [] as string[]);
      warnings.push(...residual);
    }
    const blockers = await frame.evaluate(preserve => {
      const all: Element[] = [];
      const visit = (root: Document | ShadowRoot) => { for (const el of root.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) visit(el.shadowRoot); } };
      visit(document);
      return all.filter(element => {
        if (/^(HTML|BODY|MAIN|HEADER|NAV)$/.test(element.tagName)) return false;
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || style.pointerEvents === 'none' || rect.bottom <= 0 || rect.top >= innerHeight) return false;
        const protectedElement = preserve.some(selector => {
          let ancestor: Element | null = element;
          while (ancestor) {
            try { if (ancestor.matches(selector)) return true; } catch { return false; }
            ancestor = ancestor.parentElement ?? (ancestor.getRootNode() instanceof ShadowRoot ? (ancestor.getRootNode() as ShadowRoot).host : null);
          }
          return all.some(child => {
            try { if (!child.matches(selector)) return false; } catch { return false; }
            let current: Element | null = child;
            while (current) {
              if (current === element) return true;
              current = current.parentElement ?? (current.getRootNode() instanceof ShadowRoot ? (current.getRootNode() as ShadowRoot).host : null);
            }
            return false;
          });
        });
        if (protectedElement) return false;
        const area = Math.min(rect.width, innerWidth) * Math.min(rect.height, innerHeight);
        const modal = element.matches('dialog[open], [aria-modal="true"], [role="dialog"]') && element.getAttribute('aria-modal') !== 'false';
        const backdrop = style.position === 'fixed' && Number.parseInt(style.zIndex, 10) >= 100 && /(?:backdrop|scrim|modal-overlay)/i.test(`${element.className} ${element.id}`);
        return (modal && area > innerWidth * innerHeight * 0.12) || (backdrop && area > innerWidth * innerHeight * 0.45);
      }).map(element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}: ${((element as HTMLElement).innerText ?? '').trim().slice(0, 160)}`).slice(0, 5);
    }, settings.preserveSelectors).catch(() => [] as string[]);
    unresolved.push(...blockers.map(blocker => `${frame === page.mainFrame() ? '' : `${frame.url()}: `}${blocker}`));
  }
  return { removed, unresolved: [...new Set(unresolved)], warnings: [...new Set(warnings)], snapshots };
}
