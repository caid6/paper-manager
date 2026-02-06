import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'API is working' })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    return NextResponse.json({ status: 'ok', received: body })
  } catch {
    return NextResponse.json({ status: 'ok', message: 'POST received' })
  }
}
