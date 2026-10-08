import { SetMetadata } from "@nestjs/common";

export const ROLE_THROTTLE_KEY = "roleThrottle";
export type RoleThrottleConfig = {
  admin?: number;
  owner?: number;
  scorer?: number;
  user?: number;
};

export const RoleThrottle = (config: RoleThrottleConfig) =>
  SetMetadata(ROLE_THROTTLE_KEY, config);