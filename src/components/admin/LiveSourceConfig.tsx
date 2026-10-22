/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { saveSourceChange } from '@/lib/admin-source-client';

import SortableSourceRow from '@/components/SortableSourceRow';
import SourceAddress from '@/components/SourceAddress';
import SourceEditor, { SourceEditorValue } from '@/components/SourceEditor';

import { AlertModal, buttonStyles, LiveDataSource, showError, useAlertModal, useLoadingState } from './shared';

// 直播源配置组件
const LiveSourceConfig = ({
  config,
  refreshConfig,
  onSourcesChange,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  onSourcesChange: (sources: NonNullable<AdminConfig['LiveConfig']>) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [liveSources, setLiveSources] = useState<LiveDataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLiveSource, setEditingLiveSource] = useState<LiveDataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.LiveConfig) {
      setLiveSources(config.LiveConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callLiveSourceApi = async (body: Record<string, any>) => {
    try {
      const result = await saveSourceChange('/api/admin/live', body);
      if (Array.isArray(result.sources)) {
        setLiveSources(result.sources);
        onSourcesChange(result.sources);
      } else await refreshConfig();
      if (body.action === 'enable' || body.action === 'disable') setOperationMessage(body.action === 'disable' ? '已禁用直播源' : '已启用直播源');
      return result;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = liveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleLiveSource_${key}`, () => callLiveSourceApi({ action, key })).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteLiveSource_${key}`, () => callLiveSourceApi({ action: 'delete', key })).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  // 刷新直播源
  const handleRefreshLiveSources = async () => {
    if (isRefreshing) return;

    await withLoading('refreshLiveSources', async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch('/api/admin/live/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `刷新失败: ${response.status}`);
        }

        // 刷新成功后重新获取配置
        await refreshConfig();
        showAlert({ type: 'success', title: '刷新成功', message: '直播源已刷新', timer: 2000 });
      } catch (err) {
        showError(err instanceof Error ? err.message : '刷新失败', showAlert);
        throw err;
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const handleSaveLiveSource = (value: SourceEditorValue) => {
    withLoading('saveLiveSource', async () => {
      const result = await callLiveSourceApi({ action: editingLiveSource ? 'edit' : 'add', ...value });
      setEditingLiveSource(null);
      setShowAddForm(false);
      setOperationMessage(result.needsRefresh ? '已保存，频道将在打开直播或刷新直播源时更新' : '直播源已保存');
    }).catch(() => undefined);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = liveSources.findIndex((s) => s.key === active.id);
    const newIndex = liveSources.findIndex((s) => s.key === over.id);
    setLiveSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = liveSources.map((s) => s.key);
    withLoading('saveLiveSourceOrder', () => callLiveSourceApi({ action: 'sort', order }))
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const renderLiveRow = (liveSource: LiveDataSource) => (
      <SortableSourceRow key={liveSource.key} id={liveSource.key}>
        <td data-source-cell='name' className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.name}
        </td>
        <td data-source-cell='key' data-label='Key' className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.key}
        </td>
        <td
          className='min-w-[16rem] max-w-[24rem] px-4 py-4 text-sm' data-source-cell='api' data-label='M3U 地址'
        >
          <SourceAddress value={liveSource.url} label={`${liveSource.name} M3U 地址`} />
        </td>
        <td
          className='min-w-[12rem] max-w-[20rem] px-4 py-4 text-sm' data-source-cell='detail' data-label='节目单地址'
        >
          <SourceAddress value={liveSource.epg} label={`${liveSource.name} 节目单地址`} />
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[8rem] truncate'
          data-source-cell='ua' data-label='User-Agent'
          title={liveSource.ua || '-'}
        >
          {liveSource.ua || '-'}
        </td>
        <td data-source-cell='channels' data-label='频道数' className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center'>
          {liveSource.channelNumber && liveSource.channelNumber > 0 ? liveSource.channelNumber : '-'}
        </td>
        <td data-source-cell='status' className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${!liveSource.disabled
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
              }`}
          >
            {!liveSource.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td data-source-cell='note' data-label='备注' className='min-w-[12rem] max-w-[20rem] px-4 py-4 text-sm'>
          <p className='source-note whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300'>{liveSource.note || '暂无备注'}</p>
        </td>
        <td data-source-cell='actions' className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button type='button' disabled={isLoading('saveLiveSource')} onClick={() => { setShowAddForm(false); setEditingLiveSource({ ...liveSource }); }} className={buttonStyles.roundedPrimary}>编辑</button>
          <button
            onClick={() => handleToggleEnable(liveSource.key)}
            disabled={isLoading(`toggleLiveSource_${liveSource.key}`)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${!liveSource.disabled
              ? buttonStyles.roundedDanger
              : buttonStyles.roundedSuccess
              } transition-colors ${isLoading(`toggleLiveSource_${liveSource.key}`) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLoading(`toggleLiveSource_${liveSource.key}`) ? '保存中…' : !liveSource.disabled ? '禁用' : '启用'}
          </button>
          {liveSource.from !== 'config' && (
            <>
              <button
                onClick={() => handleDelete(liveSource.key)}
                disabled={isLoading(`deleteLiveSource_${liveSource.key}`)}
                className={`${buttonStyles.roundedSecondary} ${isLoading(`deleteLiveSource_${liveSource.key}`) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                删除
              </button>
            </>
          )}
        </td>
      </SortableSourceRow>
  );

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加直播源表单 */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          直播源列表
        </h4>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            onClick={handleRefreshLiveSources}
            disabled={isRefreshing || isLoading('refreshLiveSources')}
            className={`px-3 py-1.5 text-sm font-medium flex items-center space-x-2 ${isRefreshing || isLoading('refreshLiveSources')
              ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg'
              : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors'
              }`}
          >
            <span>{isRefreshing || isLoading('refreshLiveSources') ? '刷新中...' : '刷新直播源'}</span>
          </button>
          <button
            onClick={() => { setEditingLiveSource(null); setShowAddForm(!showAddForm); }}
            disabled={isLoading('saveLiveSource')}
            className={showAddForm ? buttonStyles.secondary : buttonStyles.success}
          >
            {showAddForm ? '取消' : '添加直播源'}
          </button>
        </div>
      </div>

      {operationMessage && <p role='status' className='text-sm text-green-700 dark:text-green-400'>{operationMessage}</p>}
      {(showAddForm || editingLiveSource) && <SourceEditor key={editingLiveSource?.key || 'new-live'} kind='live' source={editingLiveSource || undefined} isNew={!editingLiveSource} busy={isLoading('saveLiveSource')} onSave={handleSaveLiveSource} onCancel={() => { setShowAddForm(false); setEditingLiveSource(null); }} />}

      {/* 直播源表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto relative' data-table="live-source-list">
        <table className='source-list-table source-list-table--live min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
            <tr>
              <th className='w-8' />
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Key
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                M3U 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                节目单地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                自定义 UA
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                频道数
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'>备注</th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={liveSources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {liveSources.map(renderLiveRow)}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveLiveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${isLoading('saveLiveSourceOrder') ? buttonStyles.disabled : buttonStyles.primary}`}
          >
            {isLoading('saveLiveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />


    </div>
  );
};


export default LiveSourceConfig;
