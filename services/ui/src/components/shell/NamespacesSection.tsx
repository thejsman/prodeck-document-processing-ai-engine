'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useNamespace } from '@/lib/namespace-context';
import { useAuth } from '@/lib/auth-context';
import { deleteNamespace, renameNamespace } from '@/lib/api';
import { CreateNamespaceModal } from './CreateNamespaceModal';
import { Pencil, Trash2, PlusCircle, ChevronDown, MoreHorizontal, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { toast } from 'sonner';

interface Props {
  onMobileClose: () => void;
}

interface MenuPos { top: number; right: number }

export function NamespacesSection({ onMobileClose }: Props) {
  const { namespaces, namespace: activeNamespace, setNamespace, refresh } = useNamespace();
  const { apiKey } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  const [nsLabelHovered, setNsLabelHovered] = useState(false);

  // hover / menu state
  const [hoveredNs, setHoveredNs] = useState<string | null>(null);
  const [menuNs, setMenuNs] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos>({ top: 0, right: 0 });
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // rename state
  const [renamingNs, setRenamingNs] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // confirm delete dialog
  const [confirmNs, setConfirmNs] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // open menu: calculate position from the ⋯ button's bounding rect
  const openMenu = useCallback((ns: string) => {
    const btn = menuBtnRefs.current[ns];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuNs(ns);
  }, []);

  // close dropdown on outside click
  useEffect(() => {
    if (!menuNs) return;
    const handler = (e: MouseEvent) => {
      const btn = menuBtnRefs.current[menuNs];
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        btn && !btn.contains(e.target as Node)
      ) {
        setMenuNs(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuNs]);

  // focus rename input when it appears
  useEffect(() => {
    if (renamingNs && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingNs]);

  const startRename = (ns: string) => {
    setMenuNs(null);
    setRenamingNs(ns);
    setRenameValue(ns);
  };

  const commitRename = async (ns: string, newVal: string) => {
    setRenamingNs(null);
    const newName = newVal.trim();
    if (!newName || newName === ns) return;
    try {
      await renameNamespace(apiKey, ns, newName);
      if (activeNamespace === ns) {
        setNamespace(newName);
      }
      await refresh();
      toast.success(`Renamed to "${newName}"`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmNs) return;
    setDeleting(true);
    try {
      await deleteNamespace(apiKey, confirmNs);
      if (activeNamespace === confirmNs) setNamespace('');
      await refresh();
      toast.success(`Deleted namespace "${confirmNs}"`);
      router.push('/');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
      setConfirmNs(null);
    }
  };

  // portal dropdown
  const dropdown = menuNs ? createPortal(
    <div
      ref={dropdownRef}
      className="card"
      style={{
        position: 'fixed',
        top: menuPos.top,
        right: menuPos.right,
        minWidth: 120,
        padding: '4px 0',
        zIndex: 99999,
      }}
    >
      <button
        className="btn btn-sm"
        style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, gap: 8 }}
        onMouseDown={e => e.preventDefault()}
        onClick={() => startRename(menuNs)}
      >
        <Icon icon={Pencil} size="sm" /><span>Rename</span>
      </button>
      <button
        className="btn btn-sm"
        style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 14px', fontSize: 14, color: 'var(--danger)', gap: 8 }}
        onMouseDown={e => e.preventDefault()}
        onClick={() => { const ns = menuNs; setMenuNs(null); setConfirmNs(ns); }}
      >
        <Icon icon={Trash2} size="sm" /><span>Delete</span>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div className="sidebar-group">
        {/* New Namespace button */}
        <div
          className="sidebar-link"
          onClick={() => setShowModal(true)}
          style={{ cursor: 'pointer' }}
        >
          <Icon icon={PlusCircle} size="md" className="sidebar-icon" />
          <span className="sidebar-label">New Namespace</span>
        </div>

        {/* Namespaces section label — collapses/expands list */}
        <div
          className="sidebar-link"
          onClick={() => setExpanded(v => !v)}
          onMouseEnter={() => setNsLabelHovered(true)}
          onMouseLeave={() => setNsLabelHovered(false)}
          style={{ cursor: 'pointer' }}
        >
          <span className="sidebar-label" style={{ flex: 1, opacity: 0.45 }}>Namespaces</span>
          <Icon
            icon={ChevronDown}
            size="sm"
            style={{
              flexShrink: 0,
              opacity: nsLabelHovered ? 0.5 : 0,
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'opacity 0.15s, transform 0.15s ease',
            }}
          />
        </div>

        {/* Namespace list */}
        {expanded && namespaces.map((ns) => {
          const isActive = ns === activeNamespace && !!pathname?.startsWith('/chat');
          // Only show hover state on this item when no menu is open, or this item owns the open menu
          const isHovered = hoveredNs === ns && (menuNs === null || menuNs === ns);
          const isMenuOpen = menuNs === ns;
          const isRenaming = renamingNs === ns;

          return (
            <div
              key={ns}
              style={{ position: 'relative' }}
              onMouseEnter={() => { if (menuNs === null || menuNs === ns) setHoveredNs(ns); }}
              onMouseLeave={() => setHoveredNs(null)}
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(ns, renameValue)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(ns, renameValue); }
                    if (e.key === 'Escape') { e.preventDefault(); setRenamingNs(null); }
                  }}
                  style={{
                    width: '100%',
                    height: 30,
                    fontSize: 14,
                    paddingLeft: 20,
                    paddingRight: 8,
                    background: 'var(--panel-soft)',
                    border: '1px solid var(--primary)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <button
                  className={`sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
                  title={undefined}
                  onClick={() => { if (menuNs) return; setNamespace(ns); onMobileClose(); router.push('/chat'); }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    paddingRight: isHovered || isMenuOpen ? 36 : 12,
                    transition: 'padding-right 0.15s, background 0.2s ease, color 0.2s ease, transform 0.2s ease',
                  }}
                >
                  <span className="sidebar-label">{ns}</span>
                </button>
              )}

              {/* ⋯ menu toggle — only shown on hover or when menu is open */}
              {!isRenaming && (
                <button
                  ref={el => { menuBtnRefs.current[ns] = el; }}
                  className="btn btn-sm"
                  title="Options"
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '1px 5px',
                    fontSize: 15,
                    border: 'none',
                    lineHeight: 1,
                    opacity: isHovered || isMenuOpen ? 1 : 0,
                    pointerEvents: isHovered || isMenuOpen ? 'auto' : 'none',
                    transition: 'opacity 0.15s',
                  }}
                  onClick={e => { e.stopPropagation(); isMenuOpen ? setMenuNs(null) : openMenu(ns); }}
                ><Icon icon={MoreHorizontal} size="sm" /></button>
              )}
            </div>
          );
        })}
      </div>

      {dropdown}

      {showModal && <CreateNamespaceModal onClose={() => setShowModal(false)} />}

      {/* Confirm delete dialog */}
      {confirmNs && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onMouseDown={e => { if (e.target === e.currentTarget && !deleting) setConfirmNs(null); }}
        >
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.5, letterSpacing: '0em' }}>Delete namespace</p>
                <button
                  onClick={() => { if (!deleting) setConfirmNs(null); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, display: 'flex', alignItems: 'center' }}
                ><Icon icon={X} size="md" /></button>
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5, letterSpacing: '0em' }}>
                Permanently delete <strong>"{confirmNs}"</strong>? All ingested files, proposals, and microsites in this namespace will be removed and cannot be recovered.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setConfirmNs(null)}
                  disabled={deleting}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer' }}
                >Cancel</button>
                <button
                  onClick={handleDeleteConfirmed}
                  disabled={deleting}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 14, fontWeight: 400, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1, lineHeight: 1.5, letterSpacing: '0em' }}
                >{deleting ? 'Deleting…' : 'Delete'}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
