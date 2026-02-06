import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { extractText, getDocumentProxy } from 'unpdf'
import { extractTextFromPdfUrl, supportsHttpRange, withRetries } from '@/lib/pdf/pdfjs-url-text'
import { isVercelBlobUrl } from '@/lib/storage/blob-storage'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const supabaseAny = supabase as any
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { paperId } = await req.json()
    
    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    const { data: paperResult, error: paperError } = await supabaseAny
      .from('papers')
      .select('file_url')
      .eq('id', paperId)
      .eq('user_id', user.id)
      .single()

    const paper = paperResult as { file_url: string } | null
    
    if (paperError || !paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    const pdfUrl = paper.file_url

    if (!pdfUrl) {
      return NextResponse.json({ error: 'PDF URL not found' }, { status: 500 })
    }

    // Vercel Blob URLs are public, no need for signed URL
    const maxLength = 80000

    // Try range-based parsing for better performance
    const rangeSupported = await supportsHttpRange(pdfUrl)

    if (rangeSupported) {
      try {
        const { result, attempts } = await withRetries(
          async () => extractTextFromPdfUrl(pdfUrl, { maxChars: maxLength }),
          3
        )

        let text = result.text
          .replace(/\s+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()

        if (text.length > maxLength) {
          text = text.slice(0, maxLength) + '\n\n[... 内容已截断，论文较长 ...]'
        } else if (result.truncated) {
          text = text + '\n\n[... 内容已截断，论文较长 ...]'
        }

        return NextResponse.json({
          text,
          pages: result.totalPages,
          _debug: {
            mode: 'range_pdfjs',
            attempts,
            rangeSupported: true,
            pagesScanned: result.pagesScanned,
            truncated: result.truncated,
          },
        })
      } catch (e) {
        console.warn('[parse-pdf] Range parsing failed, falling back:', e)
      }
    }

    // Fallback: download full PDF
    const pdfResponse = await fetch(pdfUrl)
    const pdfBuffer = await pdfResponse.arrayBuffer()

    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer))
    const { text: pdfText, totalPages } = await extractText(pdf, { mergePages: true })

    let fullText = typeof pdfText === 'string' ? pdfText : (pdfText as string[]).join('\n')
    fullText = fullText
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (fullText.length > maxLength) {
      fullText = fullText.slice(0, maxLength) + '\n\n[... 内容已截断，论文较长 ...]'
    }

    return NextResponse.json({
      text: fullText,
      pages: totalPages,
      _debug: {
        mode: 'full_unpdf',
        attempts: rangeSupported ? 3 : 0,
        rangeSupported,
      },
    })
    
  } catch (error) {
    console.error('PDF parse error:', error)
    return NextResponse.json({ 
      error: 'Failed to parse PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
