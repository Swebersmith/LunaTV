'use client';

import { useId, useState } from 'react';

export interface SourceEditorValue {
  key: string;
  name: string;
  api: string;
  detail: string;
  url: string;
  ua: string;
  epg: string;
  note: string;
}

export default function SourceEditor({
  kind,
  source,
  isNew,
  busy,
  onSave,
  onCancel,
}: {
  kind: 'video' | 'live';
  source?: Partial<SourceEditorValue>;
  isNew: boolean;
  busy: boolean;
  onSave: (value: SourceEditorValue) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<SourceEditorValue>({
    key: '',
    name: '',
    api: '',
    detail: '',
    url: '',
    ua: '',
    epg: '',
    note: '',
    ...source,
  });
  const title = `${isNew ? '添加' : '编辑'}${
    kind === 'video' ? '视频源' : '直播源'
  }`;
  const fields: {
    key: keyof SourceEditorValue;
    label: string;
    required?: boolean;
    url?: boolean;
  }[] = [
    { key: 'name', label: '名称', required: true },
    { key: 'key', label: isNew ? 'Key' : 'Key（保留原标识）', required: true },
    ...(kind === 'video'
      ? [
          { key: 'api' as const, label: 'API 地址', required: true, url: true },
          { key: 'detail' as const, label: 'Detail 地址（选填）', url: true },
        ]
      : [
          { key: 'url' as const, label: 'M3U 地址', required: true, url: true },
          { key: 'epg' as const, label: '节目单地址（选填）', url: true },
          { key: 'ua' as const, label: '自定义 UA（选填）' },
        ]),
  ];
  return (
    <form
      aria-label={title}
      className='source-editor rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave(draft);
      }}
    >
      <h5 className='mb-4 font-semibold text-gray-800 dark:text-gray-200'>
        {title}
      </h5>
      <fieldset disabled={busy} className='min-w-0 space-y-4'>
        <div className='grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2'>
          {fields.map((field) => (
            <div className='min-w-0' key={field.key}>
              <label
                htmlFor={`${id}-${field.key}`}
                className='mb-1 block text-xs text-gray-600 dark:text-gray-300'
              >
                {field.label}
              </label>
              <input
                id={`${id}-${field.key}`}
                autoFocus={field.key === 'name'}
                name={field.key}
                type={field.url ? 'url' : 'text'}
                inputMode={field.url ? 'url' : undefined}
                autoCapitalize='none'
                autoCorrect='off'
                spellCheck={false}
                required={field.required}
                maxLength={2000}
                readOnly={field.key === 'key' && !isNew}
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    [field.key]: event.target.value,
                  }))
                }
                className='w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 read-only:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:read-only:bg-gray-700'
              />
            </div>
          ))}
        </div>
        <div>
          <label
            htmlFor={`${id}-note`}
            className='mb-1 block text-xs text-gray-600 dark:text-gray-300'
          >
            备注（选填）
          </label>
          <textarea
            id={`${id}-note`}
            name='note'
            rows={3}
            maxLength={2000}
            value={draft.note}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                note: event.target.value,
              }))
            }
            placeholder='例如资源类型、画质、线路特点或使用说明'
            className='w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onCancel}
            className='rounded-lg bg-gray-600 px-4 py-2 text-sm text-white'
          >
            取消
          </button>
          <button
            type='submit'
            aria-busy={busy}
            className='rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50'
          >
            {busy ? '保存中…' : isNew ? '添加' : '保存'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
