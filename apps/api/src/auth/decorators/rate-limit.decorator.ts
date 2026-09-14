import { applyDecorators, SetMetadata,UseGuards } from '@nestjs/common';

import { RateLimitGuard } from '../guards/rate-limit.guard';

export const RateLimit = () => applyDecorators(
  SetMetadata('rateLimit', true),
  UseGuards(RateLimitGuard),
);
