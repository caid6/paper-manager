import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { sanitizeStorageObjectName } from '@/lib/storage/sanitize-object-name'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 })
    }

    const timestamp = Date.now()
    const { sanitized: sanitizedName } = sanitizeStorageObjectName(file.name)
    const blobPath = `papers/${user.id}/${timestamp}-${sanitizedName}`

    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(new Uint8Array(arrayBuffer))

    const blob = await put(blobPath, fileBuffer, {
      access: 'public',
      contentType: 'application/pdf',
    })

    return NextResponse.json({
      file_url: blob.url,
      file_name: file.name,
      file_size: file.size,
      signed_url: blob.url,
      metadata: {
        title: file.name.replace(/\.pdf$/i, ''),
        authors: '',
        journal: '',
        keywords: '',
      },
      _debug: {
        source: 'filename_fallback',
        needsAIRefinement: true,
      },
    })

  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
