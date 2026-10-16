import { AdminConfig } from './admin.types';
import { mergeLiveChannelCounts } from './live-config';

it('merges refreshed counts without undoing a disable, edit, deletion, or note made during a download', () => {
  const config = {
    LiveConfig: [
      {
        key: 'disabled',
        url: 'https://one.test',
        disabled: true,
        note: '保留禁用',
        channelNumber: 1,
      },
      { key: 'edited', url: 'https://changed.test', channelNumber: 2 },
      {
        key: 'kept',
        url: 'https://three.test',
        name: '新名称',
        note: '新备注',
        channelNumber: 3,
      },
    ],
  } as AdminConfig;
  const updates = [
    { key: 'disabled', url: 'https://one.test', count: 100 },
    { key: 'edited', url: 'https://old.test', count: 100 },
    { key: 'deleted', url: 'https://two.test', count: 100 },
    { key: 'kept', url: 'https://three.test', count: 4 },
  ];
  expect(mergeLiveChannelCounts(config, updates)).toBe(true);
  expect(config.LiveConfig).toMatchObject([
    { disabled: true, note: '保留禁用', channelNumber: 1 },
    { url: 'https://changed.test', channelNumber: 2 },
    { name: '新名称', note: '新备注', channelNumber: 4 },
  ]);
  expect(mergeLiveChannelCounts(config, updates)).toBe(false);
});
