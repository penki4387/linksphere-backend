import { IsBoolean, IsOptional, IsUrl } from 'class-validator';

export class UploadTaskDto {
  @IsUrl({ require_protocol: true })
  videoUrl: string;

  /** Test-only hook: forces every processing attempt to fail (DLQ path). */
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
