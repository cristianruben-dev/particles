/**
 * Iconos de la UI: SVG de trazo, 24×24, en el color del texto. Dibujados para este proyecto.
 */

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fill = 'fill="currentColor" stroke="none"';

export const icons = {
  play: svg(`<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z" ${fill}/>`),
  pause: svg(`<rect x="6.5" y="5" width="3.6" height="14" rx="1.1" ${fill}/><rect x="13.9" y="5" width="3.6" height="14" rx="1.1" ${fill}/>`),
  slower: svg('<path d="M11.5 6.5 6 12l5.5 5.5M18 6.5 12.5 12l5.5 5.5"/>'),
  faster: svg('<path d="M12.5 6.5 18 12l-5.5 5.5M6 6.5l5.5 5.5L6 17.5"/>'),
  now: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v3.8h3.8"/><path d="M12 8.2V12l2.8 1.8"/>'),
  calendar: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="2.6"/><path d="M4 10.2h16M8.5 3.6v3.6M15.5 3.6v3.6"/>'),
  scale: svg('<path d="M3.5 12h17M3.5 12 7 8.5M3.5 12 7 15.5M20.5 12 17 8.5M20.5 12 17 15.5"/>'),
  orbits: svg(`<ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(-22 12 12)"/><circle cx="12" cy="12" r="2.3" ${fill}/><circle cx="19.6" cy="9.1" r="1.4" ${fill}/>`),
  labels: svg('<path d="M3.8 12.6V5.3c0-.8.7-1.5 1.5-1.5h7.3l7.6 7.6-8.8 8.8z"/><circle cx="8.3" cy="8.3" r="1.5"/>'),
  fly: svg('<path d="M12 3.2 19 20.4l-7-3.9-7 3.9z"/>'),
  orbit: svg(`<circle cx="12" cy="12" r="3.4" ${fill}/><path d="M20.5 12a8.5 8.5 0 0 1-15.6 4.7M3.5 12a8.5 8.5 0 0 1 15.6-4.7"/><path d="M19.1 3.6v3.7h-3.7M4.9 20.4v-3.7h3.7"/>`),
  info: svg('<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.6"/><circle cx="12" cy="7.8" r=".4" fill="currentColor"/>'),
  settings: svg('<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/>'),
  help: svg('<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.5"/><circle cx="12" cy="16.9" r=".4" fill="currentColor"/>'),
  fullscreen: svg('<path d="M4 9V5.6C4 4.7 4.7 4 5.6 4H9M15 4h3.4c.9 0 1.6.7 1.6 1.6V9M20 15v3.4c0 .9-.7 1.6-1.6 1.6H15M9 20H5.6C4.7 20 4 19.3 4 18.4V15"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  land: svg('<path d="M12 3.8v11.4M7.4 10.6 12 15.2l4.6-4.6M4 20h16"/>'),
  ascend: svg('<path d="M12 15.2V3.8M7.4 8.4 12 3.8l4.6 4.6M4 20h16"/>'),
  eye: svg('<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  keyboard: svg('<rect x="2.8" y="6" width="18.4" height="12" rx="2.4"/><path d="M6.8 10h.01M10.3 10h.01M13.7 10h.01M17.2 10h.01M7.5 14h9"/>'),
  eclipse: svg(`<circle cx="10" cy="12" r="6.6"/><circle cx="14.2" cy="12" r="6.6" ${fill} opacity=".9"/>`),
  sound: svg('<path d="M4 9.6v4.8h3.4L12 18.4V5.6L7.4 9.6z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.7a7.6 7.6 0 0 1 0 10.6"/>'),
  muted: svg('<path d="M4 9.6v4.8h3.4L12 18.4V5.6L7.4 9.6z"/><path d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8"/>'),
  sparkle: svg('<path d="M12 3.5c.5 4.3 1.9 6.9 8.5 8.5-6.6 1.6-8 4.2-8.5 8.5-.5-4.3-1.9-6.9-8.5-8.5 6.6-1.6 8-4.2 8.5-8.5z"/>'),
} as const;

export type IconName = keyof typeof icons;
