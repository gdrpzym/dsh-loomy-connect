/**
 * Card chrome for the Plugin configuration contribution.
 *
 * DSH ships the official card shell (`PluginCard`) inside
 * `@deepseek-ai/dsh-client-ui-settings-plugins`, but that package exports only
 * `apply`/`inject` at runtime — the component itself is package-private. The
 * class names below are a deliberate, literal copy of that shell's CSS module
 * (`PluginCard.module.css`, MIT) so a third-party card is indistinguishable
 * from a first-party one: same 16px radius, same hairline border, same
 * hover/open background swap, same `.16s` chevron rotation.
 *
 * The owner of the stylesheet is this plugin, and its tag id is namespaced to
 * this plugin, so a DSH release that restyles the official shell cannot leave
 * this card half-styled: the two simply drift.
 */

/** Stable tag id; mirrors how the official bundles tag their own stylesheets. */
const STYLE_TAG_ID = 'dsh-loomy-connect/LoomyCard.module.css'

/** Prefix keeping every rule out of the official (hashed) class namespace. */
export const CSS = {
  card: 'dlc_card',
  cardOpen: 'dlc_cardOpen',
  header: 'dlc_header',
  headText: 'dlc_headText',
  name: 'dlc_name',
  description: 'dlc_description',
  chevron: 'dlc_chevron',
  chevronOpen: 'dlc_chevronOpen',
  body: 'dlc_body',
  section: 'dlc_section',
  heading: 'dlc_heading',
  row: 'dlc_row',
  status: 'dlc_status',
  tiles: 'dlc_tiles',
  tile: 'dlc_tile',
  tileLabel: 'dlc_tileLabel',
  tileValue: 'dlc_tileValue',
  tileHint: 'dlc_tileHint',
  text: 'dlc_text',
  hint: 'dlc_hint',
  error: 'dlc_error',
  list: 'dlc_list',
  listItem: 'dlc_listItem',
  listName: 'dlc_listName',
  listNote: 'dlc_listNote',
  refreshInner: 'dlc_refreshInner',
  refreshSpin: 'dlc_refreshSpin',
} as const

const STYLESHEET = `
.dlc_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.dlc_card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dlc_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dlc_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dlc_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dlc_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dlc_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dlc_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dlc_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.dlc_chevronOpen{transform:rotate(180deg)}
.dlc_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dlc_section{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dlc_section+.dlc_section{border-top:.5px solid var(--dsw-alias-border-l2)}
.dlc_heading{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:500;line-height:1.5}
.dlc_row{align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;display:flex}
.dlc_status{align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;display:flex}
.dlc_tiles{flex-wrap:wrap;gap:12px;display:flex}
.dlc_tile{box-sizing:border-box;flex:1 1 180px;min-width:0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dlc_tileLabel{align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;display:flex}
.dlc_tileValue{margin-top:6px;color:var(--dsw-alias-label-primary);font-size:24px;font-weight:600;line-height:1.25}
.dlc_tileHint{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dlc_text{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:1.5}
.dlc_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
/* The official shell's equivalent rule names --dsw-alias-label-error, which no
   shipped theme defines (the text silently inherits). Use a token that exists. */
.dlc_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}
.dlc_list{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dlc_listItem{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dlc_listName{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlc_listNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;flex:none}
.dlc_refreshInner{display:inline-flex;align-items:center;gap:6px}
.dlc_refreshSpin{animation:dlc_spin .7s linear infinite}
@keyframes dlc_spin{to{transform:rotate(360deg)}}
`

/**
 * Install the card stylesheet once per document.
 *
 * Called at module scope, so it runs while the module loader materializes this
 * bundle — the same moment the official bundles inject theirs, which is what
 * lets the loader inventory and dispose the tag with the module.
 */
export function ensureLoomyCardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-loomy-connect'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = STYLESHEET
  document.head.appendChild(tag)
}

ensureLoomyCardStyles()
