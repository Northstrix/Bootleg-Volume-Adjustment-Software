/*
 * Vanilla-JS port of FooterBadge.tsx -- same card design (subtext, logo
 * frame with gradient background, hover darken, 3D flip-on-hover text),
 * no React required. The logo frame background is only special-cased for
 * id === "namer" (gradient), same as the original; anything else falls
 * back to black. If the image file can't be found, it's hidden
 * gracefully instead of showing a broken-image icon.
 */

function createFooterBadge(opts) {
  const {
    id = '',
    href = 'https://namer-ui.vercel.app/',
    poweredByText = 'Powered by',
    badgeName = 'Namer UI',
    imageUrl = 'namer-ui-logo.png',
    imageBorder = false,
    animateFlip = false,
  } = opts;

  const imageBg = id === 'namer'
    ? 'linear-gradient(135deg, #4776cb, #a19fe5, #6cc606)'
    : '#000000';

  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'badge-card';

  const sub = document.createElement('span');
  sub.className = 'badge-subtext';
  sub.textContent = poweredByText;

  const row = document.createElement('div');
  row.className = 'badge-row';

  const imgFrame = document.createElement('span');
  imgFrame.className = 'badge-img-frame' + (imageBorder ? ' bordered' : '');
  imgFrame.style.background = imageBg;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = badgeName;
  img.width = 32;
  img.height = 32;
  img.draggable = false;
  img.className = 'badge-img';
  img.addEventListener('error', () => { img.style.display = 'none'; });

  imgFrame.appendChild(img);

  let nameNode;
  if (animateFlip) {
    // Two stacked copies of the name; CSS rotates the top one away and
    // the bottom one into place on hover, for the 3D flip effect.
    const flipWrapper = document.createElement('span');
    flipWrapper.className = 'flip-wrapper';
    for (let i = 0; i < 2; i++) {
      const outer = document.createElement('span');
      const em = document.createElement('em');
      em.className = 'flip-text';
      const inner = document.createElement('span');
      inner.className = 'badge-name';
      inner.textContent = badgeName;
      em.appendChild(inner);
      outer.appendChild(em);
      flipWrapper.appendChild(outer);
    }
    nameNode = flipWrapper;
  } else {
    const span = document.createElement('span');
    span.className = 'badge-name';
    span.textContent = badgeName;
    nameNode = span;
  }

  row.append(imgFrame, nameNode);
  a.append(sub, row);

  return { el: a };
}
