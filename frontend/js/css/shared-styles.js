export const btnBaseCSS = `
.btn-base {
  padding: var(--btn-padding-md);
  border-radius: var(--btn-radius, 6px);
  border: 1px solid var(--bd);
  background: transparent;
  color: var(--txt);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  transition: background .12s, color .12s;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-base:hover { background: var(--hover); }
.btn-base:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline: none; }
.btn-base.sm { padding: var(--btn-padding-sm); font-size: var(--fs-btn-tool); }
.btn-base.lg { padding: var(--btn-padding-lg); font-size: var(--fs-btn-primary); }
.btn-base.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-base.primary:hover { background: color-mix(in srgb, var(--accent) 88%, #fff); }
.btn-base.danger { background: color-mix(in srgb, var(--status-error, #e5534b) 15%, transparent); color: var(--status-error, #e5534b); border-color: color-mix(in srgb, var(--status-error, #e5534b) 40%, transparent); }
.btn-base.danger:hover { background: color-mix(in srgb, var(--status-error, #e5534b) 30%, transparent); }
.btn-base.accent { background: var(--accent-btn-bg, color-mix(in srgb, var(--accent) 20%, transparent)); color: var(--accent-btn-color, var(--accent)); border-color: var(--accent-btn-border, color-mix(in srgb, var(--accent) 33%, transparent)); }
.btn-base.accent:hover { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.btn-base.warn { background: color-mix(in srgb, var(--sm-optional) 13%, transparent); color: var(--sm-optional); border-color: color-mix(in srgb, var(--sm-optional) 33%, transparent); }
.btn-base.warn:hover { background: color-mix(in srgb, var(--sm-optional) 20%, transparent); }
.btn-base:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
`;
