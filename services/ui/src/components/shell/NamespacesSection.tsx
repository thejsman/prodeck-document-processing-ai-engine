'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useNamespace } from '@/lib/namespace-context';
import { useAuth } from '@/lib/auth-context';
import { deleteNamespace, renameNamespace, listSuperClients, deleteSuperClient, type SuperClientMeta } from '@/lib/api';
import { CreateNamespaceModal } from './CreateNamespaceModal';
import { CreateSuperClientModal } from './CreateSuperClientModal';
import { Pencil, Trash2, PlusCircle, ChevronDown, MoreHorizontal, X, Sparkles } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

interface Props {
  onMobileClose: () => void;
  collapsed?: boolean;
}

interface MenuPos {
  top: number;
  right: number;
}

export function NamespacesSection({ onMobileClose, collapsed = false }: Props) {
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

  // super clients
  const [superClients, setSuperClients] = useState<SuperClientMeta[]>([]);
  const [showSuperModal, setShowSuperModal] = useState(false);
  const [expandedSuper, setExpandedSuper] = useState(true);
  const [superLabelHovered, setSuperLabelHovered] = useState(false);
  const [hoveredSc, setHoveredSc] = useState<string | null>(null);
  const [confirmSc, setConfirmSc] = useState<string | null>(null);
  const [deletingSc, setDeletingSc] = useState(false);

  const loadSuperClients = useCallback(async () => {
    try {
      const list = await listSuperClients(apiKey);
      setSuperClients(list);
    } catch {
      /* non-fatal */
    }
  }, [apiKey]);

  useEffect(() => {
    void loadSuperClients();
  }, [loadSuperClients]);

  const handleDeleteSuperClient = async () => {
    if (!confirmSc) return;
    setDeletingSc(true);
    try {
      await deleteSuperClient(apiKey, confirmSc);
      await loadSuperClients();
      toast.success(`Deleted "${confirmSc}"`);
      if (pathname?.startsWith(`/super-client/${confirmSc}`)) router.push('/');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeletingSc(false);
      setConfirmSc(null);
    }
  };

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
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        btn &&
        !btn.contains(e.target as Node)
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
  const dropdown = menuNs
    ? createPortal(
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
            style={{
              width: '100%',
              textAlign: 'left',
              borderRadius: 0,
              border: 'none',
              justifyContent: 'flex-start',
              padding: '8px 14px',
              fontSize: 14,
              gap: 8,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => startRename(menuNs)}
          >
            <Icon icon={Pencil} size="sm" />
            <span>Rename</span>
          </button>
          <button
            className="btn btn-sm"
            style={{
              width: '100%',
              textAlign: 'left',
              borderRadius: 0,
              border: 'none',
              justifyContent: 'flex-start',
              padding: '8px 14px',
              fontSize: 14,
              color: 'var(--danger)',
              gap: 8,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const ns = menuNs;
              setMenuNs(null);
              setConfirmNs(ns);
            }}
          >
            <Icon icon={Trash2} size="sm" />
            <span>Delete</span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {/* <div className="sidebar-group">
        <div className="sidebar-link" onClick={() => setShowModal(true)} style={{ cursor: 'pointer' }}>
          <Icon icon={PlusCircle} size="md" className="sidebar-icon" />
          <span className="sidebar-label">Create Client</span>
        </div>

        <div
          className="sidebar-link"
          onClick={() => setExpanded((v) => !v)}
          onMouseEnter={() => setNsLabelHovered(true)}
          onMouseLeave={() => setNsLabelHovered(false)}
          style={{ cursor: 'pointer' }}
        >
          <span className="sidebar-label" style={{ flex: 1, opacity: 0.45 }}>
            Clients
          </span>
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

        {expanded &&
          namespaces.map((ns) => {
            const isActive = ns === activeNamespace && !!pathname?.startsWith('/chat');
            // Only show hover state on this item when no menu is open, or this item owns the open menu
            const isHovered = hoveredNs === ns && (menuNs === null || menuNs === ns);
            const isMenuOpen = menuNs === ns;
            const isRenaming = renamingNs === ns;

            return (
              <div
                key={ns}
                style={{ position: 'relative' }}
                onMouseEnter={() => {
                  if (menuNs === null || menuNs === ns) setHoveredNs(ns);
                }}
                onMouseLeave={() => setHoveredNs(null)}
              >
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(ns, renameValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(ns, renameValue);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingNs(null);
                      }
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
                    onClick={() => {
                      if (menuNs) return;
                      setNamespace(ns);
                      onMobileClose();
                      router.push('/chat');
                    }}
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

                {!isRenaming && (
                  <button
                    ref={(el) => {
                      menuBtnRefs.current[ns] = el;
                    }}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      isMenuOpen ? setMenuNs(null) : openMenu(ns);
                    }}
                  >
                    <Icon icon={MoreHorizontal} size="sm" />
                  </button>
                )}
              </div>
            );
          })}
      </div> */}

      {/* Super Clients section */}
      <div className="sidebar-group">
        <div className="sidebar-link" onClick={() => setShowSuperModal(true)} style={{ cursor: 'pointer' }}>
          <Icon icon={Sparkles} size="md" className="sidebar-icon" />
          <span className="sidebar-label">Super Client</span>
        </div>

        <div
          className="sidebar-link"
          onClick={() => setExpandedSuper((v) => !v)}
          onMouseEnter={() => setSuperLabelHovered(true)}
          onMouseLeave={() => setSuperLabelHovered(false)}
          style={{ cursor: 'pointer' }}
        >
          <span className="sidebar-label" style={{ flex: 1, opacity: 0.45 }}>
            Super Clients
          </span>
          <Icon
            icon={ChevronDown}
            size="sm"
            style={{
              flexShrink: 0,
              opacity: superLabelHovered ? 0.5 : 0,
              transform: expandedSuper ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'opacity 0.15s, transform 0.15s ease',
            }}
          />
        </div>

        {expandedSuper &&
          superClients.map((sc) => {
            const isActive = !collapsed && (
              pathname === `/super-client/${sc.name}` ||
              !!pathname?.startsWith(`/super-client/${sc.name}/`)
            );
            const isHovered = hoveredSc === sc.name;

            return (
              <div
                key={sc.name}
                style={{ position: 'relative' }}
                onMouseEnter={() => setHoveredSc(sc.name)}
                onMouseLeave={() => setHoveredSc(null)}
              >
                <button
                  className={`sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
                  onClick={() => {
                    onMobileClose();
                    router.push(`/super-client/${sc.name}`);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    paddingRight: isHovered ? 36 : 12,
                    transition: 'padding-right 0.15s, background 0.2s ease, color 0.2s ease',
                  }}
                >
                  <span className="sidebar-label">{sc.displayName}</span>
                </button>

                <button
                  className="btn btn-sm"
                  title="Delete"
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '1px 5px',
                    fontSize: 13,
                    border: 'none',
                    lineHeight: 1,
                    opacity: isHovered ? 1 : 0,
                    pointerEvents: isHovered ? 'auto' : 'none',
                    transition: 'opacity 0.15s',
                    color: 'var(--danger)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmSc(sc.name);
                  }}
                >
                  <Icon icon={Trash2} size="sm" />
                </button>
              </div>
            );
          })}
      </div>
      {dropdown}
      {showModal && <CreateNamespaceModal onClose={() => setShowModal(false)} />}
      {showSuperModal && (
        <CreateSuperClientModal
          onClose={() => setShowSuperModal(false)}
          onCreated={() => {
            void loadSuperClients();
          }}
        />
      )}
      {confirmSc && (
        <ConfirmDialog
          title="Delete super client"
          message={`Permanently delete "${confirmSc}" and all its chat history, documents, proposals, and microsites?`}
          confirmLabel="Delete"
          busy={deletingSc}
          onConfirm={handleDeleteSuperClient}
          onCancel={() => { if (!deletingSc) setConfirmSc(null); }}
        />
      )}
      {confirmNs && (
        <ConfirmDialog
          title="Delete client"
          message={`Permanently delete "${confirmNs}"? All ingested files, proposals, and microsites will be removed and cannot be recovered.`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => { if (!deleting) setConfirmNs(null); }}
        />
      )}
    </>
  );
}
