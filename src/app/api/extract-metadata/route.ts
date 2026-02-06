import { NextRequest, NextResponse } from 'next/server'
import { extractMetadataFromBuffer, extractMetadataFromUrl } from '@/lib/pdf/metadata'
import { createClient } from '@/lib/supabase/server'
import { supportsHttpRange, withRetries } from '@/lib/pdf/pdfjs-url-text'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const supabase = await createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json()

      if (body.file_url) {
        const fileUrl = String(body.file_url)
        const fileName = String(body.file_name || 'unknown.pdf')

        // Vercel Blob URLs are public and contain user ID in path
        // Format: https://xxx.blob.vercel-storage.com/papers/{userId}/{filename}
        const urlPattern = new RegExp(`/papers/${user.id}/`)
        if (!urlPattern.test(fileUrl)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const rangeSupported = await supportsHttpRange(fileUrl)

        if (rangeSupported) {
          try {
            const { result, attempts } = await withRetries(async () => {
              const r = await extractMetadataFromUrl(fileUrl, fileName)
              const retryable = r._debug?.source === 'parse_failed' || r._debug?.source === 'extraction_error'
              if (retryable) {
                throw new Error(r._debug?.error || r._debug?.source || 'range_extract_failed')
              }
              return r
            }, 3)

            return NextResponse.json({
              title: result.title,
              authors: result.authors,
              journal: result.journal,
              keywords: result.keywords,
              _debug: result._debug,
              _transport: {
                mode: 'range_pdfjs',
                attempts,
                rangeSupported: true,
              },
            })
          } catch (e) {
            console.warn('[extract-metadata] Range parsing failed, falling back:', e)
          }
        }

        const pdfResponse = await fetch(fileUrl)
        const arrayBuffer = await pdfResponse.arrayBuffer()
        const buffer = new Uint8Array(arrayBuffer)

        const result = await extractMetadataFromBuffer(buffer, fileName)

        return NextResponse.json({
          title: result.title,
          authors: result.authors,
          journal: result.journal,
          keywords: result.keywords,
          _debug: result._debug,
          _transport: {
            mode: 'full_buffer',
            attempts: rangeSupported ? 3 : 0,
            rangeSupported,
          },
        })
      }

      return NextResponse.json({ error: 'No file_url provided' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 })

  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error')

    return NextResponse.json({
      error: 'Failed to extract metadata',
      title: '',
      authors: '',
      keywords: '',
      journal: '',
      _debug: {
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
      }
    }, { status: 200 })
  }
}
