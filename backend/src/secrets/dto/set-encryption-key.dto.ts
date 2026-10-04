import { IsString, MinLength } from 'class-validator';

export class SetEncryptionKeyDto {
  @IsString()
  @MinLength(8)
  key: string;
}
