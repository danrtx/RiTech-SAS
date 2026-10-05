import { IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class NdxInvestmentDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  entryDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  valuationDate: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(1000000000000)
  investedAmount: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  @Max(10000)
  upPercent: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  @Max(200)
  downPercent: number;
}
