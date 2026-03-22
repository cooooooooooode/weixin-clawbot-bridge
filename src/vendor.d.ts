declare module "silk-wasm" {
  export function decode(
    silk: Buffer | Uint8Array,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>
}

declare module "fluent-ffmpeg" {
  interface FfmpegCommand {
    setFfmpegPath(path: string): FfmpegCommand
    seekInput(time: number): FfmpegCommand
    frames(n: number): FfmpegCommand
    outputOptions(opts: string[]): FfmpegCommand
    output(path: string): FfmpegCommand
    on(event: "end", cb: () => void): FfmpegCommand
    on(event: "error", cb: (err: Error) => void): FfmpegCommand
    run(): void
  }
  function ffmpeg(input: string): FfmpegCommand
  export default ffmpeg
}
