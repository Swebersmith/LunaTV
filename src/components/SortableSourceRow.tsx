import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { ReactNode } from 'react';

export default function SortableSourceRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className='source-list-row hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
    >
      <td
        data-source-cell='drag'
        className='px-2 py-4 cursor-grab text-gray-400'
        style={{ touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </td>
      {children}
    </tr>
  );
}
