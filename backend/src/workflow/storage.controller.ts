import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { StorageService } from './storage.service';

/**
 * 骨灰寄存到期续费、授权与柜位处置。
 * 角色：owner 主人；customer_service 客服；cs_supervisor 客服主管；
 *       storage_manager 寄存主管；finance 财务；manager 管理者（全门店）。
 */
@Controller('api/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private st: StorageService) {}

  // —— 偏好与联系人 ——
  @Post('appointments/:id/preference')
  setPref(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.setPreference(id, body, req.user);
  }

  @Post('appointments/:id/contact-check')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager')
  contactCheck(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.checkContact(id, body, req.user);
  }

  // —— 授权文件 ——
  @Post('appointments/:id/authorizations')
  uploadAuth(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.uploadAuthorization(id, body, req.user);
  }

  @Post('authorizations/:docId/verify')
  @Roles('storage_manager', 'manager')
  verifyAuth(@Param('docId', ParseIntPipe) docId: number, @Body() body: any, @Req() req: any) {
    return this.st.verifyAuthorization(docId, body, req.user);
  }

  // —— 到期提醒扫描 ——
  @Post('scan')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager')
  scan(@Req() req: any) { return this.st.scanReminders(req.user); }

  // —— 续费：校验 + 确认 ——
  @Post('appointments/:id/renew-check')
  renewCheck(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.renewCheck(id, body || { months: 12 }, req.user);
  }

  @Post('appointments/:id/renew')
  renew(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.renewConfirm(id, body || { months: 12 }, req.user);
  }

  // —— 家属选择取回 / 转长期 ——
  @Post('appointments/:id/choose-retrieve')
  chooseRetrieve(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.chooseRetrieve(id, body || {}, req.user);
  }

  @Get('appointments/:id/longterm-candidates')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager', 'owner')
  longtermCandidates(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.st.longtermCandidates(id, req.user);
  }

  @Post('appointments/:id/longterm-propose')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager')
  longtermPropose(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.longtermPropose(id, body, req.user);
  }

  @Post('longterm/:cid/confirm')
  longtermConfirm(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.st.longtermConfirm(cid, body, req.user);
  }

  // —— 处置案件：开案 / 多轮联系 / 双审批 ——
  @Post('appointments/:id/cases')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager')
  openCase(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.st.openCase(id, body || {}, req.user);
  }

  @Get('cases')
  listCases(@Req() req: any, @Query('status') status: string) {
    return this.st.listCases(req.user, status);
  }

  @Get('cases/:caseId')
  caseDetail(@Param('caseId', ParseIntPipe) caseId: number, @Req() req: any) {
    return this.st.caseDetail(caseId, req.user);
  }

  @Post('cases/:caseId/contact')
  @Roles('customer_service', 'cs_supervisor', 'manager')
  addContact(@Param('caseId', ParseIntPipe) caseId: number, @Body() body: any, @Req() req: any) {
    return this.st.addContactAttempt(caseId, body, req.user);
  }

  @Post('cases/:caseId/supervisor-approve')
  @Roles('cs_supervisor', 'manager')
  supervisorApprove(@Param('caseId', ParseIntPipe) caseId: number, @Body() body: any, @Req() req: any) {
    return this.st.supervisorApprove(caseId, body, req.user);
  }

  @Post('cases/:caseId/storage-review')
  @Roles('storage_manager', 'manager')
  storageReview(@Param('caseId', ParseIntPipe) caseId: number, @Body() body: any, @Req() req: any) {
    return this.st.storageReviewAndOrder(caseId, body, req.user);
  }

  // —— 处置指令：执行 / 回访 / 撤回 ——
  @Post('orders/:orderId/execute')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'cremator', 'driver', 'manager')
  execute(@Param('orderId', ParseIntPipe) orderId: number, @Body() body: any, @Req() req: any) {
    return this.st.executeOrder(orderId, body, req.user);
  }

  @Post('orders/:orderId/followup')
  @Roles('customer_service', 'cs_supervisor', 'storage_manager', 'manager')
  orderFollowUp(@Param('orderId', ParseIntPipe) orderId: number, @Body() body: any, @Req() req: any) {
    return this.st.orderFollowUp(orderId, body, req.user);
  }

  @Post('cases/:caseId/withdraw')
  withdraw(@Param('caseId', ParseIntPipe) caseId: number, @Body() body: any, @Req() req: any) {
    return this.st.withdrawCase(caseId, body || {}, req.user);
  }

  // —— 工单寄存全景 ——
  @Get('appointments/:id/detail')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.st.storageDetail(id, req.user);
  }
}
