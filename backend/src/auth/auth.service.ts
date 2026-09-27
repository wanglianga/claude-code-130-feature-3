import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../entities/core';

export function hashPassword(raw: string): string {
  return crypto.createHash('sha256').update(`pet::${raw}`).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.findOne({ where: { username } });
    if (!user || user.password !== hashPassword(password)) {
      throw new UnauthorizedException('账号或密码错误');
    }
    const token = await this.jwt.signAsync({
      sub: user.id, username: user.username, name: user.name,
      role: user.role, store_id: user.store_id,
    });
    return {
      token,
      user: {
        id: user.id, username: user.username, name: user.name,
        role: user.role, phone: user.phone, store_id: user.store_id,
      },
    };
  }

  async registerOwner(dto: { username: string; password: string; name: string; phone: string }) {
    const exists = await this.users.findOne({ where: { username: dto.username } });
    if (exists) throw new UnauthorizedException('用户名已存在');
    const user = this.users.create({
      username: dto.username,
      password: hashPassword(dto.password),
      name: dto.name, phone: dto.phone, role: 'owner',
    });
    return this.users.save(user);
  }
}
