import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { sanitizeStorageObjectName } from '@/lib/storage/sanitize-object-name'
import { extractText, getDocumentProxy } from 'unpdf'

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

    // Extract metadata using unpdf (pure Node.js, no DOM needed)
    let metadataResult = {
      title: file.name.replace(/\.pdf$/i, ''),
      authors: '',
      journal: '',
      keywords: '',
      _debug: {
        source: 'filename_fallback',
        needsAIRefinement: true,
        processingTimeMs: 0,
        fileSizeMB: file.size / (1024 * 1024),
        textLength: 0,
        truncated: false,
      },
    }

    try {
      const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer))
      const { text } = await extractText(pdf, { mergePages: true })
      
      const fullText = typeof text === 'string' ? text : (text as string[]).join('\n')
      
      const lines = fullText.split('\n').filter((line: string) => line.trim().length > 0)
      const firstNonEmptyLine = lines[0] || file.name.replace(/\.pdf$/i, '')
      
      metadataResult = {
        title: firstNonEmptyLine.slice(0, 200),
        authors: '',
        journal: '',
        keywords: '',
        _debug: {
          source: 'unpdf_text_extraction',
          needsAIRefinement: true,
          processingTimeMs: Date.now(),
          fileSizeMB: file.size / (1024 * 1024),
          textLength: fullText.length,
          truncated: fullText.length > 3000,
        },
      }
    } catch (pdfError) {
      console.error('[Upload] PDF text extraction failed:', pdfError)
    }

    // Upload to Vercel Blob
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
        title: metadataResult.title,
        authors: metadataResult.authors,
        journal: metadataResult.journal,
        keywords: metadataResult.keywords,
      },
      _debug: metadataResult._debug,
    })

  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
