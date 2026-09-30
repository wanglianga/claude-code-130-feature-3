import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { StorageService } from './storage.service';

/**
 * 骨灰寄存到期续费、授权与柜位处置。
 * 角色：owner 主人；customer_service 客服；cs_lead 客服主管；
 *       storage_lead 寄存主管；finance 财务；manager 管理者。
 */
@Controller('api')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private svc: StorageService) {}

  /** 工单聚合视图：联系人/授权、多轮联系、续费校验、长期柜位比较、处置申请与指令 */
  @Get('storage/appointments/:id')
  view(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.svc.storageView(id, req.user);
  }

  // —— 联系人偏好 / 有效性 / 授权 ——
  @Post('storage/appointments/:id/preferences')
  preferences(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.setPreferences(id, body, req.user);
  }

  @Post('storage/appointments/:id/validity')
  @Roles('customer_service', 'cs_lead', 'storage_lead', 'manager')
  validity(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.setValidity(id, body, req.user);
  }

  @Post('storage/appointments/:id/authorization')
  authorization(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.authorization(id, body, req.user);
  }

  // —— 多轮联系 ——
  @Post('storage/appointments/:id/attempts')
  @Roles('customer_service', 'cs_lead', 'manager')
  addAttempt(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.addAttempt(id, body, req.user);
  }

  // —— 家属取回骨灰 ——
  @Post('storage/appointments/:id/retrieve')
  retrieve(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.retrieveUrn(id, body || {}, req.user);
  }

  // —— 续费 / 年费价目 / 到期扫描（/api/lockers/* 为旧路径，统一由本服务实现）——
  @Post('lockers/:lid/renew')
  renew(@Param('lid', ParseIntPipe) lid: number, @Body() body: any, @Req() req: any) {
    return this.svc.renewLocker(lid, body || {}, req.user);
  }

  @Post('storage/lockers/:lid/price')
  @Roles('storage_lead', 'manager')
  price(@Param('lid', ParseIntPipe) lid: number, @Body() body: any, @Req() req: any) {
    return this.svc.setLockerPrice(lid, body, req.user);
  }

  @Post('lockers/scan')
  @Roles('customer_service', 'cs_lead', 'storage_lead', 'manager')
  scan(@Req() req: any) { return this.svc.scanLockers(req.user); }

  // —— 转长期寄存（家属选择；客服比较柜位/迁移时间/家属确认） ——
  @Post('storage/appointments/:id/long-term')
  @Roles('customer_service', 'cs_lead', 'manager')
  longTerm(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.requestLongTerm(id, body, req.user);
  }

  @Post('storage/directives/:did/family-respond')
  familyRespond(@Param('did', ParseIntPipe) did: number, @Body() body: any, @Req() req: any) {
    return this.svc.familyRespond(did, body, req.user);
  }

  // —— 逾期处置：申请 / 双级审批 ——
  @Post('storage/appointments/:id/disposal-cases')
  @Roles('customer_service', 'cs_lead', 'manager')
  createCase(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.createDisposalCase(id, body, req.user);
  }

  @Post('storage/disposal-cases/:cid/cs-lead-review')
  @Roles('cs_lead', 'manager')
  csLeadReview(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.svc.csLeadReview(cid, body, req.user);
  }

  @Post('storage/disposal-cases/:cid/storage-lead-review')
  @Roles('storage_lead', 'manager')
  storageLeadReview(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.svc.storageLeadReview(cid, body, req.user);
  }

  // —— 指令执行 / 撤回 / 家属回访 ——
  @Post('storage/directives/:did/execute')
  @Roles('customer_service', 'cs_lead', 'storage_lead', 'manager')
  execute(@Param('did', ParseIntPipe) did: number, @Body() body: any, @Req() req: any) {
    return this.svc.executeDirective(did, body || {}, req.user);
  }

  @Post('storage/directives/:did/withdraw')
  withdraw(@Param('did', ParseIntPipe) did: number, @Body() body: any, @Req() req: any) {
    return this.svc.withdrawDirective(did, body || {}, req.user);
  }

  @Post('storage/directives/:did/callback')
  @Roles('customer_service', 'cs_lead', 'manager')
  callback(@Param('did', ParseIntPipe) did: number, @Body() body: any, @Req() req: any) {
    return this.svc.addCallback(did, body, req.user);
  }

  // —— 列表 / 总览 ——
  @Get('storage/disposal-cases')
  @Roles('customer_service', 'cs_lead', 'storage_lead', 'manager')
  listCases(@Req() req: any) { return this.svc.listCases(req.user); }

  @Get('storage/directives')
  @Roles('customer_service', 'cs_lead', 'storage_lead', 'manager')
  listDirectives(@Req() req: any) { return this.svc.listDirectives(req.user); }

  @Get('storage/overview')
  @Roles('cs_lead', 'storage_lead', 'manager')
  overview() { return this.svc.overviewStats(); }
}
