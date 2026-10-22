import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { AdminConfigResult } from '@/lib/admin.types';
import { loadAdminConfig } from '@/lib/admin-config-client';

import AdminPage from './page';

jest.mock('@/lib/admin-config-client', () => ({ loadAdminConfig: jest.fn() }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const result: AdminConfigResult = {
  Role: 'owner',
  Config: {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 'CrayonTV', Announcement: '', SearchDownstreamMaxPage: 1,
      SiteInterfaceCacheTime: 7200, DoubanProxyType: 'direct', DoubanProxy: '',
      DoubanImageProxyType: 'server', DoubanImageProxy: '', DisableYellowFilter: true,
      FluidSearch: true, EnableWebLive: false,
    },
    UserConfig: { Users: [{ username: 'admin', role: 'owner' }], Tags: [] },
    SourceConfig: [], CustomCategories: [], LiveConfig: [], EpgConfig: [],
  },
};

beforeEach(() => {
  (loadAdminConfig as jest.Mock).mockReset().mockResolvedValue(result);
});

it('shows the loading shell and then the configuration sections', async () => {
  render(<AdminPage />);
  expect(screen.getByRole('status')).toHaveTextContent('正在载入管理面板');
  const site = await screen.findByRole('button', { name: '站点配置' });
  expect(site).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: '视频源配置' })).toHaveAttribute('aria-expanded', 'false');
  expect(loadAdminConfig).toHaveBeenCalledWith(true);
  expect(screen.queryByDisplayValue('CrayonTV')).toBeNull();
});

it('loads the actual site settings only when the section is expanded', async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '站点配置' }));
  expect(await screen.findByDisplayValue('CrayonTV')).toBeVisible();
  expect(screen.getByRole('button', { name: '站点配置' })).toHaveAttribute('aria-expanded', 'true');
});

it('keeps owner-only sections out of an administrator panel', async () => {
  (loadAdminConfig as jest.Mock).mockResolvedValue({ ...result, Role: 'admin' });
  render(<AdminPage />);
  await screen.findByRole('button', { name: '站点配置' });
  expect(screen.queryByRole('button', { name: '配置文件' })).toBeNull();
  expect(screen.queryByRole('button', { name: '数据迁移' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重置配置' })).toBeNull();
});
