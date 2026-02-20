export type OutputFormat = "png" | "svg";

export type CliOptions = {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
  concurrency: number;
};
