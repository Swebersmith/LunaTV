export default function PanelLoading() {
  return (
    <div role='status' className='motion-panel-loading space-y-3 py-3'>
      <span className='text-sm text-gray-500 dark:text-gray-400'>正在载入设置…</span>
      <div className='h-10 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse' />
      <div className='h-10 w-3/4 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse' />
    </div>
  );
}
