import { createClient } from "@deepgram/sdk";

export async function transcribeVoice(audio: Buffer, apiKey: string): Promise<string> {
  const dg = createClient(apiKey);
  const { result, error } = await dg.listen.prerecorded.transcribeFile(audio, {
    model: "nova-3",
    language: "ru",
    detect_language: true,
    smart_format: true,
  });
  if (error) {
    throw new Error(`Deepgram error: ${error.message ?? JSON.stringify(error)}`);
  }
  const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  if (!transcript.trim()) throw new Error("Deepgram returned empty transcript");
  return transcript;
}
