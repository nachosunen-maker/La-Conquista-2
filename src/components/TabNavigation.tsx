import React from 'react';
import { Castle, Swords, GraduationCap, Landmark, Map } from 'lucide-react';

export type MainTab = 'aldea' | 'ejercito' | 'universidad' | 'parlamento' | 'mapa';

export const MAIN_TABS: ReadonlyArray<{ id: MainTab; label: string; icon: React.ReactNode }> = [
  { id: 'aldea', label: 'Aldea', icon: <Castle className="w-4 h-4" /> },
  { id: 'ejercito', label: 'Ejército', icon: <Swords className="w-4 h-4" /> },
  { id: 'universidad', label: 'Universidad', icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'parlamento', label: 'Parlamento', icon: <Landmark className="w-4 h-4" /> },
  { id: 'mapa', label: 'Mapa', icon: <Map className="w-4 h-4" /> },
];

/**
 * Navegación principal (P64): pestañas superiores en escritorio y barra inferior
 * fija en móvil. La insignia del Parlamento (P58) muestra los desafíos pendientes.
 */
export function TabNavigation(props: { active: MainTab; onChange: (tab: MainTab) => void; parliamentBadge: number }) {
  const { active, onChange, parliamentBadge } = props;
  const renderTab = (tab: (typeof MAIN_TABS)[number], compact: boolean) => {
    const isActive = active === tab.id;
    const badge = tab.id === 'parlamento' && parliamentBadge > 0 ? parliamentBadge : 0;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`relative flex ${compact ? 'flex-col flex-1 py-2' : 'flex-row px-4 py-2'} items-center justify-center gap-1 text-xs font-serif font-semibold uppercase tracking-wider transition-colors ${
          isActive
            ? 'text-[#d4af37] ' + (compact ? 'bg-[#1f180f]' : 'border-b-2 border-[#d4af37] bg-[#1a150e]')
            : 'text-[#8e816d] hover:text-[#e8dfc8]'
        }`}
      >
        {tab.icon}
        <span className={compact ? 'text-[10px]' : ''}>{tab.label}</span>
        {badge > 0 && (
          <span
            className={`absolute ${compact ? 'top-1 right-1/2 translate-x-5' : '-top-1 -right-1'} min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center border border-rose-300/40`}
            title={`${badge} desafío(s) pendiente(s)`}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <nav className="hidden sm:flex items-stretch bg-[#12100d] border border-[#2b2419] rounded-xl overflow-hidden" aria-label="Secciones principales">
        {MAIN_TABS.map((tab) => renderTab(tab, false))}
      </nav>
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-[#12100d] border-t border-[#2b2419] shadow-[0_-4px_12px_rgba(0,0,0,0.5)]"
        aria-label="Secciones principales"
      >
        {MAIN_TABS.map((tab) => renderTab(tab, true))}
      </nav>
    </>
  );
}
