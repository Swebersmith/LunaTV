import PageLayout from '@/components/PageLayout';

export default function AdminAccessError() {
  return (
    <PageLayout activePath='/admin'>
      <main className='mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center'>
        <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
          无法打开管理面板
        </h1>
        <p className='mt-3 text-sm text-gray-600 dark:text-gray-400'>
          当前账号没有管理员权限。
        </p>
        <a
          href='/login?redirect=%2Fadmin'
          className='mt-6 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700'
        >
          使用管理员账号登录
        </a>
      </main>
    </PageLayout>
  );
}
