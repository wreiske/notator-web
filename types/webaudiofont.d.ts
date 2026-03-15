declare module "webaudiofont" {
  class WebAudioFontPlayer {
    loader: {
      startLoad(
        audioContext: AudioContext,
        filePath: string,
        variableName: string
      ): void;
      loaded(variableName: string): boolean;
      waitLoad(onFinish: () => void): void;
      findInstrument(program: number): number;
      instrumentInfo(n: number): {
        variable: string;
        url: string;
        title: string;
        pitch: number;
      };
      findDrum(nn: number): number;
      drumInfo(n: number): {
        variable: string;
        url: string;
        title: string;
        pitch: number;
      };
    };

    queueWaveTable(
      audioContext: AudioContext,
      target: AudioNode,
      preset: unknown,
      when: number,
      pitch: number,
      duration: number,
      volume?: number,
      slides?: unknown[]
    ): { audioBufferSourceNode?: AudioBufferSourceNode };

    cancelQueue(audioContext: AudioContext): void;
    adjustPreset(audioContext: AudioContext, preset: unknown): void;
  }

  export default WebAudioFontPlayer;
  export { WebAudioFontPlayer };
}
