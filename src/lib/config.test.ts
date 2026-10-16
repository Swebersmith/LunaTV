/** @jest-environment node */
jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn().mockResolvedValue(null),
    getAllUsers: jest.fn().mockResolvedValue([]),
    saveAdminConfig: jest.fn(),
  },
}));

import { getConfig } from './config';
import { db } from './db';

it('does not write defaults when public requests or cold starts read config', async () => {
  const [first, second] = await Promise.all([getConfig(), getConfig()]);
  expect(first.SiteConfig).toBeDefined();
  expect(second.SiteConfig).toBeDefined();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
