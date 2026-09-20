/*
 * Vanilla-JS port of CustomSlider.tsx -- same interaction model
 * (drag, click-to-position, arrow-key nudging, hover/focus color states),
 * same visual design, no React/build step required. Styling lives in
 * style.css under ".ns-slider-*"; this file only sets CSS custom
 * properties per instance and updates the DOM on interaction.
 */

function createCustomSlider(opts) {
  const {
    id,
    min = 0,
    max = 100,
    step = 1,
    value = 0,
    onValueChange,
    disabled: initialDisabled = false,
    width = '100%',
    trackHeight = '8px',
    thumbWidth = '20px',
    thumbHeight = '20px',
    trackFillBorderRadius = '8px',
    thumbBorderRadius = '50%',
    thumbBorderWidth = '2px',
    colorTrackBackground = '#262626',
    colorFillDefault = '#00A7FA',
    colorFillHover = '#55C7FF',
    colorFillActive = '#55C7FF',
    colorThumbDefault = '#262626',
    colorThumbHover = '#121212',
    colorThumbActive = '#262626',
    colorThumbBorderDefault = '#0083C4',
    colorThumbBorderHover = '#0079B5',
    colorThumbBorderActive = '#FFFFFF',
    ariaLabel = 'slider',
    isRTL = false,
    keyStep,
  } = opts;

  let currentValue = value;
  let disabled = initialDisabled;
  let isDragging = false;
  let isFocused = false;
  let isHovered = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'ns-slider-wrapper' + (disabled ? ' disabled' : '');
  wrapper.tabIndex = disabled ? -1 : 0;
  wrapper.setAttribute('role', 'slider');
  wrapper.setAttribute('aria-label', ariaLabel);
  wrapper.setAttribute('aria-valuemin', String(min));
  wrapper.setAttribute('aria-valuemax', String(max));
  wrapper.setAttribute('aria-disabled', String(disabled));
  wrapper.dir = isRTL ? 'rtl' : 'ltr';
  if (id) wrapper.dataset.sliderId = id;

  wrapper.style.setProperty('--ns-width', width);
  wrapper.style.setProperty('--ns-track-height', trackHeight);
  wrapper.style.setProperty('--ns-thumb-width', thumbWidth);
  wrapper.style.setProperty('--ns-thumb-height', thumbHeight);
  wrapper.style.setProperty('--ns-fill-radius', trackFillBorderRadius);
  wrapper.style.setProperty('--ns-thumb-radius', thumbBorderRadius);
  wrapper.style.setProperty('--ns-thumb-border-width', thumbBorderWidth);
  wrapper.style.setProperty('--ns-track-bg', colorTrackBackground);

  const track = document.createElement('div');
  track.className = 'ns-slider-track';
  const range = document.createElement('div');
  range.className = 'ns-slider-range';
  const thumb = document.createElement('div');
  thumb.className = 'ns-slider-thumb';
  wrapper.append(track, range, thumb);

  function currentColors() {
    return {
      fill: isFocused ? colorFillActive : isHovered ? colorFillHover : colorFillDefault,
      thumbColor: isFocused ? colorThumbActive : isHovered ? colorThumbHover : colorThumbDefault,
      thumbBorder: isFocused ? colorThumbBorderActive : isHovered ? colorThumbBorderHover : colorThumbBorderDefault,
    };
  }

  function render() {
    const pct = Math.max(0, Math.min(100, ((currentValue - min) / (max - min)) * 100));
    const { fill, thumbColor, thumbBorder } = currentColors();
    range.style.width = pct + '%';
    range.style.backgroundColor = fill;
    thumb.style.backgroundColor = thumbColor;
    thumb.style.borderColor = thumbBorder;
    if (isRTL) {
      thumb.style.right = `calc(${pct}% - ${thumbWidth} / 2)`;
      thumb.style.left = 'auto';
    } else {
      thumb.style.left = `calc(${pct}% - ${thumbWidth} / 2)`;
      thumb.style.right = 'auto';
    }
    wrapper.setAttribute('aria-valuenow', String(currentValue));
  }

  function handleInteraction(clientX) {
    if (disabled) return;
    const rect = wrapper.getBoundingClientRect();
    let pct = isRTL
      ? ((rect.right - clientX) / rect.width) * 100
      : ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    let newValue = min + (pct / 100) * (max - min);
    if (step !== 0) newValue = Math.round(newValue / step) * step;
    newValue = Math.max(min, Math.min(max, newValue));
    setValue(newValue, true);
  }

  function setValue(v, fromUser) {
    currentValue = v;
    render();
    if (fromUser && typeof onValueChange === 'function') onValueChange(currentValue);
  }

  wrapper.addEventListener('mousedown', (e) => {
    if (disabled) return;
    isDragging = true;
    handleInteraction(e.clientX);
    wrapper.focus();
  });
  window.addEventListener('mousemove', (e) => { if (isDragging) handleInteraction(e.clientX); });
  window.addEventListener('mouseup', () => { isDragging = false; });

  wrapper.addEventListener('touchstart', (e) => {
    if (disabled) return;
    isDragging = true;
    handleInteraction(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (isDragging) handleInteraction(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', () => { isDragging = false; });

  wrapper.addEventListener('keydown', (e) => {
    if (disabled) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const direction = (e.key === 'ArrowRight' ? 1 : -1) * (isRTL ? -1 : 1);
      const inc = keyStep ?? step;
      const newValue = Math.max(min, Math.min(max, currentValue + direction * inc));
      setValue(newValue, true);
    }
  });

  wrapper.addEventListener('mouseenter', () => { isHovered = true; render(); });
  wrapper.addEventListener('mouseleave', () => { isHovered = false; render(); });
  wrapper.addEventListener('focus', () => { isFocused = true; render(); });
  wrapper.addEventListener('blur', () => { isFocused = false; render(); });

  render();

  return {
    el: wrapper,
    getValue: () => currentValue,
    setValue: (v) => setValue(v, false),
    setDisabled: (d) => {
      disabled = d;
      wrapper.tabIndex = disabled ? -1 : 0;
      wrapper.classList.toggle('disabled', disabled);
      wrapper.setAttribute('aria-disabled', String(disabled));
    },
  };
}
