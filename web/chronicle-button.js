/*
 * Vanilla-JS port of ChronicleButton.tsx -- same flip-text hover
 * animation for the default (solid) variant, same border/text swap for
 * the outlined variant, no React required. Hover mutates inline styles
 * the exact same way the original component's onMouseEnter/onMouseLeave
 * handlers do; the CSS in style.css under ".chronicleButton" drives the
 * flip transition itself.
 */

function createChronicleButton(opts) {
  const {
    text,
    onClick,
    hoverColor = '#a594fd',
    hoverForeground,
    width = '160px',
    outlined = false,
    outlinePaddingAdjustment = '2px',
    borderRadius = '8px',
    fontFamily,
    outlinedButtonBackgroundOnHover = 'transparent',
    customBackground = '#f0f0f1',
    customForeground = '#1a1a24',
    fontSize = '1.025rem',
    lineHeight = '1',
    outlineBorderWidth = '1px',
    padding,
    disabled = false,
    // Two small additions beyond the original component's API, both
    // needed for this app and both no-ops when omitted:
    height, // explicit height, e.g. to line up with an adjacent 49px input
    restingBorderColor, // outlined variant: border color AT REST. The
    // original component only exposes `customBackground` for both the
    // resting border AND the resting text color -- this app wants a
    // subtle dark resting border with light text, so this lets the
    // border be set independently. Falls back to customBackground
    // (the original behavior) when not provided.
  } = opts;

  const restBorderColor = restingBorderColor || customBackground;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chronicleButton' + (outlined ? ' outlined' : '');
  button.disabled = disabled;

  // base styles -- mirrors `buttonStyle` in the React version
  button.style.width = width;
  if (height) button.style.height = height;
  button.style.borderRadius = borderRadius;
  if (fontFamily) button.style.fontFamily = fontFamily;
  button.style.background = outlined ? 'transparent' : customBackground;
  button.style.color = outlined ? customBackground : customForeground;
  button.style.padding = padding
    ? padding
    : outlined
      ? `calc(1rem - ${outlinePaddingAdjustment}) 1.232rem`
      : '1rem 1.232rem';
  button.style.border = outlined ? `${outlineBorderWidth} solid ${restBorderColor}` : 'none';
  button.style.transition = 'background 0.3s ease-in-out, color 0.3s ease-in-out, border 0.3s ease-in-out, padding 0.3s ease-in-out';
  button.style.position = 'relative';
  button.style.setProperty('--chronicle-outlined-hover-bg', outlinedButtonBackgroundOnHover);

  function makeEm() {
    const em = document.createElement('em');
    em.textContent = text;
    em.style.fontSize = fontSize;
    em.style.lineHeight = lineHeight;
    em.style.fontWeight = '700';
    if (outlined) em.style.color = customBackground; // resting outlined text color
    return em;
  }

  if (outlined) {
    // OUTLINED: simple single span, no flip animation (matches the React version)
    const span = document.createElement('span');
    span.appendChild(makeEm());
    button.appendChild(span);
  } else {
    // DEFAULT: flipping text animation (two stacked spans)
    const span1 = document.createElement('span');
    span1.className = 'chronicle-fade chronicle-fade-in';
    span1.appendChild(makeEm());
    const span2 = document.createElement('span');
    span2.appendChild(makeEm());
    button.append(span1, span2);
  }

  function paintOutlinedText(color) {
    const em = button.querySelector('em');
    if (em) em.style.color = color;
  }

  button.addEventListener('mouseenter', () => {
    if (outlined) {
      button.classList.add('chronicle-hovered');
      button.style.borderColor = hoverColor;
      const fg = hoverForeground || hoverColor;
      button.style.color = fg;
      paintOutlinedText(fg);
    } else {
      button.style.background = hoverColor;
      button.style.color = hoverForeground || customForeground;
    }
  });

  button.addEventListener('mouseleave', () => {
    if (outlined) {
      button.classList.remove('chronicle-hovered');
      button.style.borderColor = restBorderColor;
      button.style.color = customBackground;
      paintOutlinedText(customBackground);
    } else {
      button.style.background = customBackground;
      button.style.color = customForeground;
    }
  });

  if (typeof onClick === 'function') {
    button.addEventListener('click', onClick);
  }

  return {
    el: button,
    setDisabled: (d) => { button.disabled = d; },
    setText: (t) => { button.querySelectorAll('em').forEach((em) => { em.textContent = t; }); },
  };
}
