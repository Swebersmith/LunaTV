import PageLayout from '@/components/PageLayout';

export default function AdminPageSkeleton() {
  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8' aria-busy='true'>
        <div className='max-w-[95%] mx-auto'>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>管理员设置</h1>
          <div role='status' className='space-y-4'>
            <span className='sr-only'>正在载入管理面板…</span>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className='h-[72px] rounded-xl bg-gray-200/70 dark:bg-gray-700/70 animate-pulse' />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
