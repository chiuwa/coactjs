export const ROOM_STYLE = `
  :host {
    --coact-bg: #f8f5f6;
    --coact-surface: #fffdfd;
    --coact-ink: #2b262c;
    --coact-muted: #756c72;
    --coact-accent: #b95b73;
    --coact-accent-weak: #f1dce2;
    --coact-coral: #b98577;
    --coact-line: #e4dbde;
    --coact-line-strong: #cfc2c7;
    --coact-radius: 12px;
    --coact-font: "Onest", "Segoe UI", sans-serif;
    --coact-display: "Onest", "Segoe UI", sans-serif;
    --coact-mono: "SFMono-Regular", "Cascadia Code", ui-monospace, monospace;
    display: block;
    position: relative;
    min-height: 460px;
    overflow: hidden;
    background: var(--coact-bg);
    color: var(--coact-ink);
    font-family: var(--coact-font);
    contain: layout paint style;
  }

  .cw-canvas {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background-color: var(--coact-bg);
    background-image: radial-gradient(circle, rgba(96, 78, 85, 0.07) 1px, transparent 1.2px);
    background-size: 24px 24px;
  }

  .cw-window-layer,
  .cw-cursor-layer {
    position: absolute;
    inset: 0;
  }

  .cw-window-layer { pointer-events: none; }
  .cw-cursor-layer { pointer-events: none; overflow: hidden; z-index: 1000; }

  .cw-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    pointer-events: auto;
    color: var(--coact-ink);
    background: var(--coact-surface);
    border: 1px solid var(--coact-line-strong);
    border-radius: var(--coact-radius);
    box-shadow:
      0 14px 32px rgba(67, 45, 53, 0.1),
      0 2px 5px rgba(67, 45, 53, 0.04);
    animation: cw-settle 280ms cubic-bezier(.22,.78,.26,1) both;
    isolation: isolate;
    touch-action: none;
  }

  .cw-window.is-dragging {
    box-shadow:
      0 18px 40px rgba(67, 45, 53, 0.14),
      0 3px 7px rgba(67, 45, 53, 0.06);
  }

  .cw-window-head {
    flex: none;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--coact-window-accent) 28%, var(--coact-line));
    background: var(--coact-surface);
    background: color-mix(in srgb, var(--coact-window-accent) 5%, var(--coact-surface));
    cursor: grab;
    user-select: none;
  }

  .is-dragging .cw-window-head { cursor: grabbing; }

  .cw-window-mark {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 3px;
    background: var(--coact-window-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--coact-window-accent) 16%, transparent);
  }

  .cw-window-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--coact-ink);
    font-size: 12px;
    font-weight: 760;
    letter-spacing: -0.015em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .cw-actor {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 112px;
    color: var(--coact-muted);
    font-family: var(--coact-mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cw-actor::before {
    content: "";
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--coact-actor, var(--coact-line-strong));
  }

  .cw-close {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--coact-muted);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }

  .cw-close:hover {
    color: var(--coact-ink);
    background: color-mix(in srgb, var(--coact-window-accent) 11%, var(--coact-surface));
    border-color: color-mix(in srgb, var(--coact-window-accent) 28%, var(--coact-line));
  }

  .cw-close svg { width: 13px; height: 13px; }

  .cw-window-body {
    min-height: 0;
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--coact-line-strong) transparent;
  }

  .cw-window-body:focus-visible { outline: 2px solid var(--coact-ink); outline-offset: -3px; }

  .cw-window-body::-webkit-scrollbar { width: 9px; height: 9px; }
  .cw-window-body::-webkit-scrollbar-thumb {
    background: var(--coact-line-strong);
    border: 3px solid var(--coact-surface);
    border-radius: 99px;
  }

  .cw-fallback-content {
    padding: 22px;
    color: var(--coact-ink);
    font-size: 13px;
    line-height: 1.65;
  }

  .cw-resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 24px;
    height: 24px;
    cursor: nwse-resize;
    touch-action: none;
  }

  .cw-resize::before,
  .cw-resize::after {
    content: "";
    position: absolute;
    right: 5px;
    bottom: 6px;
    width: 8px;
    height: 1px;
    background: var(--coact-line-strong);
    transform: rotate(-45deg);
    transform-origin: right center;
  }

  .cw-resize::after {
    right: 5px;
    bottom: 10px;
    width: 13px;
  }

  .cw-frame-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
  }

  .cw-draw-layer {
    position: absolute;
    inset: 0;
    z-index: 900;
    overflow: hidden;
    pointer-events: none;
  }

  .cw-draw-layer.is-active {
    pointer-events: auto;
    cursor: crosshair;
    touch-action: none;
  }

  .cw-draw-preview {
    position: absolute;
    display: none;
    border: 2px dashed var(--coact-accent);
    border-radius: 10px;
    background: rgba(233, 95, 137, 0.1);
    box-shadow: inset 0 0 0 1px rgba(255, 248, 237, 0.7);
    pointer-events: none;
  }

  .cw-draw-layer.is-drawing .cw-draw-preview { display: block; }

  .cw-image-frame {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    pointer-events: auto;
    color: var(--coact-ink);
    background: var(--coact-surface);
    border: 1px solid var(--coact-line-strong);
    border-radius: 13px;
    box-shadow:
      0 12px 28px rgba(67, 45, 53, 0.09),
      0 2px 5px rgba(67, 45, 53, 0.04);
    animation: cw-settle 250ms cubic-bezier(.22,.78,.26,1) both;
    touch-action: none;
    isolation: isolate;
  }

  .cw-image-frame.is-dragging {
    box-shadow:
      0 17px 36px rgba(67, 45, 53, 0.13),
      0 3px 7px rgba(67, 45, 53, 0.06);
  }

  .cw-frame-head {
    height: 33px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 7px 0 10px;
    background: color-mix(in srgb, var(--coact-accent) 8%, var(--coact-surface));
    border-bottom: 1px solid var(--coact-line);
    cursor: grab;
    user-select: none;
  }

  .is-dragging .cw-frame-head { cursor: grabbing; }

  .cw-frame-grip {
    width: 8px;
    height: 13px;
    flex: none;
    opacity: 0.45;
    background-image: radial-gradient(circle, var(--coact-muted) 1px, transparent 1.2px);
    background-size: 4px 4px;
  }

  .cw-frame-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 750;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .cw-frame-actor {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 94px;
    overflow: hidden;
    color: var(--coact-muted);
    font-family: var(--coact-mono);
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .cw-frame-actor::before {
    content: "";
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--coact-frame-actor, var(--coact-line-strong));
  }

  .cw-frame-delete,
  .cw-frame-generate {
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }

  .cw-frame-delete {
    width: 25px;
    height: 25px;
    flex: none;
    color: var(--coact-muted);
  }

  .cw-frame-delete:hover {
    color: var(--coact-ink);
    background: var(--coact-surface);
    border-color: var(--coact-line);
  }

  .cw-frame-delete svg,
  .cw-frame-generate svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.55;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .cw-frame-art {
    position: relative;
    flex: 1;
    min-height: 70px;
    margin: 8px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--coact-accent) 20%, var(--coact-line));
    border-radius: 8px;
    background:
      linear-gradient(135deg, rgba(185, 91, 115, 0.08), transparent 55%),
      var(--coact-bg);
  }

  .cw-frame-art svg { width: 100%; height: 100%; display: block; }

  .cw-frame-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 10px;
    color: color-mix(in srgb, var(--coact-muted) 76%, var(--coact-ink));
    background-image: radial-gradient(circle, rgba(128, 103, 108, 0.18) 1px, transparent 1.2px);
    background-size: 13px 13px;
    text-align: center;
  }

  .cw-frame-empty-logo {
    width: 44px;
    height: 44px;
    display: block;
    border-radius: 10px;
    box-shadow: 0 6px 14px rgba(67, 45, 53, 0.12);
  }

  .cw-frame-empty-fallback {
    width: 30px;
    height: 30px;
    padding: 5px;
    border: 1px solid var(--coact-line-strong);
    border-radius: 7px;
    background: var(--coact-surface);
    box-sizing: content-box;
  }

  .cw-frame-empty-title,
  .cw-frame-empty-code {
    position: relative;
    max-width: 100%;
    padding: 4px 6px;
    border-radius: 4px;
    background: rgba(255, 253, 253, 0.92);
    color: var(--coact-ink);
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cw-frame-empty-title { font-weight: 620; }
  .cw-frame-empty-code { font-family: var(--coact-mono); }

  .cw-frame-brand {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .cw-frame-brand img {
    width: 54px;
    height: 54px;
    display: block;
    border-radius: 12px;
    box-shadow: 0 10px 24px rgba(43, 38, 44, 0.22);
  }

  .cw-frame-placeholder-note {
    position: absolute;
    left: 7px;
    bottom: 7px;
    padding: 4px 6px;
    border-radius: 4px;
    background: rgba(255, 253, 253, 0.92);
    color: var(--coact-ink);
    font-family: var(--coact-mono);
    font-size: 11px;
    line-height: 1;
  }

  .cw-frame-composer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 8px;
  }

  .cw-frame-prompt {
    min-width: 0;
    flex: 1;
    height: 31px;
    padding: 0 9px;
    border: 1px solid var(--coact-line);
    border-radius: 6px;
    background: var(--coact-surface);
    color: var(--coact-ink);
    font: inherit;
    font-size: 11px;
  }

  .cw-frame-prompt::placeholder { color: color-mix(in srgb, var(--coact-muted) 76%, var(--coact-line)); }
  .cw-frame-prompt:focus-visible { outline: 2px solid var(--coact-ink); outline-offset: 1px; }

  .cw-frame-generate {
    width: 31px;
    height: 31px;
    flex: none;
    color: #fff8ed;
    background: var(--coact-accent);
    border-color: var(--coact-accent);
  }

  .cw-frame-generate:hover { background: #b8496d; border-color: #b8496d; }
  .cw-frame-generate:disabled { opacity: 0.42; cursor: not-allowed; }
  .cw-frame-generate:disabled:hover { background: var(--coact-accent); border-color: var(--coact-accent); }

  .cw-frame-resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 20px;
    height: 20px;
    cursor: nwse-resize;
    touch-action: none;
  }

  .cw-frame-resize::before,
  .cw-frame-resize::after {
    content: "";
    position: absolute;
    right: 4px;
    bottom: 5px;
    width: 7px;
    height: 1px;
    background: var(--coact-line-strong);
    transform: rotate(-45deg);
    transform-origin: right center;
  }

  .cw-frame-resize::after { right: 4px; bottom: 8px; width: 11px; }

  .cw-cursor {
    position: absolute;
    left: 0;
    top: 0;
    opacity: 0;
    pointer-events: none;
    will-change: transform;
    transition: transform 68ms linear, opacity 150ms ease;
  }

  .cw-cursor.is-visible { opacity: 1; }

  .cw-cursor-arrow {
    width: 18px;
    height: 22px;
    display: block;
    fill: var(--peer-color);
    filter: drop-shadow(0 3px 3px rgba(62, 29, 37, 0.22));
    transform-origin: 0 0;
  }

  .cw-cursor.is-down .cw-cursor-arrow { transform: scale(.84); }

  .cw-cursor-label {
    position: absolute;
    left: 15px;
    top: 16px;
    max-width: 144px;
    padding: 5px 7px 4px;
    border-radius: 5px;
    background: var(--coact-surface);
    color: var(--coact-ink);
    border: 1px solid var(--peer-color);
    font-family: var(--coact-font);
    font-size: 11px;
    font-weight: 740;
    line-height: 1;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 3px 8px rgba(62, 29, 37, 0.18);
  }

  :host(:focus-within) .cw-window:focus-within { outline: none; }
  .cw-close:focus-visible {
    outline: 2px solid var(--coact-ink);
    outline-offset: 1px;
  }

  @keyframes cw-settle {
    from { opacity: 0; transform: translateY(9px) scale(.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (max-width: 720px) {
    :host { min-height: 390px; }
    .cw-window-head { height: 45px; padding-left: 12px; }
    .cw-actor,
    .cw-frame-actor { display: none; }
    .cw-cursor-label { max-width: 108px; }
    .cw-frame-head { height: 31px; }
    .cw-frame-prompt { height: 29px; }
    .cw-frame-generate { width: 29px; height: 29px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
`;

export const CURSOR_SVG = `
  <svg class="cw-cursor-arrow" viewBox="0 0 19 23" aria-hidden="true">
    <path d="M1 1.2V20.4L5.8 15.7L9.1 22.3L13.4 20.2L10.2 13.7L17.4 13.2L1 1.2Z"></path>
  </svg>`;
