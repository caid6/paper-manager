import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { PaperReader } from '@/components/paper/reader'
import { isVercelBlobUrl } from '@/lib/storage/blob-storage'

interface PaperPageProps {
  params: Promise<{ id: string }>
}

export default async function PaperPage({ params }: PaperPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const supabaseAny = supabase as any

  const { data: paperResult, error } = await supabaseAny
    .from('papers')
    .select('*')
    .eq('id', id)
    .single()

  const paper = paperResult as any

  if (error || !paper) {
    notFound()
  }

  const { data: note } = await supabaseAny
    .from('notes')
    .select('*')
    .eq('paper_id', id)
    .single()

  // Use Vercel Blob URL directly (public access)
  // If it's still a Supabase URL (legacy), generate signed URL
  let pdfUrl = paper.file_url
  if (!isVercelBlobUrl(paper.file_url)) {
    const { data: signedUrlData } = await supabase.storage
      .from('papers')
      .createSignedUrl(paper.file_url, 60 * 60)
    pdfUrl = signedUrlData?.signedUrl || ''
  }

  return (
    <PaperReader 
      paper={paper} 
      note={note} 
      pdfUrl={pdfUrl} 
    />
  )
}
