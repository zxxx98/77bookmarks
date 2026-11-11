import { ChevronDown, GripVertical, Pencil, Trash2, X } from 'lucide-react'
import { useState, type HTMLAttributes } from 'react'
import type { Link, Site, View } from '../../shared/types'
import { fullUrl, hostOf } from '../../shared/url'
import { usePopover } from '../ui'
import { SiteIcon } from './SiteIcon'

const COLLAPSED_LINKS = 6

interface Props {
  site: Site
  view?: View
  editing?: boolean
  matchedLinks?: Set<number>
  /** Props for the drag handle, supplied by the sortable wrapper */
  handleProps?: HTMLAttributes<HTMLButtonElement>
  /** Rendered inside the drag overlay */
  lifted?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onDeleteLink?: (linkId: number) => void
}

export function SiteCard(props: Props) {
  if (props.view === 'list') return <ListRow {...props} />
  if (props.view === 'small') return <SmallCard {...props} />
  return <LargeCard {...props} />
}

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

function LargeCard({ site, editing, matchedLinks, handleProps, lifted, onEdit, onDelete, onDeleteLink }: Props) {
  const [expanded, setExpanded] = useState(false)
  const searching = !!matchedLinks && matchedLinks.size > 0
  const showAll = expanded || editing || searching || site.links.length <= COLLAPSED_LINKS
  const links = showAll ? site.links : site.links.slice(0, COLLAPSED_LINKS - 1)

  return (
    <div className={`group/card relative h-full ${lifted ? 'card-lifted scale-[1.02]' : 'card-surface'}`}>
      <a
        href={site.origin}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-3 rounded-card p-4 ${focusRing} ${editing ? 'pr-26' : ''} ${site.links.length ? 'pb-3' : ''}`}
      >
        <SiteIcon site={site} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-5 font-semibold">{site.title}</span>
          <span className="block truncate font-mono text-[11px] leading-5 text-muted">{hostOf(site.origin)}</span>
        </span>
      </a>

      {site.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-4">
          {links.map((link) => (
            <LinkChip key={link.id} site={site} link={link} matched={matchedLinks?.has(link.id)} editing={editing} onDelete={onDeleteLink} />
          ))}
          {!showAll && (
            <button
              className="rounded-pill border border-dashed border-line px-2 py-0.5 font-mono text-xs font-medium text-faint transition hover:border-accent/60 hover:text-accent"
              onClick={() => setExpanded(true)}
            >
              +{site.links.length - links.length}
            </button>
          )}
        </div>
      )}

      {editing && <Actions className="absolute top-2.5 right-2" handleProps={handleProps} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

/** Icon and title only. Links open from the count badge, and the ones matching a search are shown inline */
function SmallCard({ site, editing, matchedLinks, handleProps, lifted, onEdit, onDelete, onDeleteLink }: Props) {
  const menu = usePopover<HTMLDivElement>()
  const matched = site.links.filter((link) => matchedLinks?.has(link.id))

  return (
    <div ref={menu.ref} className={`group/card relative h-full ${lifted ? 'card-lifted scale-[1.03]' : 'card-surface'}`}>
      <div className="flex items-center">
        <a
          href={site.origin}
          target="_blank"
          rel="noreferrer"
          title={`${site.title}\n${hostOf(site.origin)}`}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-card p-2.5 ${focusRing}`}
        >
          <SiteIcon site={site} size={30} />
          <span className="truncate text-sm font-medium">{site.title}</span>
        </a>
        {site.links.length > 0 && (
          <button
            className={`mr-2 flex h-6 shrink-0 items-center gap-0.5 rounded-pill pr-1 pl-2 font-mono text-[11px] font-medium tabular-nums transition ${focusRing} ${
              menu.open || matched.length ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted hover:bg-accent-soft hover:text-accent'
            }`}
            style={{ border: '1px solid var(--chip-border)' }}
            aria-label={`${site.links.length} 个子链接`}
            aria-expanded={menu.open}
            onClick={() => menu.setOpen(!menu.open)}
          >
            {site.links.length}
            <ChevronDown size={12} className={`transition ${menu.open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {matched.length > 0 && !menu.open && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
          {matched.map((link) => (
            <LinkChip key={link.id} site={site} link={link} matched editing={editing} onDelete={onDeleteLink} />
          ))}
        </div>
      )}

      {menu.open && !lifted && (
        // data-open lifts the sortable wrapper above the cards that follow it
        <div data-open className="popover-panel absolute inset-x-0 top-full z-20 mt-1.5 flex max-h-72 animate-rise flex-col overflow-y-auto p-1 [animation-duration:0.15s]">
          {site.links.map((link) => (
            <div key={link.id} className={`flex items-center rounded-control hover:bg-fg/6 ${matchedLinks?.has(link.id) ? 'text-accent' : ''}`}>
              <a
                href={fullUrl(site.origin, link.path)}
                target="_blank"
                rel="noreferrer"
                title={`${link.title}\n${link.path}`}
                className={`min-w-0 flex-1 truncate rounded-control px-2.5 py-1.5 text-[13px] ${focusRing}`}
                onClick={() => menu.setOpen(false)}
              >
                {link.title}
              </a>
              {editing && <DeleteLinkButton link={link} className="mr-1.5" onDelete={onDeleteLink} />}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Actions
          compact
          className="popover-panel absolute -top-3 right-1.5 !rounded-pill px-0.5"
          handleProps={handleProps}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

function ListRow({ site, editing, matchedLinks, handleProps, lifted, onEdit, onDelete, onDeleteLink }: Props) {
  return (
    <div className={`group/card relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 ${lifted ? 'card-lifted' : 'card-surface'}`}>
      <a href={site.origin} target="_blank" rel="noreferrer" className={`flex min-w-0 items-center gap-2.5 rounded-control max-sm:flex-1 sm:w-72 sm:shrink-0 ${focusRing}`}>
        <SiteIcon site={site} size={26} />
        <span className="truncate text-sm font-semibold">{site.title}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{hostOf(site.origin)}</span>
      </a>
      {site.links.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5 max-sm:order-last max-sm:basis-full sm:flex-1">
          {site.links.map((link) => (
            <LinkChip key={link.id} site={site} link={link} matched={matchedLinks?.has(link.id)} editing={editing} onDelete={onDeleteLink} />
          ))}
        </div>
      )}
      {editing && <Actions className="ml-auto" handleProps={handleProps} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

interface LinkChipProps {
  site: Site
  link: Link
  matched?: boolean
  editing?: boolean
  onDelete?: (linkId: number) => void
}

function LinkChip({ site, link, matched, editing, onDelete }: LinkChipProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-pill text-xs font-medium transition ${
        matched ? 'bg-accent-soft text-accent ring-1 ring-accent/50' : 'bg-surface-2 text-muted hover:bg-accent-soft hover:text-accent'
      }`}
      style={{ border: matched ? undefined : '1px solid var(--chip-border)' }}
    >
      <a
        href={fullUrl(site.origin, link.path)}
        target="_blank"
        rel="noreferrer"
        title={`${link.title}\n${link.path}`}
        className={`max-w-44 truncate rounded-pill py-1 ${focusRing} ${editing ? 'pr-1 pl-2.5' : 'px-2.5'}`}
      >
        {link.title}
      </a>
      {editing && <DeleteLinkButton link={link} className="mr-1" onDelete={onDelete} />}
    </span>
  )
}

function DeleteLinkButton({ link, className, onDelete }: { link: Link; className: string; onDelete?: (linkId: number) => void }) {
  return (
    <button
      aria-label={`删除链接 ${link.title}`}
      className={`grid size-4 shrink-0 place-items-center rounded-pill text-faint hover:bg-danger hover:text-white ${className}`}
      onClick={() => onDelete?.(link.id)}
    >
      <X size={11} strokeWidth={2.5} />
    </button>
  )
}

interface ActionsProps extends Pick<Props, 'handleProps' | 'onEdit' | 'onDelete'> {
  className: string
  compact?: boolean
}

/** Edit, delete and drag buttons shown on a card in edit mode */
function Actions({ className, compact, handleProps, onEdit, onDelete }: ActionsProps) {
  const button = compact ? 'icon-btn-sm size-6 !rounded-pill' : 'icon-btn-sm'
  const size = compact ? 12 : 14
  return (
    <div className={`flex shrink-0 items-center ${className}`}>
      <button className={button} aria-label="编辑卡片" onClick={onEdit}>
        <Pencil size={size} />
      </button>
      <button className={`${button} hover:!bg-danger/10 hover:!text-danger`} aria-label="删除卡片" onClick={onDelete}>
        <Trash2 size={size} />
      </button>
      <button className={`${button} cursor-grab touch-none active:cursor-grabbing`} aria-label="拖动排序" {...handleProps}>
        <GripVertical size={size + 1} />
      </button>
    </div>
  )
}
