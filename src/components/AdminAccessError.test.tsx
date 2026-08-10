import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import AdminPage from '@/app/admin/page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/DataMigration', () => ({
  __esModule: true,
  default: () => null,
}));

describe('admin page', () => {
  afterEach(() => {
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('offers a return to the administrator login when configuration access is denied', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '你是管理员吗你就访问？' }),
    } as Response) as typeof fetch;

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('无法打开管理面板')).toBeInTheDocument();
    });
    expect(screen.getByText('当前账号没有管理员权限。')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '使用管理员账号登录' })
    ).toHaveAttribute('href', '/login?redirect=%2Fadmin');
  });
});
