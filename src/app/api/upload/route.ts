import { createCanvas } from '@napi-rs/canvas'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { extractMetadataFromBuffer } from '@/lib/pdf/metadata'
import { sanitizeStorageObjectName } from '@/lib/storage/sanitize-object-name'
import { put } from '@vercel/blob'

export const runtime = 'nodejs'

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }
  } as any
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    rect() {}
    moveTo() {}
    lineTo() {}
  } as any
}

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
    const { sanitized: sanitizedName, changed: nameChanged } = sanitizeStorageObjectName(file.name)
    const blobPath = `papers/${user.id}/${timestamp}-${sanitizedName}`
    
    if (nameChanged) {
      console.log('[Upload] Original filename sanitized for storage:', {
        original: file.name,
        sanitized: sanitizedName,
      })
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(new Uint8Array(arrayBuffer))

    // Upload to Vercel Blob
    console.log('[Upload] Starting Vercel Blob upload...')
    const blob = await put(blobPath, fileBuffer, {
      access: 'public',
      contentType: 'application/pdf',
    })
    console.log('[Upload] Vercel Blob upload successful:', blob.url)

    // Extract metadata
    console.log('[Upload] Starting metadata extraction...')
    let metadataResult: any
    try {
      const uint8Array = new Uint8Array(arrayBuffer)
      metadataResult = await extractMetadataFromBuffer(uint8Array, file.name)
      console.log('Metadata extraction result:', metadataResult._debug?.source)
    } catch (e) {
      console.error('Metadata extraction unexpected error:', e)
      metadataResult = {
        title: file.name.replace(/\.pdf$/i, ''),
        authors: '',
        journal: '',
        keywords: '',
        _debug: {
          source: 'crash_fallback',
          needsAIRefinement: true,
          processingTimeMs: 0,
          fileSizeMB: 0,
          textLength: 0,
          truncated: false,
        },
      }
    }

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
    console.error('Upload error details:', error)
    return NextResponse.json(
      { error: `Internal server error: ${error.message || error}` },
      { status: 500 }
    )
  }
}
