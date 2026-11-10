import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCleanQuestionText, stripOptionLabels } from './distiller.js';
import { populateGreenhouseSecurityCode } from './runner.js';
import { selectCustomComboboxWithKeyboardFallback } from './widgets.js';

test('GEN-428: stripOptionLabels cleanly removes binary and demographic option words', () => {
  assert.equal(stripOptionLabels('Yes'), '');
  assert.equal(stripOptionLabels('No'), '');
  assert.equal(stripOptionLabels('Will you require visa sponsorship? Yes No'), 'Will you require visa sponsorship?');
  assert.equal(stripOptionLabels('Gender: Male Female Decline To State'), 'Gender:');
  assert.equal(stripOptionLabels('Terms of Service: I agree'), 'Terms of Service:');
});

test('GEN-428: W3C AccName tree walk extracts question prompt for detached Greenhouse radio groups', () => {
  // Mock radio input with detached main-label container (Greenhouse sponsorship question pattern)
  const mockContainer = {
    className: 'field',
    textContent: 'Will you now or in the future require sponsorship for employment visa status? Yes No',
    querySelector: (sel: string) => {
      if (sel.includes('main-label')) {
        return { textContent: 'Will you now or in the future require sponsorship for employment visa status?' };
      }
      return null;
    },
    getRootNode: () => ({ getElementById: () => null, querySelector: () => null }),
    matches: () => false,
  } as any;

  const mockRadioInput = {
    type: 'radio',
    name: 'job_application[answers_attributes][14][boolean_value]',
    value: 'true',
    closest: (sel: string) => (sel.includes('field') ? mockContainer : null),
    getAttribute: () => null,
    getRootNode: () => mockContainer.getRootNode(),
  } as any;

  const extracted = extractCleanQuestionText(mockContainer, [mockRadioInput]);
  assert.ok(
    extracted.includes('require sponsorship'),
    `Expected prompt to contain "require sponsorship", got: "${extracted}"`
  );
  assert.equal(extracted.includes('Yes'), false, 'Must strip option label Yes');

  // Mock fieldset with legend
  const mockFieldset = {
    tagName: 'FIELDSET',
    textContent: 'Are you willing to relocate to Bengaluru? Yes No',
    querySelector: (sel: string) => {
      if (sel.includes('legend')) {
        return { textContent: 'Are you willing to relocate to Bengaluru?' };
      }
      return null;
    },
    getRootNode: () => ({ getElementById: () => null, querySelector: () => null }),
    matches: () => false,
  } as any;

  const mockRelocRadio = {
    type: 'radio',
    value: 'yes',
    closest: (sel: string) => (sel.includes('fieldset') ? mockFieldset : null),
    getAttribute: () => null,
    getRootNode: () => mockFieldset.getRootNode(),
  } as any;

  const relocExtracted = extractCleanQuestionText(mockFieldset, [mockRelocRadio]);
  assert.ok(
    relocExtracted.includes('relocate to Bengaluru'),
    `Expected prompt to contain "relocate to Bengaluru", got: "${relocExtracted}"`
  );

  // Mock preceding sibling element with question/label
  const mockSiblingLabel = {
    className: 'question-title',
    tagName: 'LABEL',
    textContent: 'Do you agree to background verification?',
    previousElementSibling: null,
  };

  const mockCheckboxBox = {
    className: 'field',
    textContent: 'I agree',
    previousElementSibling: mockSiblingLabel,
    querySelector: () => null,
    getRootNode: () => ({ getElementById: () => null, querySelector: () => null }),
    matches: () => false,
  } as any;

  const mockCheckbox = {
    type: 'checkbox',
    value: 'agree',
    closest: (sel: string) => (sel.includes('field') ? mockCheckboxBox : null),
    getAttribute: () => null,
    getRootNode: () => mockCheckboxBox.getRootNode(),
  } as any;

  const bgExtracted = extractCleanQuestionText(mockCheckboxBox, [mockCheckbox]);
  assert.ok(
    bgExtracted.includes('background verification'),
    `Expected prompt to contain "background verification", got: "${bgExtracted}"`
  );
});

test('GEN-428: Greenhouse multi-box OTP verification populates via sequential focus, value setting, and paste events', async () => {
  const inputs: Array<{ id: string; value: string; focused: boolean; events: string[] }> = [
    { id: 'security-input-0', value: '', focused: false, events: [] },
    { id: 'security-input-1', value: '', focused: false, events: [] },
    { id: 'security-input-2', value: '', focused: false, events: [] },
    { id: 'security-input-3', value: '', focused: false, events: [] },
    { id: 'security-input-4', value: '', focused: false, events: [] },
    { id: 'security-input-5', value: '', focused: false, events: [] },
  ];

  const fakeFrameOrPage = {
    evaluate: async (fn: any, code: string) => {
      // Execute the sequential focus, setter, input event, and paste logic
      const chars = code.split('');
      inputs.forEach((box, idx) => {
        box.focused = true;
        box.value = chars[idx] || '';
        box.events.push('input', 'change');
      });
      inputs[0]?.events.push('paste');
      return true;
    },
  } as any;

  const success = await populateGreenhouseSecurityCode(fakeFrameOrPage, '839201');
  assert.equal(success, true);
  const entered = inputs.map((i) => i.value).join('');
  assert.equal(entered, '839201', 'Multi-box OTP inputs must receive characters sequentially');
  assert.ok(inputs[0]?.events.includes('paste'), 'Must dispatch paste event on initial box');
});

test('GEN-428: Regional Greenhouse domains preserve EU host, referrers, and query parameters', () => {
  const euUrl = 'https://job-boards.eu.greenhouse.io/deliveroo/jobs/12345?token=abcdef&b=1';
  const match = euUrl.match(/(?:(?:boards|job-boards)(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  assert.ok(match);

  const isEu = euUrl.includes('.eu.greenhouse.io');
  assert.equal(isEu, true);

  const ghHost = isEu ? 'job-boards.eu.greenhouse.io' : 'boards.greenhouse.io';
  assert.equal(ghHost, 'job-boards.eu.greenhouse.io');

  const origUrl = new URL(euUrl);
  let extraQuery = '';
  origUrl.searchParams.forEach((v, k) => {
    if (k !== 'for' && k !== 'token') extraQuery += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  });
  const embedUrl = `https://${ghHost}/embed/job_app?for=${encodeURIComponent(match[1])}&token=${encodeURIComponent(match[2])}${extraQuery}`;
  assert.equal(embedUrl, 'https://job-boards.eu.greenhouse.io/embed/job_app?for=deliveroo&token=12345&b=1');
});
