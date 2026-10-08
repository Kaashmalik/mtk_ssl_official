import { SetMetadata } from "@nestjs/common";

export interface RequiredPermission {
  resource: string;
  action: string;
}

export const PERMISSIONS_KEY = "permissions";
export const Permissions = (resource: string, action: string) =>
  SetMetadata(PERMISSIONS_KEY, { resource, action });
