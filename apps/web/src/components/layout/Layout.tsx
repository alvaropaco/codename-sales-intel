import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ActiveTab } from '@/types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  totalProspectsCount: number;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenCreateModal: () => void;
  onOpenQualifyModal: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  activeTab,
  setActiveTab,
  isDark,
  setIsDark,
  totalProspectsCount,
  searchQuery,
  setSearchQuery,
  onOpenCreateModal,
  onOpenQualifyModal,
}) => {
  return (
    <div className={`min-h-screen flex ${isDark ? 'dark bg-background text-foreground' : 'light bg-slate-50 text-slate-900'}`}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDark={isDark}
        setIsDark={setIsDark}
        totalProspectsCount={totalProspectsCount}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeTab={activeTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onOpenCreateModal={onOpenCreateModal}
          onOpenQualifyModal={onOpenQualifyModal}
        />
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
