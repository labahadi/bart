'use client';

import { useParams } from 'next/navigation';
import { ListingForm } from '@/components/ListingForm';

export default function EditListing() {
  const { id } = useParams<{ id: string }>();
  return <ListingForm editId={id} />;
}
