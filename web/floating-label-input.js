/*
 * Vanilla-JS port of FloatingLabelInput.tsx -- a byte-faithful port of
 * the fine-tuned version: same floating-label behavior (rests vertically
 * centered when empty and unfocused, floats up + shrinks on focus or
 * once it has a value), same RTL auto-detection, same CSS custom
 * properties driving every dimension/color. No React/build step
 * required. Styling lives in style.css under ".mobile-form-*", copied
 * verbatim from the component's own <style jsx> block.
 */

function detectRTLText(text) {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

function detectLabelDir(text) {
  return detectRTLText(text) ? 'rtl' : 'ltr';
}

function createFloatingLabelInput(opts) {
  const {
    id,
    label,
    value = '',
    onValueChange,
    type = 'text',
    autoComplete = 'off',
    required = false,
    disabled: initialDisabled = false,
    textarea = false,
    isRTL,
    accentColor = '#00a0d8',
    textareaHeight = '152px',
    parentBackground = '#050505',
    inputOutlineColor = '#909090',
    inputFocusOutlineColor = '#fff',
    outlineWidth = '1.5px',
    foregroundColor = '#fff',
    mutedForegroundColor = '#aaa',
    rounding = '8px',
    inputPadding = '17px',
    inputFontSize = '1.025rem',
    labelFontSize = '1.025rem',
    labelActiveFontSize = '12px',
    labelPadding = '0 7px',
    labelActivePadding = '0 6px',
    inputHeight = '49px',
  } = opts;

  let currentValue = value;
  let focused = false;
  let rtlInput = isRTL ?? false;

  const group = document.createElement('div');
  if (id) group.dataset.inputId = id;

  group.style.setProperty('--accent-color', accentColor);
  group.style.setProperty('--mobile-form-input-bg', parentBackground);
  group.style.setProperty('--input-outline', inputOutlineColor);
  group.style.setProperty('--input-outline-focus', inputFocusOutlineColor);
  group.style.setProperty('--input-outline-width', outlineWidth);
  group.style.setProperty('--foreground', foregroundColor);
  group.style.setProperty('--muted-foreground', mutedForegroundColor);
  group.style.setProperty('--parent-background', parentBackground);
  group.style.setProperty('--general-rounding', rounding);
  group.style.setProperty('--floating-input-layout-text-area-height', textareaHeight);
  group.style.setProperty('--input-padding', inputPadding);
  group.style.setProperty('--input-font-size', inputFontSize);
  group.style.setProperty('--label-font-size', labelFontSize);
  group.style.setProperty('--label-active-font-size', labelActiveFontSize);
  group.style.setProperty('--label-padding', labelPadding);
  group.style.setProperty('--label-active-padding', labelActivePadding);
  group.style.setProperty('--input-height', inputHeight);

  const input = document.createElement(textarea ? 'textarea' : 'input');
  input.className = 'mobile-form-input';
  if (!textarea) input.type = type;
  input.required = required;
  input.disabled = initialDisabled;
  input.autocomplete = autoComplete;
  input.spellcheck = false;
  input.value = currentValue;

  const labelEl = document.createElement('label');
  labelEl.className = 'mobile-form-label' + (textarea ? ' label-textarea' : '');
  labelEl.textContent = label;
  labelEl.dir = detectLabelDir(label);

  group.append(input, labelEl);

  function render() {
    const hasValue = currentValue.length > 0;
    group.className = [
      'mobile-form-group',
      rtlInput ? 'rtl' : '',
      focused ? 'active' : '',
      hasValue ? 'has-value' : '',
      textarea ? 'textarea' : '',
    ].filter(Boolean).join(' ');
    input.dir = rtlInput ? 'rtl' : 'ltr';
  }

  input.addEventListener('input', (e) => {
    currentValue = e.target.value;
    rtlInput = currentValue ? detectRTLText(currentValue) : (isRTL ?? false);
    render();
    if (typeof onValueChange === 'function') onValueChange(currentValue);
  });
  input.addEventListener('focus', () => { focused = true; render(); });
  input.addEventListener('blur', () => { focused = false; render(); });

  render();

  return {
    el: group,
    input,
    getValue: () => currentValue,
    setValue: (v) => {
      currentValue = v;
      input.value = v;
      rtlInput = currentValue ? detectRTLText(currentValue) : (isRTL ?? false);
      render();
    },
    setDisabled: (d) => { input.disabled = d; },
  };
}
