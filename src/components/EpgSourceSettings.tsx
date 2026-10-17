'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRef, useState } from 'react';

import { EpgSource } from '@/lib/admin.types';
import { saveSourceChange } from '@/lib/admin-source-client';

import SourceAddress from '@/components/SourceAddress';
import SourceEditor, { SourceEditorValue } from '@/components/SourceEditor';

export default function EpgSourceSettings({
  sources,
  onChange,
}: {
  sources: EpgSource[];
  onChange: (sources: EpgSource[]) => void;
}) {
  const [editing, setEditing] = useState<EpgSource | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const actionStyle =
    'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200';

  const mutate = async (body: Record<string, unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await saveSourceChange('/api/admin/epg', body);
      if (!Array.isArray(result.sources))
        throw new Error('保存结果异常，请刷新后确认');
      onChange(result.sources);
      if (body.action === 'add' || body.action === 'edit') {
        setAdding(false);
        setEditing(null);
      }
      setMessage(
        body.action === 'disable'
          ? '已禁用节目单源'
          : body.action === 'enable'
          ? '已启用节目单源'
          : body.action === 'delete'
          ? '节目单源已删除'
          : body.action === 'sort'
          ? '节目单优先级已保存'
          : '节目单源已保存，下一次加载节目单时生效'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const save = (value: SourceEditorValue) => {
    void mutate({
      action: editing ? 'edit' : 'add',
      key: editing?.key || crypto.randomUUID(),
      name: value.name,
      url: value.url,
      ua: value.ua,
      note: value.note,
    });
  };
  const move = (index: number, offset: number) => {
    const order = sources.map((source) => source.key);
    [order[index], order[index + offset]] = [
      order[index + offset],
      order[index],
    ];
    void mutate({ action: 'sort', order });
  };
  return (
    <section
      aria-labelledby='epg-sources-title'
      className='mt-8 min-w-0 space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h4
          id='epg-sources-title'
          className='font-semibold text-gray-800 dark:text-gray-100'
        >
          直播节目单源（EPG）
        </h4>
        <button
          type='button'
          disabled={busy}
          onClick={() => {
            setEditing(null);
            setAdding(!adding);
          }}
          className='rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-40'
        >
          {adding ? '取消添加' : '添加节目单源'}
        </button>
      </div>
      <p className='text-sm leading-6 text-gray-600 dark:text-gray-300'>
        支持 XMLTV（.xml / .xml.gz）。所有直播源均可共用，节目单按频道的 tvg-id
        匹配。直播源单独填写的节目单地址优先，其次按下方顺序补充，最后使用 M3U
        自带的节目单。
      </p>
      {error && (
        <p
          role='alert'
          className='rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'
        >
          {error}
        </p>
      )}
      {message && (
        <p role='status' className='text-sm text-green-700 dark:text-green-400'>
          {message}
        </p>
      )}
      {(adding || editing) && (
        <SourceEditor
          key={editing?.key || 'new-epg'}
          kind='epg'
          source={editing || undefined}
          isNew={!editing}
          busy={busy}
          onSave={save}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {!sources.length && (
        <p className='rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
          尚未添加共用节目单源。现有直播源单独配置或 M3U 自带的节目单仍可使用。
        </p>
      )}
      <ol className='space-y-3'>
        {sources.map((source, index) => (
          <li
            key={source.key}
            data-epg-source={source.key}
            className='min-w-0 space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <span className='text-xs text-gray-500'>{index + 1}</span>
                <h5 className='break-all font-medium text-gray-900 dark:text-gray-100'>
                  {source.name}
                </h5>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    source.disabled
                      ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                      : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                  }`}
                >
                  {source.disabled ? '已禁用' : '启用中'}
                </span>
              </div>
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  aria-label={`上移${source.name}`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  className={actionStyle}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type='button'
                  aria-label={`下移${source.name}`}
                  disabled={busy || index === sources.length - 1}
                  onClick={() => move(index, 1)}
                  className={actionStyle}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setEditing(source);
                  }}
                  className={actionStyle}
                >
                  编辑
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      action: source.disabled ? 'enable' : 'disable',
                      key: source.key,
                    })
                  }
                  className={actionStyle}
                >
                  {source.disabled ? '启用' : '禁用'}
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() =>
                    void mutate({ action: 'delete', key: source.key })
                  }
                  className={actionStyle}
                >
                  删除
                </button>
              </div>
            </div>
            <SourceAddress
              value={source.url}
              label={`${source.name} 节目单地址`}
            />
            {source.ua && (
              <p className='break-all text-xs text-gray-500 dark:text-gray-400'>
                自定义 UA：{source.ua}
              </p>
            )}
            <p className='whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-300'>
              {source.note || '暂无备注'}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
