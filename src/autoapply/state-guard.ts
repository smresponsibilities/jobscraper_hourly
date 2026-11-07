import { createHash } from 'node:crypto';
import type { Frame, Locator } from 'patchright';

export async function computeFrameStateHash(frame: Frame): Promise<string> {
  const state = await frame.locator('body').evaluate(body => {
    const roots: (Document | ShadowRoot)[] = [document];
    const controls: unknown[] = [];
    for (let i = 0; i < roots.length; i++) for (const el of Array.from(roots[i]!.querySelectorAll('*'))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.matches('input,select,textarea,button,[role=combobox],[role=radio],[role=alert]') && el.getClientRects().length) {
        const input = el as HTMLInputElement;
        controls.push([el.tagName, el.id, input.name, input.type, input.value, input.checked, input.disabled, el.getAttribute('aria-invalid'), el.getAttribute('aria-checked'), el.textContent]);
      }
    }
    return [location.href, document.querySelector('h1,h2,[data-automation-id=progressBarActiveStep]')?.textContent, controls];
  });
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

const dispatchedStateActions = new WeakMap<Frame, Set<string>>();
/** Reserve before dispatch, including clicks that throw after sending a request. */
export async function reserveStateAction(frame: Frame, control: Locator, action: string): Promise<boolean> {
  const key = `${action}:${await computeFrameStateHash(frame)}:${await control.getAttribute('id') || await control.getAttribute('name') || (await control.innerText()).trim()}`;
  let dispatched = dispatchedStateActions.get(frame);
  if (!dispatched) dispatchedStateActions.set(frame, dispatched = new Set());
  if (dispatched.has(key)) return false;
  dispatched.add(key);
  return true;
}
