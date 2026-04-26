import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text: string };
    if (!text?.trim()) return NextResponse.json({ error: "No text" }, { status: 400 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: "nova",       // natural, warm, professional
      input: text.slice(0, 4096),
      speed: 1.0,
    });

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[speak]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
