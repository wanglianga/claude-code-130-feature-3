import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../entities/core';

export const ROLES_KEY = 'roles';
import { SetMetadata } from '@nestjs/common';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) throw new UnauthorizedException('缺少登录令牌');
    try {
      req.user = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException('登录令牌无效或已过期');
    }
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (required && required.length && !required.includes(req.user.role)) {
      throw new ForbiddenException(`当前角色 ${req.user.role} 无权操作`);
    }
    return true;
  }
}
